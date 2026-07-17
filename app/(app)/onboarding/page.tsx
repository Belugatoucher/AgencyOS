import { redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { isInternal } from "@/lib/access";
import { OnboardingClient } from "./onboarding-client";

// Internal onboarding console (docs/10): send intake links, review & commit.
export default async function OnboardingPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  return <OnboardingClient />;
}
