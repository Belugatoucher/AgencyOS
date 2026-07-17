import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { listCatalog } from "@/lib/services/diy";

// Public DIY storefront catalog (db/009): published paid courses with prices —
// title/description/price only. Rate-limited like every public surface.
export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await rateLimit({ key: `diycat:ip:${ip}`, limit: 60, windowSeconds: 15 * 60 });
  if (!limit.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  return NextResponse.json(await listCatalog());
}
