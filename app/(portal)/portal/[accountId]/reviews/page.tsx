import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentViewer } from "@/lib/auth/session";
import { listItems } from "@/lib/services/review";
import { Card } from "@/components/ui";

// Client-visible review items (docs/11) — listItems already filters for clients.
export default async function PortalReviews(props: { params: Promise<{ accountId: string }> }) {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  const { accountId } = await props.params;
  const items = await listItems(viewer, accountId);
  if (!items.ok) notFound();

  return (
    <Card title="Reviews">
      {items.value.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="portal-reviews">
          {items.value.map((i) => (
            <li key={i.id}>
              <Link
                href={`/portal/${accountId}/reviews/${i.id}`}
                className="block rounded-md border border-border bg-card p-3 font-medium hover:border-accent"
              >
                {i.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing shared for review yet.</p>
      )}
    </Card>
  );
}
