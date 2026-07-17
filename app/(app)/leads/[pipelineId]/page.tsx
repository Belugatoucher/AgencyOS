import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { getPipeline } from "@/lib/services/pipelines";
import { PipelineBoardClient } from "./board-client";

export default async function PipelinePage(props: { params: Promise<{ pipelineId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  const { pipelineId } = await props.params;
  const pipeline = await getPipeline(viewer, pipelineId);
  if (!pipeline.ok) notFound();
  return <PipelineBoardClient pipelineId={pipelineId} />;
}
