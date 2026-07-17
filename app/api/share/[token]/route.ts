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
    const code = resolved.status === "locked_out" ? 429 : resolved.status === "expired" ? 410 : 401;
    return NextResponse.json({ status: resolved.status }, { status: resolved.status === "pin_required" ? 200 : code });
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
