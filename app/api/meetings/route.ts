import { parseBody, respond, withViewer } from "@/lib/api";
import { createMeeting, createMeetingInput, listMeetings } from "@/lib/services/meetings";

export const GET = withViewer(async (req, viewer) => {
  const account = new URL(req.url).searchParams.get("account") ?? undefined;
  return respond(await listMeetings(viewer, account));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, createMeetingInput);
  return respond(await createMeeting(viewer, input), 201);
});
