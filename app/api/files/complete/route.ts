import { parseBody, respond, withViewer } from "@/lib/api";
import { db } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { completeInput, completeUpload } from "@/lib/services/files";
import { notify } from "@/lib/services/notifications";

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, completeInput);
  const result = await completeUpload(viewer, input);
  if (result.ok) {
    const members = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(eq(memberships.accountId, result.value.accountId));
    void notify(
      members.map((m) => m.userId).filter((id) => id !== viewer.id),
      {
        kind: "file_uploaded",
        body: { filename: result.value.filename, accountId: result.value.accountId },
        slackText: `📁 ${result.value.filename} uploaded`,
      },
    );
  }
  return respond(result, 201);
});
