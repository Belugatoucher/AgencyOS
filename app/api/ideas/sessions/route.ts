import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createSession, listSessions, sessionInput } from "@/lib/services/ideation";

// Rambles (docs/19). POST enqueues transcription or the ideation job (rule 4).

export const GET = withViewer(async (req, viewer) => {
  const account = z.string().uuid().parse(new URL(req.url).searchParams.get("account"));
  return respond(await listSessions(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  return respond(await createSession(viewer, await parseBody(req, sessionInput)), 202);
});
