import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { getPortalHome } from "@/lib/services/portal";

type Params = { accountId: string };
const idSchema = z.string().uuid();

// Portal home action stack (docs/11) — clients (members) + internal preview.
export const GET = withViewer<Params>(async (_req, viewer, { accountId }) => {
  return respond(await getPortalHome(viewer, idSchema.parse(accountId)));
});
