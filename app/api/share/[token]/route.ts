import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewItems } from "@/lib/db/schema";
import { resolveShareLink } from "@/lib/services/share-links";
import { buildPublicItem } from "@/lib/services/review-public";

// Public share resolution + PIN gate. GET returns the item payload (or a
// pin_required / expired / locked_out status). The PIN is sent as ?pin=1234;
// attempts are rate-limited server-side (audit item 1). No session required.
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const pin = url.searchParams.get("pin") ?? undefined;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const resolved = await resolveShareLink(token, ip, pin);
  if (resolved.status !== "ok") {
    // pin_required is a 200 (the client shows the PIN prompt); the rest map to
    // the closest HTTP status. Unknown/bad tokens are 404, not 401 — there's no
    // session to be unauthorized against.
    const codeByStatus: Record<string, number> = {
      pin_required: 200,
      locked_out: 429,
      expired: 410,
      not_found: 404,
    };
    return NextResponse.json({ status: resolved.status }, { status: codeByStatus[resolved.status] ?? 404 });
  }

  const link = resolved.link;
  if (link.kind !== "review_item") {
    return NextResponse.json({ status: "unsupported" }, { status: 400 });
  }
  const [item] = await db.select().from(reviewItems).where(eq(reviewItems.id, link.targetId));
  if (!item) return NextResponse.json({ status: "not_found" }, { status: 404 });

  const payload = await buildPublicItem(item, link);
  return NextResponse.json({ status: "ok", ...payload });
}
