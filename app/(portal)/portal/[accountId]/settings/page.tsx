import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { SettingsClient } from "./settings-client";

// Portal settings: set a password so future sign-ins don't need a magic link.
export default async function PortalSettings() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  return <SettingsClient />;
}
