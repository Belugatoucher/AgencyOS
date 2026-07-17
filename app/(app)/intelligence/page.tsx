import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { IntelligenceClient } from "./intelligence-client";

// Intelligence (docs/08 + docs/09) is the agency's knowledge layer — internal
// only; clients never see the hooks library or cross-client material.
export default async function IntelligencePage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <IntelligenceClient />;
}
