import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isAdmin, isInternal } from "@/lib/access";
import { TeamClient } from "./team-client";

export default async function TeamPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <TeamClient canInviteInternal={isAdmin(viewer)} />;
}
