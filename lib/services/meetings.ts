import { desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { canViewAccount, isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  files,
  meetingNotes,
  meetings,
  transcripts,
  type Meeting,
  type MeetingNotes,
  type Transcript,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { HIGHLIGHT_START, HIGHLIGHT_STOP, safeHighlight } from "@/lib/sanitize";
import { getQueue } from "@/lib/queues";

export const createMeetingInput = z.object({
  title: z.string().trim().min(1).max(300),
  occurredAt: z.coerce.date().default(() => new Date()),
  accountId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  leadId: z.string().uuid().nullish(),
  attendees: z.array(z.object({ name: z.string().max(200), email: z.string().email().max(320).optional() })).max(50).default([]),
  retention: z.enum(["keep", "90d", "transcript_only"]).default("keep"),
  clientVisible: z.boolean().default(false),
});

function guard(viewer: Viewer, accountId?: string | null): Result<true> {
  // Notes are an internal tool; client_visible read exposure lands with the
  // portal (doc 11). Only internal users create/read meetings here.
  if (!isInternal(viewer)) return err("forbidden", "Notes are internal");
  if (accountId && !canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(true);
}

export async function createMeeting(
  viewer: Viewer,
  input: z.infer<typeof createMeetingInput>,
): Promise<Result<Meeting>> {
  const g = guard(viewer, input.accountId);
  if (!g.ok) return g as Result<never>;
  const [row] = await db
    .insert(meetings)
    .values({
      title: input.title,
      occurredAt: input.occurredAt,
      accountId: input.accountId ?? null,
      projectId: input.projectId ?? null,
      leadId: input.leadId ?? null,
      attendees: input.attendees,
      retention: input.retention,
      clientVisible: input.clientVisible,
    })
    .returning();
  return ok(row!);
}

export async function listMeetings(viewer: Viewer, accountId?: string): Promise<Result<Meeting[]>> {
  const g = guard(viewer, accountId);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select()
    .from(meetings)
    .where(accountId ? eq(meetings.accountId, accountId) : undefined)
    .orderBy(desc(meetings.occurredAt));
  return ok(rows);
}

async function loadMeeting(id: string): Promise<Meeting | null> {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
  return row ?? null;
}

/**
 * Attach the uploaded audio file and kick off the pipeline: transcribe →
 * diarize → notes. Files >2s of processing are jobs, not inline (docs/00).
 */
export const attachAudioInput = z.object({ fileId: z.string().uuid() });

export async function attachAudio(
  viewer: Viewer,
  meetingId: string,
  fileId: string,
): Promise<Result<Meeting>> {
  const meeting = await loadMeeting(meetingId);
  if (!meeting || !guard(viewer, meeting.accountId).ok) return err("not_found", "Meeting not found");
  if (!isInternal(viewer)) return err("forbidden", "Notes are internal");
  const [file] = await db.select().from(files).where(eq(files.id, fileId));
  if (!file) return err("invalid", "File not found");

  const [row] = await db
    .update(meetings)
    .set({ audioFileId: fileId, status: "transcribing" })
    .where(eq(meetings.id, meetingId))
    .returning();
  await getQueue("transcribe").add("transcribe-meeting", { meetingId });
  return ok(row!);
}

export type MeetingDetail = {
  meeting: Meeting;
  transcript: Transcript | null;
  notes: MeetingNotes | null;
};

export async function getMeeting(viewer: Viewer, id: string): Promise<Result<MeetingDetail>> {
  const meeting = await loadMeeting(id);
  if (!meeting || !guard(viewer, meeting.accountId).ok) return err("not_found", "Meeting not found");
  const [transcript] = await db.select().from(transcripts).where(eq(transcripts.meetingId, id));
  const [notes] = await db.select().from(meetingNotes).where(eq(meetingNotes.meetingId, id));
  return ok({ meeting, transcript: transcript ?? null, notes: notes ?? null });
}

export async function renameSpeakers(
  viewer: Viewer,
  meetingId: string,
  speakers: Record<string, string>,
): Promise<Result<Transcript>> {
  const meeting = await loadMeeting(meetingId);
  if (!meeting || !guard(viewer, meeting.accountId).ok) return err("not_found", "Meeting not found");
  if (!isInternal(viewer)) return err("forbidden", "Notes are internal");
  const [row] = await db
    .update(transcripts)
    .set({ speakers })
    .where(eq(transcripts.meetingId, meetingId))
    .returning();
  if (!row) return err("not_found", "Transcript not ready");
  return ok(row);
}

export async function reprocess(viewer: Viewer, meetingId: string): Promise<Result<{ queued: true }>> {
  const meeting = await loadMeeting(meetingId);
  if (!meeting || !guard(viewer, meeting.accountId).ok) return err("not_found", "Meeting not found");
  if (!meeting.audioFileId) return err("invalid", "No audio to process");
  await db.update(meetings).set({ status: "transcribing" }).where(eq(meetings.id, meetingId));
  await getQueue("transcribe").add("transcribe-meeting", { meetingId });
  return ok({ queued: true });
}

// ===== Action items → Tasks bridge =====

export const tasksFromInput = z.object({
  indexes: z.array(z.number().int().min(0)).min(1),
});

type ActionItem = { text: string; owner_guess?: string | null; due_guess?: string | null; owner_user_id?: string | null; task_id?: string | null };

export async function tasksFromActionItems(
  viewer: Viewer,
  meetingId: string,
  indexes: number[],
): Promise<Result<{ created: number }>> {
  const meeting = await loadMeeting(meetingId);
  if (!meeting || !guard(viewer, meeting.accountId).ok) return err("not_found", "Meeting not found");
  if (!isInternal(viewer)) return err("forbidden", "Notes are internal");
  const [notes] = await db.select().from(meetingNotes).where(eq(meetingNotes.meetingId, meetingId));
  if (!notes) return err("invalid", "No notes yet");

  const items = (notes.actionItems as ActionItem[] | null) ?? [];
  const { tasks } = await import("@/lib/db/schema");
  let created = 0;
  const updated = [...items];
  for (const i of indexes) {
    const item = items[i];
    if (!item || item.task_id) continue;
    const due = item.due_guess ? new Date(item.due_guess) : null;
    const [task] = await db
      .insert(tasks)
      .values({
        accountId: meeting.accountId,
        title: item.text.slice(0, 300),
        assigneeId: item.owner_user_id ?? null,
        dueAt: due && !Number.isNaN(due.getTime()) ? due : null,
        status: "todo",
        source: "meeting",
        sourceId: meetingId,
      })
      .returning();
    updated[i] = { ...item, task_id: task!.id };
    created++;
  }
  await db.update(meetingNotes).set({ actionItems: updated }).where(eq(meetingNotes.meetingId, meetingId));
  return ok({ created });
}

// ===== Full-text search (docs/03) =====

export async function searchMeetings(
  viewer: Viewer,
  q: string,
): Promise<Result<{ meetingId: string; title: string; occurredAt: Date; snippet: string }[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Notes are internal");
  if (!q.trim()) return ok([]);
  // Compute tsvector at query time (see schema DECISION); rank by match.
  const match: SQL = sql`to_tsvector('english', ${transcripts.segments}::text) @@ plainto_tsquery('english', ${q})`;
  const rows = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      // Sentinel markers instead of <b> tags: the transcript text is
      // attacker-influenced, so it gets HTML-escaped BEFORE highlighting
      // (safeHighlight) — the UI must never receive raw markup from here.
      snippet: sql<string>`ts_headline('english', ${transcripts.segments}::text, plainto_tsquery('english', ${q}), ${`MaxFragments=1,MaxWords=20,StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_STOP}`})`,
    })
    .from(transcripts)
    .innerJoin(meetings, eq(meetings.id, transcripts.meetingId))
    .where(match)
    .limit(20);
  return ok(rows.map((r) => ({ ...r, snippet: safeHighlight(r.snippet) })));
}
