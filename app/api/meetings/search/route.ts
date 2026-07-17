import { respond, withViewer } from "@/lib/api";
import { searchMeetings } from "@/lib/services/meetings";

// Full-text search across transcripts (docs/03).
export const GET = withViewer(async (req, viewer) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return respond(await searchMeetings(viewer, q));
});
