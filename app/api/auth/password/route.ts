import { parseBody, respond, withViewer } from "@/lib/api";
import { setPassword, setPasswordInput } from "@/lib/services/password-auth";

// Set/rotate your own portal password (signed-in users only; magic links stay).
export const POST = withViewer(async (req, viewer) => {
  const { password } = await parseBody(req, setPasswordInput);
  return respond(await setPassword(viewer, password));
});
