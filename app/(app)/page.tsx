import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";

// Members land on My Tasks (docs/04); clients land in their portal (docs/11) —
// straight there with one membership, account picker otherwise.
export default async function Home() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (isInternal(viewer)) redirect("/tasks");
  if (viewer.membershipAccountIds.length === 1) redirect(`/portal/${viewer.membershipAccountIds[0]}`);
  redirect("/accounts");
}
