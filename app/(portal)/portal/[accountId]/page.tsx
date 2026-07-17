import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { getPortalHome } from "@/lib/services/portal";
import { Badge, Card } from "@/components/ui";

// Home: the action-needed stack (docs/11). Empty stack = "You're all caught up."
export default async function PortalHome(props: { params: Promise<{ accountId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  const home = await getPortalHome(viewer, accountId);
  if (!home.ok) notFound();
  const { reviewsAwaiting, postsAwaiting, tasksFlagged } = home.value;
  const empty = reviewsAwaiting.length + postsAwaiting.length + tasksFlagged.length === 0;
  const base = `/portal/${accountId}`;

  if (empty) {
    return (
      <Card title="Nothing needs you right now">
        <p className="text-2xl">🎉 You're all caught up.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="portal-stack">
      {reviewsAwaiting.length > 0 && (
        <Card title={`Reviews awaiting your approval (${reviewsAwaiting.length})`}>
          <ul className="flex flex-col gap-1 text-sm">
            {reviewsAwaiting.map((r) => (
              <li key={r.id}>
                <Link
                  href={`${base}/reviews/${r.id}`}
                  className="flex items-center justify-between rounded-md border border-border bg-card p-3 hover:border-accent"
                >
                  <span className="font-medium">{r.title}</span>
                  <Badge>v{r.versionNo}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {postsAwaiting.length > 0 && (
        <Card title={`Posts awaiting your approval (${postsAwaiting.length})`}>
          <ul className="flex flex-col gap-1 text-sm">
            {postsAwaiting.map((p) => (
              <li key={p.id}>
                <Link
                  href={`${base}/content`}
                  className="block rounded-md border border-border bg-card p-3 hover:border-accent"
                >
                  <span className="text-xs text-muted">{p.channels.join(" · ")}</span>
                  <p className="line-clamp-2">{p.body ?? "(no copy yet)"}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {tasksFlagged.length > 0 && (
        <Card title={`On your plate (${tasksFlagged.length})`}>
          <ul className="flex flex-col gap-1 text-sm">
            {tasksFlagged.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
                <span>{t.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted">
                  <Badge>{t.status}</Badge>
                  {t.dueAt && new Date(t.dueAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
