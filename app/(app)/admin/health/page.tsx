import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { currentViewer } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { jobRuns } from "@/lib/db/schema";
import { getQueue, QUEUE_NAMES } from "@/lib/queues";
import { Badge, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

// /admin/* is admin-only, stated explicitly (audit item 10).
export default async function HealthPage() {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (!isAdmin(viewer)) redirect("/accounts");

  const [runs, counts] = await Promise.all([
    db.select().from(jobRuns).orderBy(desc(jobRuns.createdAt)).limit(50),
    Promise.all(
      QUEUE_NAMES.map(async (name) => {
        try {
          const c = await getQueue(name).getJobCounts("waiting", "active", "delayed", "failed");
          return { name, ...c, reachable: true };
        } catch {
          return { name, waiting: 0, active: 0, delayed: 0, failed: 0, reachable: false };
        }
      }),
    ),
  ]);

  const lastErrors = runs.filter((r) => r.status !== "ok").slice(0, 10);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Health</h1>

      <Card title="Queues">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="p-1">Queue</th>
              <th className="p-1">Waiting</th>
              <th className="p-1">Active</th>
              <th className="p-1">Delayed</th>
              <th className="p-1">Failed</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((q) => (
              <tr key={q.name} className="border-t border-border">
                <td className="p-1 font-medium">
                  {q.name} {!q.reachable && <Badge>redis unreachable</Badge>}
                </td>
                <td className="p-1">{q.waiting}</td>
                <td className="p-1">{q.active}</td>
                <td className="p-1">{q.delayed}</td>
                <td className="p-1">{q.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Last errors">
        {lastErrors.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {lastErrors.map((r) => (
              <li key={r.id} className="rounded-md border border-destructive/20 bg-destructive/5 p-2">
                <span className="font-medium">
                  {r.queue}/{r.job}
                </span>{" "}
                <Badge>{r.status}</Badge>
                <div className="text-xs text-muted">{r.error}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No failed or retrying jobs. 🎉</p>
        )}
      </Card>

      <Card title="Recent job runs">
        {runs.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="p-1">When</th>
                <th className="p-1">Queue</th>
                <th className="p-1">Job</th>
                <th className="p-1">Status</th>
                <th className="p-1">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-1 text-xs text-muted">{r.createdAt.toLocaleString()}</td>
                  <td className="p-1">{r.queue}</td>
                  <td className="p-1">{r.job}</td>
                  <td className="p-1">
                    <Badge>{r.status}</Badge>
                  </td>
                  <td className="p-1 text-xs">{r.durationMs != null ? `${r.durationMs}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">No job runs recorded yet.</p>
        )}
      </Card>
    </div>
  );
}
