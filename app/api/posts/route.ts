import { parseBody, respond, withViewer } from "@/lib/api";
import { createPost, createPostInput, listPosts, postFilters } from "@/lib/services/posts";

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const filters = postFilters.parse({
    account: url.searchParams.get("account") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });
  return respond(await listPosts(viewer, filters));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, createPostInput);
  return respond(await createPost(viewer, input), 201);
});
