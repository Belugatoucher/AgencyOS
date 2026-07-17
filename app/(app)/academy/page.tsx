import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { AcademyClient } from "./academy-client";

// Academy (docs/16) — internal only.
export default async function AcademyPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <AcademyClient isAdmin={viewer.role === "admin"} />;
}
