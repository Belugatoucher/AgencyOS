import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isInternal } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { IdeasClient } from "./ideas-client";

// Ideation (docs/19) — internal only.
export default async function IdeasPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isInternal(viewer)) redirect("/accounts");
  // useSearchParams (?session=) needs a Suspense boundary in Next 15
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <IdeasClient />
    </Suspense>
  );
}
