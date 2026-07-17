import { NextResponse } from "next/server";
import { respond, withViewer } from "@/lib/api";
import { importHooks } from "@/lib/services/hooks";
import { parseCsv } from "@/lib/services/lead-intake";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

// Bulk hook import (docs/08): body is raw CSV text with headers
// text,format,platform,niche_tags,source_url. Internal only (service guard).
export const POST = withViewer(async (req, viewer) => {
  const text = await req.text();
  if (text.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV too large" }, { status: 413 });
  }
  return respond(await importHooks(viewer, parseCsv(text)), 201);
});
