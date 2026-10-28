import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { deleteSite, getSiteDetail, updateSite, updateSiteInput } from "@/lib/services/sites";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await getSiteDetail(viewer, idSchema.parse(id)));
});

export const PATCH = withViewer<Params>(async (req, viewer, { id }) => {
  return respond(await updateSite(viewer, idSchema.parse(id), await parseBody(req, updateSiteInput)));
});

// Soft delete (rule 8).
export const DELETE = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await deleteSite(viewer, idSchema.parse(id)));
});
