import { NextResponse } from "next/server";
import { getPublicReport } from "@/lib/services/grader";

// Public report status/content for the report page's polling. The token is the
// capability (192-bit, expiring); contact details are never returned.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await getPublicReport(token);
  if (!r.ok) return NextResponse.json({ error: r.error.message }, { status: 404 });
  return NextResponse.json(r.value, { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
}
