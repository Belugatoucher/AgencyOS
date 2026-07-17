import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { LearnClient } from "./learn-client";

// DIY course area (db/008): any signed-in user sees the paid courses they're
// entitled to — external learners land here after sign-in.
export default async function LearnPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  return <LearnClient />;
}
