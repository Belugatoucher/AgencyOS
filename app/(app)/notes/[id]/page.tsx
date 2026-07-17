import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { getMeeting } from "@/lib/services/meetings";
import { MeetingClient } from "./meeting-client";

export default async function MeetingPage(props: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  const { id } = await props.params;
  const meeting = await getMeeting(viewer, id);
  if (!meeting.ok) notFound();
  return <MeetingClient meetingId={id} title={meeting.value.meeting.title} />;
}
