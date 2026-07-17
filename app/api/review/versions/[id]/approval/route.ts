import { NextResponse } from "next/server";
import { z } from "zod";
import { statusForError } from "@/lib/result";
import { approvalInput, decideApproval } from "@/lib/services/review";
import { guestFields, resolveActor } from "@/lib/services/review-actor";

const idSchema = z.string().uuid();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const versionId = idSchema.parse(id);
  const raw = await req.json();
  const actor = await resolveActor(versionId, guestFields.parse(raw));
  if (!actor) return NextResponse.json({ error: "Not authorized" }, { status: 401 });

  const input = approvalInput.parse(raw);
  const result = await decideApproval(actor, versionId, input);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: statusForError[result.error.code] });
  }
  return NextResponse.json(result.value, { status: 201 });
}
