import { z } from "zod";
import { respond, withViewer } from "@/lib/api";
import { RESEARCH_KINDS, searchResearch } from "@/lib/services/research";

const query = z.object({
  q: z.string().trim().min(1).max(500),
  account: z.string().uuid().optional(),
  kind: z.enum(RESEARCH_KINDS).optional(),
});

// Semantic search over research chunks (docs/08 retrieval; internal only).
export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const parsed = query.parse({
    q: url.searchParams.get("q") ?? "",
    account: url.searchParams.get("account") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
  });
  return respond(
    await searchResearch(viewer, parsed.q, { accountId: parsed.account, kind: parsed.kind }),
  );
});
