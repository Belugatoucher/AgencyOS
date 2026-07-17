import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { canViewAccount } from "@/lib/access";
import { err, ok } from "@/lib/result";
import { accountBrand, getPost } from "@/lib/services/posts";
import { draftContent, draftRequest } from "@/lib/services/content-draft";

type Params = { id: string };
const idSchema = z.string().uuid();

// Draft platform-native variants for a post from a source (docs/06). Returns
// proposed per-channel bodies; nothing auto-schedules — a human reviews.
export const POST = withViewer<Params>(async (req, viewer, { id }) => {
  const postId = idSchema.parse(id);
  const post = await getPost(viewer, postId);
  if (!post.ok) return respond(post);
  if (!canViewAccount(viewer, post.value.accountId)) return respond(err("not_found", "Post not found"));
  const input = await parseBody(req, draftRequest);
  const brand = await accountBrand(post.value.accountId);
  if (!brand) return respond(err("not_found", "Account not found"));
  const draft = await draftContent(brand, input.channels, input.source);
  return respond(ok(draft));
});
