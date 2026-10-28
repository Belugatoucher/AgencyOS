// Small display helpers shared by the Sites dashboard and detail pages.

export type HealthStatus = "ok" | "warn" | "fail" | "unknown";

const DOT: Record<HealthStatus, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  fail: "bg-destructive",
  unknown: "bg-border",
};

export function HealthDot({ status, label }: { status: HealthStatus; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={label ?? status}>
      <span className={`inline-block h-2 w-2 rounded-full ${DOT[status] ?? DOT.unknown}`} />
      {label}
    </span>
  );
}

const STAGE_ORDER = ["intake", "design", "build", "review", "live"] as const;

/** intake → design → build → review → live, current stage highlighted. */
export function StageTrack({ stage }: { stage: string }) {
  if (stage === "paused" || stage === "archived") {
    return <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">{stage}</span>;
  }
  const at = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label={`Stage: ${stage}`}>
      {STAGE_ORDER.map((s, i) => (
        <li
          key={s}
          className={`rounded px-1.5 py-0.5 ${
            i === at ? "bg-primary text-primary-foreground" : i < at ? "text-foreground" : "text-muted"
          }`}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      className={`rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent ${className}`}
      {...rest}
    />
  );
}
