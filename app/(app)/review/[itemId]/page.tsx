import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { getItem } from "@/lib/services/review";
import { ReviewItemClient } from "./review-item-client";

export default async function ReviewItemPage(props: { params: Promise<{ itemId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  const { itemId } = await props.params;
  const item = await getItem(viewer, itemId);
  if (!item.ok) notFound();
  return <ReviewItemClient itemId={itemId} accountId={item.value.item.accountId} title={item.value.item.title} />;
}
