import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { PortalContentClient } from "./portal-content-client";

// Content calendar, read-only except approvals (docs/11).
export default async function PortalContent(props: { params: Promise<{ accountId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  return <PortalContentClient accountId={accountId} />;
}
