import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { getTask } from "@/lib/services/tasks";
import { TaskDetailClient } from "./task-detail-client";

export default async function TaskDetailPage(props: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { id } = await props.params;
  const detail = await getTask(viewer, id);
  if (!detail.ok) notFound();
  return <TaskDetailClient taskId={id} canEdit={isInternal(viewer)} viewerId={viewer.id} />;
}
