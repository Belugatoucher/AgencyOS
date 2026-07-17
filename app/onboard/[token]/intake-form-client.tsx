"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/fetcher";

type FormData = { accountName: string; sections: Record<string, unknown>; status: string };

const FIELDS: { key: string; label: string; hint?: string; rows?: number }[] = [
  { key: "offer", label: "What do you sell, and what makes it different?", rows: 3 },
  { key: "icp", label: "Who is your ideal customer?", rows: 3 },
  { key: "goals", label: "What does a great next quarter look like?", rows: 2 },
  { key: "objections", label: "What objections do you hear most?", hint: "One per line", rows: 3 },
  { key: "proof_points", label: "Proof: results, testimonials, numbers you can back up", hint: "One per line", rows: 3 },
  { key: "compliance_nos", label: "Anything we must never say? (legal/compliance)", hint: "One per line", rows: 2 },
  { key: "competitors", label: "Competitors we should study", hint: "One per line", rows: 2 },
  { key: "access_checklist", label: "Access we still need (ad accounts, socials…)", rows: 2 },
];

function Inner({ token }: { token: string }) {
  const { data, error } = useQuery({
    queryKey: ["intake", token],
    queryFn: () => api<FormData>(`/api/onboarding/form/${token}`),
    retry: false,
  });
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api(`/api/onboarding/form/${token}`, {
        method: "POST",
        body: JSON.stringify({ sections: draft ?? {}, submit }),
      }),
    onSuccess: (_r, submit) => {
      if (submit) setSubmitted(true);
      else setSavedAt(new Date().toLocaleTimeString());
    },
  });

  if (error) {
    return <Card title="Form unavailable"><p className="text-sm text-muted">This link is invalid or has expired — ask your agency contact for a fresh one.</p></Card>;
  }
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  if (submitted || data.status === "submitted") {
    return (
      <Card title="Thank you!">
        <p className="text-sm">
          Your answers are in. The team reviews everything before it powers your account — you can close this tab.
        </p>
      </Card>
    );
  }

  const current: Record<string, string> =
    draft ?? Object.fromEntries(FIELDS.map((f) => [f.key, String((data.sections as Record<string, unknown>)[f.key] ?? "")]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Welcome aboard</p>
        <h1 className="text-xl font-semibold">{data.accountName} — tell us about your business</h1>
        <p className="mt-1 text-sm text-muted">
          Save as you go — you don't have to finish in one sitting.
        </p>
      </div>
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{f.label}</span>
          {f.hint && <span className="text-xs text-muted">{f.hint}</span>}
          <textarea
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
            rows={f.rows ?? 3}
            value={current[f.key]}
            onChange={(e) => setDraft({ ...current, [f.key]: e.target.value })}
            data-testid={`intake-${f.key}`}
          />
        </label>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(false)} data-testid="intake-save">
          Save progress
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate(true)} data-testid="intake-submit">
          Submit to the team
        </Button>
        {savedAt && <span className="text-xs text-muted">Saved {savedAt}</span>}
      </div>
    </div>
  );
}

export function IntakeFormClient({ token }: { token: string }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Inner token={token} />
    </QueryClientProvider>
  );
}
