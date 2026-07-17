import { respond, withViewer } from "@/lib/api";
import { listNotifications, markAllRead } from "@/lib/services/notifications";

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listNotifications(viewer));
});

// POST marks everything read (the bell's only mutation in week 1)
export const POST = withViewer(async (_req, viewer) => {
  return respond(await markAllRead(viewer));
});
