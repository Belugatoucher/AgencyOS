import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { ReviewListClient } from "./review-list-client";

export default async function ReviewPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <ReviewListClient />;
}
