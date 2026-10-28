import { redirect } from "next/navigation";
import { isInternal } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { SiteClient } from "./site-client";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  const { id } = await params;
  return <SiteClient siteId={id} />;
}
