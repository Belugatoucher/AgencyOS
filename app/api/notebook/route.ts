import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { askInput, askNotebook, searchHandbook } from "@/lib/services/notebook";

// Ask the Handbook (docs/16): kb scope only, cited, gap-tracked. Internal only.

export const GET = withViewer(async (req, viewer) => {
  const q = z.string().trim().min(1).max(500).parse(new URL(req.url).searchParams.get("q"));
  return respond(await searchHandbook(viewer, q));
});

export const POST = withViewer(async (req, viewer) => {
  const { question } = await parseBody(req, askInput);
  return respond(await askNotebook(viewer, question));
});
