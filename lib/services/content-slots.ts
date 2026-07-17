import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { canMutateAccount, canViewAccount, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { contentSlots, posts, type ContentSlot } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { nextOccurrence, parseRRule } from "@/lib/rrule";
import { CHANNELS } from "@/lib/scheduler/channels";

export const slotInput = z.object({
  accountId: z.string().uuid(),
  rrule: z.string().trim().min(1).max(500),
  channels: z.array(z.enum(CHANNELS)).min(1).max(5),
  label: z.string().max(200).optional(),
});

export async function listSlots(viewer: Viewer, accountId: string): Promise<Result<ContentSlot[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");
  return ok(await db.select().from(contentSlots).where(eq(contentSlots.accountId, accountId)));
}

export async function createSlot(
  viewer: Viewer,
  input: z.infer<typeof slotInput>,
): Promise<Result<ContentSlot>> {
  if (!canViewAccount(viewer, input.accountId)) return err("not_found", "Account not found");
  if (!canMutateAccount(viewer, input.accountId)) return err("forbidden", "Only the team can create slots");
  if (!parseRRule(input.rrule)) return err("invalid", "Invalid RRULE");
  const [row] = await db.insert(contentSlots).values(input).returning();
  return ok(row!);
}

export type GhostCard = { slotId: string; label: string | null; channels: string[]; date: string };

/**
 * Ghost cards (docs/06): each content slot's expected occurrences in [from,to]
 * that don't already have a post scheduled that day — the "we owe Client X a
 * Thursday post" nudge.
 */
export async function ghostCards(
  viewer: Viewer,
  accountId: string,
  from: Date,
  to: Date,
): Promise<Result<GhostCard[]>> {
  if (!canViewAccount(viewer, accountId)) return err("not_found", "Account not found");

  const slots = await db.select().from(contentSlots).where(eq(contentSlots.accountId, accountId));
  const scheduled = await db
    .select({ scheduledAt: posts.scheduledAt })
    .from(posts)
    .where(and(eq(posts.accountId, accountId), gte(posts.scheduledAt, from), lte(posts.scheduledAt, to)));
  const takenDays = new Set(
    scheduled.filter((p) => p.scheduledAt).map((p) => p.scheduledAt!.toISOString().slice(0, 10)),
  );

  const cards: GhostCard[] = [];
  for (const slot of slots) {
    // walk occurrences from just before `from` up to `to`
    let cursor = new Date(from.getTime() - 24 * 60 * 60 * 1000);
    for (let i = 0; i < 60; i++) {
      const next = nextOccurrence(slot.rrule, cursor);
      if (!next || next > to) break;
      cursor = next;
      if (next < from) continue;
      const day = next.toISOString().slice(0, 10);
      if (!takenDays.has(day)) {
        cards.push({ slotId: slot.id, label: slot.label, channels: slot.channels, date: next.toISOString() });
      }
    }
  }
  return ok(cards);
}
