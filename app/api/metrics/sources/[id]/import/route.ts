import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { columnMapping, importMetricsCsv } from "@/lib/services/metrics";

type Params = { id: string };
const idSchema = z.string().uuid();
const MAX_CSV_BYTES = 10 * 1024 * 1024;

const body = z.object({
  csv: z.string().min(1),
  mapping: columnMapping.nullish(), // required on first import, saved after
});

// CSV metrics import (docs/09): idempotent upsert on source+external_id+date.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const sourceId = idSchema.parse(id);
  const parsed = await parseBody(req, body);
  if (parsed.csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV too large" }, { status: 413 });
  }
  return respond(await importMetricsCsv(viewer, sourceId, parsed.csv, parsed.mapping ?? undefined), 201);
});
