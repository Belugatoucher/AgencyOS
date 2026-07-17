import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createProject, listProjects, projectInput } from "@/lib/services/projects";

type Params = { id: string };
const idSchema = z.string().uuid();

export const GET = withViewer<Params>(async (_req, viewer, { id }) => {
  return respond(await listProjects(viewer, idSchema.parse(id)));
});

export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const input = await parseBody(req, projectInput);
  return respond(await createProject(viewer, idSchema.parse(id), input), 201);
});
