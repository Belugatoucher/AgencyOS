import { z } from "zod";
import { parseBody, respond, withViewer } from "@/lib/api";
import { createCreative, creativeInput, listCreatives } from "@/lib/services/creatives";

// Creative performance log (docs/08). Internal only (service guard).

const listQuery = z.object({
  account: z.string().uuid(),
  platform: z.string().max(50).optional(),
  winning: z.enum(["true", "false"]).optional(),
});

export const GET = withViewer(async (req, viewer) => {
  const url = new URL(req.url);
  const parsed = listQuery.parse({
    account: url.searchParams.get("account") ?? "",
    platform: url.searchParams.get("platform") ?? undefined,
    winning: url.searchParams.get("winning") ?? undefined,
  });
  return respond(
    await listCreatives(viewer, parsed.account, {
      platform: parsed.platform,
      winningOnly: parsed.winning === "true",
    }),
  );
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, creativeInput);
  return respond(await createCreative(viewer, input), 201);
});
