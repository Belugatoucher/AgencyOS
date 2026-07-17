import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  meetingNotes,
  meetings,
  memberships,
  transcripts,
  users,
  type Meeting,
} from "@/lib/db/schema";
import { anthropic, LEAD_SCORING_MODEL, messageText } from "@/lib/ai/anthropic";
import { notify } from "./notifications";

// The notes model shares LEAD_SCORING_MODEL's default (current Sonnet). The
// prompt (prompts/meeting-notes.md) names claude-sonnet-4-6 at temp 0; on the
// current Sonnet, temperature is rejected, so it's omitted (same DECISION as
// lead scoring). Override with MEETING_NOTES_MODEL if desired.
const NOTES_MODEL = process.env.MEETING_NOTES_MODEL ?? LEAD_SCORING_MODEL;

// Zod contract for the model output (audit item 8: injected transcript text
// can't smuggle extra fields past this).
export const notesSchema = z.object({
  summary: z.string().max(4000),
  decisions: z.array(z.string().max(1000)).max(50),
  action_items: z
    .array(
      z.object({
        text: z.string().max(1000),
        owner_guess: z.string().max(200).nullable().optional(),
        due_guess: z.string().max(40).nullable().optional(),
        evidence_ms: z.number().int().min(0).nullable().optional(),
      }),
    )
    .max(100),
  followups: z.array(z.string().max(1000)).max(50),
  sentiment: z.enum(["positive", "neutral", "at_risk"]),
  sentiment_note: z.string().max(500).optional(),
});
export type Notes = z.infer<typeof notesSchema>;

type Segment = { start_ms: number; end_ms: number; speaker: string; text: string };

let cachedSystem: string | null = null;
async function systemPrompt(): Promise<string> {
  if (cachedSystem) return cachedSystem;
  const md = await readFile(path.join(process.cwd(), "prompts", "meeting-notes.md"), "utf8");
  const m = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
  if (!m) throw new Error("Could not parse system prompt from prompts/meeting-notes.md");
  cachedSystem = m[1]!.trim();
  return cachedSystem;
}

function fmtTs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function buildUserMessage(
  meeting: Meeting,
  accountName: string | null,
  segments: Segment[],
  speakers: Record<string, string>,
): string {
  const lines = segments
    .map((s) => `[${fmtTs(s.start_ms)}] ${speakers[s.speaker] ?? s.speaker}: ${s.text}`)
    .join("\n");
  return [
    `Meeting: ${meeting.title}`,
    `Date: ${meeting.occurredAt.toISOString().slice(0, 10)}`,
    `Account: ${accountName ?? "unknown"}`,
    `Attendees: ${JSON.stringify(meeting.attendees)}`,
    `Speaker map: ${JSON.stringify(speakers)}`,
    ``,
    `Transcript segments:`,
    lines,
  ].join("\n");
}

/** Call Claude for meeting notes; parse JSON with one retry, then fail loud. */
export async function generateNotes(meetingId: string): Promise<Notes> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) throw new Error(`Meeting ${meetingId} not found`);
  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.meetingId, meetingId));
  if (!transcript) throw new Error(`Transcript for ${meetingId} not ready`);

  let accountName: string | null = null;
  if (meeting.accountId) {
    const { accounts } = await import("@/lib/db/schema");
    const [a] = await db.select().from(accounts).where(eq(accounts.id, meeting.accountId));
    accountName = a?.name ?? null;
  }

  const segments = (transcript.segments as Segment[]) ?? [];
  const speakers = (transcript.speakers as Record<string, string>) ?? {};
  const system = await systemPrompt();
  const user = buildUserMessage(meeting, accountName, segments, speakers);
  const client = anthropic();

  async function attempt(extra?: string): Promise<Notes> {
    const msg = await client.messages.create({
      model: NOTES_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }],
    });
    const text = messageText(msg).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return notesSchema.parse(JSON.parse(text));
  }

  try {
    return await attempt();
  } catch {
    return await attempt("Return only the JSON object.");
  }
}

type ActionItemOut = {
  text: string;
  owner_guess: string | null;
  due_guess: string | null;
  evidence_ms: number | null;
  owner_user_id: string | null;
  task_id: null;
};

/**
 * Post-process (docs/03): fuzzy-match owner_guess to a team/attendee user,
 * clamp due dates to ≥ today, write meeting_notes, flip status ready, notify.
 * Auto-link by attendee is best-effort against internal users of the account.
 */
export async function applyNotes(meetingId: string, notes: Notes): Promise<void> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) throw new Error(`Meeting ${meetingId} not found`);

  // Candidate users for owner matching: internal users + members of the account.
  const candidates = meeting.accountId
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.accountId, meeting.accountId))
    : await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(ne(users.role, "client"));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const actionItems: ActionItemOut[] = notes.action_items.map((ai) => {
    const owner = matchOwner(ai.owner_guess ?? null, candidates);
    let due: string | null = ai.due_guess ?? null;
    if (due) {
      const d = new Date(due);
      if (Number.isNaN(d.getTime())) due = null;
      else if (d < today) due = today.toISOString().slice(0, 10);
    }
    return {
      text: ai.text,
      owner_guess: ai.owner_guess ?? null,
      due_guess: due,
      evidence_ms: ai.evidence_ms ?? null,
      owner_user_id: owner,
      task_id: null,
    };
  });

  await db
    .insert(meetingNotes)
    .values({
      meetingId,
      summary: notes.summary,
      decisions: notes.decisions,
      actionItems,
      followups: notes.followups,
      raw: notes,
    })
    .onConflictDoUpdate({
      target: meetingNotes.meetingId,
      set: { summary: notes.summary, decisions: notes.decisions, actionItems, followups: notes.followups, raw: notes },
    });

  // Auto-link by attendee (docs/03): match attendee emails against leads; if a
  // match is found and the meeting isn't linked yet, set lead_id (and account_id
  // from the lead) so sales context lives where the deal is.
  if (!meeting.leadId) {
    const attendees = (meeting.attendees as { name?: string; email?: string }[]) ?? [];
    const emails = attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e);
    if (emails.length) {
      const { leads } = await import("@/lib/db/schema");
      const { inArray, sql } = await import("drizzle-orm");
      const [lead] = await db
        .select({ id: leads.id, accountId: leads.accountId })
        .from(leads)
        .where(inArray(sql`lower(${leads.email})`, emails))
        .limit(1);
      if (lead) {
        await db
          .update(meetings)
          .set({ leadId: lead.id, accountId: meeting.accountId ?? lead.accountId ?? null })
          .where(eq(meetings.id, meetingId));
      }
    }
  }

  await db.update(meetings).set({ status: "ready" }).where(eq(meetings.id, meetingId));

  // Meeting → Brain bridge (docs/08): decisions become pending Brain-learning
  // suggestions for the meeting's account. Humans accept/reject — the Brain
  // never self-edits silently.
  if (meeting.accountId && notes.decisions.length) {
    const { suggestFromMeeting } = await import("@/lib/services/brain");
    await suggestFromMeeting(meeting.accountId, meetingId, notes.decisions);
  }

  // Notify internal users of the account.
  const recipients = candidates.map((c) => c.id);
  void notify(recipients, {
    kind: "meeting_notes_ready",
    body: { meetingId, title: meeting.title, summary: notes.summary.slice(0, 160) },
    slackText: `📝 Notes ready for "${meeting.title}"`,
  });
}

/** Simple confident-match: exact email or case-insensitive full-name match. */
function matchOwner(
  guess: string | null,
  candidates: { id: string; name: string; email: string }[],
): string | null {
  if (!guess) return null;
  const g = guess.trim().toLowerCase();
  const byEmail = candidates.find((c) => c.email.toLowerCase() === g);
  if (byEmail) return byEmail.id;
  const byName = candidates.find((c) => c.name.toLowerCase() === g);
  return byName?.id ?? null;
}
