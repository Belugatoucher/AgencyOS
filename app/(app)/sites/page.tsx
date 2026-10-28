import { redirect } from "next/navigation";
import { isInternal } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { SitesClient } from "./sites-client";

// Sites dashboard (docs/18) — internal only.
export default async function SitesPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <SitesClient />;
}
