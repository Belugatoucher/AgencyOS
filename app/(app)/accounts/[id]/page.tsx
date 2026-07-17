import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { getAccount } from "@/lib/services/accounts";
import { AccountDetailClient } from "./detail-client";

export default async function AccountDetailPage(props: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { id } = await props.params;
  const account = await getAccount(viewer, id);
  if (!account.ok) notFound();
  return (
    <AccountDetailClient
      account={{ id: account.value.id, name: account.value.name, timezone: account.value.timezone }}
      internal={isInternal(viewer)}
    />
  );
}
