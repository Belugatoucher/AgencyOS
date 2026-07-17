import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { CalendarClient } from "./calendar-client";

export default async function CalendarPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <CalendarClient />;
}
