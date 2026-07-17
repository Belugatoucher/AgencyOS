import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { SopsClient } from "./sops-client";

// SOP library (docs/16) — internal only.
export default async function SopsPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <SopsClient />;
}
