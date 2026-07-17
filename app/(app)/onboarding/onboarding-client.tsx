"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Account = { id: string; name: string };
type Intake = { id: string; token: string; status: string; createdAt: string; sections: Record<string, string> };
type Template = { id: string; name: string };

export function OnboardingClient() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState("");
  const [reviewing, setReviewing] = useState<Intake | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });
  const { data: intakes } = useQuery({
    queryKey: ["intakes", accountId],
    queryFn: () => api<Intake[]>(`/api/onboarding/intakes?account=${accountId}`),
    enabled: !!accountId,
  });

  const createIntake = useMutation({
    mutationFn: () =>
      api<Intake>("/api/onboarding/intakes", { method: "POST", body: JSON.stringify({ accountId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intakes", accountId] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Onboarding</h1>
        <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); setReviewing(null); }} data-testid="onboard-account">
          <option value="">Select client…</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      {accountId && (
        <Card title="Intake links">
          <Button disabled={createIntake.isPending} onClick={() => createIntake.mutate()} data-testid="intake-create">
            New intake link (30-day)
          </Button>
          <ul className="mt-3 flex flex-col gap-1 text-sm" data-testid="intake-list">
            {intakes?.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <code className="truncate text-xs text-accent">/onboard/{i.token}</code>
                <span className="flex items-center gap-2">
                  <Badge>{i.status}</Badge>
                  {i.status === "submitted" && (
                    <Button variant="outline" onClick={() => setReviewing(i)} data-testid="intake-review">
                      Review & commit
                    </Button>
                  )}
                </span>
              </li>
            ))}
            {intakes?.length === 0 && <p className="text-muted">No intake links yet.</p>}
          </ul>
        </Card>
      )}

      {reviewing && (
        <CommitPanel
          intake={reviewing}
          onDone={() => {
            setReviewing(null);
            qc.invalidateQueries({ queryKey: ["intakes", accountId] });
          }}
        />
      )}
    </div>
  );
}

const splitLines = (s: string | undefined) =>
  (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

function CommitPanel({ intake, onDone }: { intake: Intake; onDone: () => void }) {
  const s = intake.sections ?? {};
  const [offer, setOffer] = useState(s.offer ?? "");
  const [icp, setIcp] = useState(s.icp ?? "");
  const [goals, setGoals] = useState(s.goals ?? "");
  const [objections, setObjections] = useState(s.objections ?? "");
  const [proofPoints, setProofPoints] = useState(s.proof_points ?? "");
  const [complianceNos, setComplianceNos] = useState(s.compliance_nos ?? "");
  const [competitors, setCompetitors] = useState(s.competitors ?? "");
  const [gaps, setGaps] = useState(s.access_checklist ?? "");
  const [templateId, setTemplateId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<Template[]>("/api/onboarding/templates"),
  });

  const commit = useMutation({
    mutationFn: () =>
      api<{ brainVersion: number }>(`/api/onboarding/intakes/${intake.id}/commit`, {
        method: "POST",
        body: JSON.stringify({
          brain: {
            offer: offer || null,
            icp: icp || null,
            goalsCurrentQuarter: goals || null,
            objections: splitLines(objections),
            proofPoints: splitLines(proofPoints),
            complianceNos: splitLines(complianceNos),
          },
          competitors: splitLines(competitors),
          gapTasks: splitLines(gaps).map((g) => `Get access: ${g}`),
          templateId: templateId || null,
        }),
      }),
    onSuccess: (r) => {
      setMsg(`Committed — Brain v${r.brainVersion} written ✅`);
      onDone();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const area = (label: string, value: string, set: (v: string) => void, testid: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted">{label}</span>
      <textarea
        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
        rows={2}
        value={value}
        onChange={(e) => set(e.target.value)}
        data-testid={testid}
      />
    </label>
  );

  return (
    <Card title="Review & commit → Brain v1">
      <p className="mb-3 text-xs text-muted">
        Edit anything the client wrote — nothing reaches the Brain until you commit (docs/10).
      </p>
      <div className="flex flex-col gap-3">
        {area("Offer", offer, setOffer, "commit-offer")}
        {area("ICP", icp, setIcp, "commit-icp")}
        {area("Goals this quarter", goals, setGoals, "commit-goals")}
        {area("Objections (one per line)", objections, setObjections, "commit-objections")}
        {area("Proof points (one per line)", proofPoints, setProofPoints, "commit-proof")}
        {area("Compliance no-gos (one per line)", complianceNos, setComplianceNos, "commit-compliance")}
        {area("Competitors → research stubs (one per line)", competitors, setCompetitors, "commit-competitors")}
        {area("Access gaps → tasks (one per line)", gaps, setGaps, "commit-gaps")}
        <div className="flex items-center gap-2">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="commit-template">
            <option value="">No kickoff template</option>
            {templates?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button disabled={commit.isPending} onClick={() => commit.mutate()} data-testid="commit-go">
            Commit
          </Button>
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
      </div>
    </Card>
  );
}
