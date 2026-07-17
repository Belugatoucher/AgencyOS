"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { money, type Pipeline, type PipelineOverview } from "./lead-types";

type Account = { id: string; name: string };

export function LeadsOverviewClient() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: overview } = useQuery({
    queryKey: ["leads", "overview"],
    queryFn: () => api<PipelineOverview[]>("/api/leads/overview"),
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/api/accounts"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Pipeline>("/api/pipelines", {
        method: "POST",
        body: JSON.stringify({ name, accountId }),
      }),
    onSuccess: () => {
      setName("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["leads", "overview"] });
    },
    onError: (e) => setError(e.message),
  });

  const accountName = (id: string | null) =>
    id ? (accounts?.find((a) => a.id === id)?.name ?? "—") : "Agency";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Leads</h1>

      <Card title="New pipeline">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && accountId) create.mutate();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pipeline name (e.g. Inbound)"
            data-testid="new-pipeline-name"
          />
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="new-pipeline-account">
            <option value="">Select account…</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={create.isPending} data-testid="new-pipeline-submit">
            Create pipeline
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <p className="mt-2 text-xs text-muted">Seeds default stages: New → Contacted → Qualified → Proposal → Won / Lost.</p>
      </Card>

      <Card title="All pipelines">
        {overview?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="p-2">Pipeline</th>
                  <th className="p-2">Account</th>
                  <th className="p-2">Leads</th>
                  <th className="p-2">Open value</th>
                  <th className="p-2">Won (mo)</th>
                  <th className="p-2">No next action</th>
                </tr>
              </thead>
              <tbody data-testid="overview-rows">
                {overview.map((p) => (
                  <tr key={p.pipelineId} className="border-t border-border hover:bg-background">
                    <td className="p-2">
                      <Link href={`/leads/${p.pipelineId}`} className="font-medium text-accent hover:underline">
                        {p.pipelineName}
                      </Link>
                    </td>
                    <td className="p-2 text-muted">{accountName(p.accountId)}</td>
                    <td className="p-2">{p.leadCount}</td>
                    <td className="p-2">{money(p.openValueCents)}</td>
                    <td className="p-2">{p.wonThisMonth}</td>
                    <td className="p-2">
                      {p.noNextAction > 0 ? <Badge>{p.noNextAction} ⚠</Badge> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">No pipelines yet. Create one above.</p>
        )}
      </Card>
    </div>
  );
}
