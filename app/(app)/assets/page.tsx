import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { AssetsClient } from "./assets-client";

export default async function AssetsPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <AssetsClient />;
}
