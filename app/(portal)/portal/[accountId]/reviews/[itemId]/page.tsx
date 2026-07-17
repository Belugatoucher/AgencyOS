import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { getItem } from "@/lib/services/review";
import { ReviewItemClient } from "@/app/(app)/review/[itemId]/review-item-client";

// The full player experience, client-skinned (docs/11): identical components,
// team-only controls hidden; getItem enforces client_visible + membership.
export default async function PortalReviewItem(props: {
  params: Promise<{ accountId: string; itemId: string }>;
}) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId, itemId } = await props.params;
  const item = await getItem(viewer, itemId);
  if (!item.ok || item.value.item.accountId !== accountId) notFound();
  return (
    <ReviewItemClient
      itemId={itemId}
      accountId={accountId}
      title={item.value.item.title}
      internal={false}
      backHref={`/portal/${accountId}/reviews`}
    />
  );
}
