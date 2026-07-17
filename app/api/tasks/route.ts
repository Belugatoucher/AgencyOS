import { parseBody, respond, withViewer } from "@/lib/api";
import { createTask, createTaskInput, listTasks, taskFilters } from "@/lib/services/tasks";

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = taskFilters.parse({
    assignee: url.searchParams.get("assignee") ?? undefined,
    account: url.searchParams.get("account") ?? undefined,
    project: url.searchParams.get("project") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    due: url.searchParams.get("due") ?? undefined,
  });
  return respond(await listTasks(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, createTaskInput);
  return respond(await createTask(viewer, input), 201);
});
