import { eq } from "drizzle-orm";
import { parseBody, respond, withViewer } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { notify } from "@/lib/services/notifications";
import { inviteInput, inviteUser, listUsers } from "@/lib/services/team";

export const GET = withViewer(async (_req, viewer) => {
  return respond(await listUsers(viewer));
});

export const POST = withViewer(async (req, viewer) => {
  const input = await parseBody(req, inviteInput);
  const result = await inviteUser(viewer, input);
  if (result.ok) {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    void notify(
      admins.map((a) => a.id).filter((id) => id !== viewer.id),
      {
        kind: "member_invited",
        body: { email: result.value.email, name: result.value.name, role: result.value.role },
        slackText: `👋 ${result.value.name} (${result.value.role}) was invited to Agency OS`,
      },
    );
  }
  return respond(result, 201);
});
