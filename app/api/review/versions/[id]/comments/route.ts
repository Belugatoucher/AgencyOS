import { NextResponse } from "next/server";
import { z } from "zod";
import { statusForError } from "@/lib/result";
import { addComment, commentInput, listComments } from "@/lib/services/review";
import { guestFields, resolveActor } from "@/lib/services/review-actor";

const idSchema = z.string().uuid();

// GET is available to a valid share-token guest or a signed-in user.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const versionId = idSchema.parse(id);
  // Comments are readable if the actor can act on the version.
  const actor = await resolveActor(versionId, {});
  // A signed-in user resolves without guest fields; a guest needs a token, so
  // fall back to allowing read only when an actor resolves.
  if (!actor) return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  return NextResponse.json(await listComments(versionId));
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
