import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { portalCollections } from "@/lib/services/portal";
import { Card } from "@/components/ui";

// Shared collections (docs/11). Downloads ride share links from the team;
// drop-boxes land with the uploads pass.
export default async function PortalFiles(props: { params: Promise<{ accountId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  const rows = await portalCollections(viewer, accountId);
  if (!rows.ok) notFound();

  return (
    <Card title="Shared collections">
      {rows.value.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="portal-files">
          {rows.value.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-card p-3 font-medium">
              {c.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No collections shared yet.</p>
      )}
    </Card>
  );
}
