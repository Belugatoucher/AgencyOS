import { NextResponse } from "next/server";
import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getPipeline } from "@/lib/services/pipelines";
import { importCsv } from "@/lib/services/lead-intake";

type Params = { id: string };
const idSchema = z.string().uuid();
const MAX_CSV_BYTES = 5 * 1024 * 1024;

// Authenticated CSV import into a pipeline (internal only). Body is raw CSV text.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const pipelineId = idSchema.parse(id);
  const pipeline = await getPipeline(viewer, pipelineId);
  if (!pipeline.ok) return respond(pipeline);

  const text = await req.text();
  if (text.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV too large" }, { status: 413 });
  }
  return respond(await importCsv(pipelineId, pipeline.value.accountId, text), 201);
});
