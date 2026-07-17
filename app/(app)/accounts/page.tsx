import { AccountsClient } from "./accounts-client";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { redirect } from "next/navigation";

export default async function AccountsPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  return <AccountsClient canCreate={isInternal(viewer)} />;
}
