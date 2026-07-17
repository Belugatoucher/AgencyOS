import { NextResponse } from "next/server";
import { z } from "zod";
import { statusForError } from "@/lib/result";
import { addComment, commentInput, listCommentsFor } from "@/lib/services/review";
import { guestFields, resolveActor } from "@/lib/services/review-actor";

const idSchema = z.string().uuid();

// GET is available to a valid share-token guest or a signed-in user. The
// service authorizes per actor (cross-account → 404) and role-filters
// internal threads from clients/guests (docs/11).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const versionId = idSchema.parse(id);
  const url = new URL(req.url);
  const actor = await resolveActor(versionId, {
    shareToken: url.searchParams.get("shareToken") ?? undefined,
    guestName: url.searchParams.get("guestName") ?? undefined,
  });
  if (!actor) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  const result = await listCommentsFor(actor, versionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const versionId = idSchema.parse(id);
  const raw = await req.json();
  const guest = guestFields.parse(raw);
  const actor = await resolveActor(versionId, guest);
  if (!actor) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const input = commentInput.parse(raw);
  const result = await addComment(actor, versionId, input);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value, { status: 201 });
}
