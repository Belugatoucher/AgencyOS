import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { portalMeetings } from "@/lib/services/portal";
import { Card } from "@/components/ui";

// Shared meeting recaps (docs/11): summary only — never the raw transcript.
export default async function PortalMeetings(props: { params: Promise<{ accountId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  const rows = await portalMeetings(viewer, accountId);
  if (!rows.ok) notFound();

  return (
    <Card title="Meeting recaps">
      {rows.value.length ? (
        <ul className="flex flex-col gap-2 text-sm" data-testid="portal-meetings">
          {rows.value.map((m) => (
            <li key={m.id} className="rounded-md border border-border bg-card p-3">
              <p className="flex items-center justify-between font-medium">
                {m.title}
                <span className="text-xs text-muted">{new Date(m.occurredAt).toLocaleDateString()}</span>
              </p>
              {m.summary && <p className="mt-1 text-muted">{m.summary}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No recaps shared yet.</p>
      )}
    </Card>
  );
}
