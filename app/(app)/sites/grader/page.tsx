import { redirect } from "next/navigation";
import { isInternal } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { GraderClient } from "./grader-client";

// Grader console (docs/18 "Grader") — internal only.
export default async function GraderPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <GraderClient />;
}
