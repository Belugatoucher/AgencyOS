"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/fetcher";
import {
  money,
  nextActionTone,
  scoreBand,
  type LeadRow,
  type Pipeline,
} from "../lead-types";
import { LeadDrawer } from "./lead-drawer";

export function PipelineBoardClient({ pipelineId }: { pipelineId: string }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const { data: pipeline } = useQuery({
    queryKey: ["pipeline", pipelineId],
    queryFn: () => api<Pipeline>(`/api/pipelines/${pipelineId}`),
  });
  const leadsKey = ["leads", "pipeline", pipelineId];
  const { data: leads } = useQuery({
    queryKey: leadsKey,
    queryFn: () => api<LeadRow[]>(`/api/leads?pipeline=${pipelineId}`),
  });

  const move = useMutation({
    mutationFn: (v: { id: string; stageUuid: string }) =>
      api(`/api/leads/${v.id}/move`, { method: "POST", body: JSON.stringify({ stageUuid: v.stageUuid }) }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: leadsKey });
      const prev = qc.getQueryData<LeadRow[]>(leadsKey);
      qc.setQueryData<LeadRow[]>(leadsKey, (old) =>
        (old ?? []).map((l) => (l.id === v.id ? { ...l, stageUuid: v.stageUuid } : l)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(leadsKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });

  const intake = useMutation({
    mutationFn: (enabled: boolean) =>
      api<Pipeline>(`/api/pipelines/${pipelineId}/intake`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pipeline", pipelineId] }),
  });

  if (!pipeline) return <p className="text-sm text-muted">Loading…</p>;

  const stages = pipeline.stages;
  const byStage = (stageId: string) => (leads ?? []).filter((l) => l.stageUuid === stageId);
  const unstaged = (leads ?? []).filter((l) => !l.stageUuid);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/leads" className="text-sm text-muted hover:text-foreground">
            ← Leads
          </Link>
          <h1 className="text-xl font-semibold">{pipeline.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant={view === "kanban" ? "primary" : "outline"} onClick={() => setView("kanban")}>
            Kanban
          </Button>
          <Button variant={view === "table" ? "primary" : "outline"} onClick={() => setView("table")}>
            Table
          </Button>
        </div>
      </div>

      <NewLeadForm pipeline={pipeline} onCreated={() => qc.invalidateQueries({ queryKey: ["leads"] })} />

      <div className="flex flex-wrap items-center gap-2">
        <ImportCsv pipelineId={pipelineId} onDone={() => qc.invalidateQueries({ queryKey: ["leads"] })} />
        {pipeline.intakeToken ? (
          <span className="flex items-center gap-2 text-xs text-muted">
            <Badge>intake on</Badge>
            <code className="rounded bg-background px-1">/api/intake/{pipeline.intakeToken.slice(0, 8)}…</code>
            <button className="underline hover:text-foreground" onClick={() => intake.mutate(false)}>
              disable
            </button>
          </span>
        ) : (
          <button
            className="text-xs text-accent underline"
            onClick={() => intake.mutate(true)}
            data-testid="enable-intake"
          >
            Enable public intake form
          </button>
        )}
      </div>

      {view === "kanban" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6" data-testid="lead-board">
          {stages.map((stage) => {
            const col = byStage(stage.id);
            const value = col.reduce((s, l) => s + (l.valueCents ?? 0), 0);
            return (
              <div
                key={stage.id}
                data-testid={`stage-${stage.id}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) move.mutate({ id: dragId, stageUuid: stage.id });
                  setDragId(null);
                }}
                className="flex min-h-32 flex-col gap-2 rounded-lg border border-border bg-background p-2"
              >
                <h2 className="flex items-center justify-between px-1 text-xs font-semibold uppercase text-muted">
                  <span style={{ color: stage.color ?? undefined }}>{stage.name}</span>
                  <span>{col.length}</span>
                </h2>
                <div className="px-1 text-[10px] text-muted">{money(value)}</div>
                {col.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onDrag={() => setDragId(lead.id)} onOpen={() => setOpenLead(lead.id)} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="p-2">Name</th>
                  <th className="p-2">Company</th>
                  <th className="p-2">Stage</th>
                  <th className="p-2">Value</th>
                  <th className="p-2">Owner</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Next action</th>
                </tr>
              </thead>
              <tbody data-testid="lead-table">
                {[...unstaged, ...(leads ?? []).filter((l) => l.stageUuid)].map((l) => {
                  const band = scoreBand(l.score);
                  return (
                    <tr
                      key={l.id}
                      className="cursor-pointer border-t border-border hover:bg-background"
                      onClick={() => setOpenLead(l.id)}
                    >
                      <td className="p-2 font-medium">{l.name ?? "—"}</td>
                      <td className="p-2 text-muted">{l.company ?? "—"}</td>
                      <td className="p-2">{l.stageName ?? "—"}</td>
                      <td className="p-2">{money(l.valueCents)}</td>
                      <td className="p-2 text-muted">{l.ownerName ?? "—"}</td>
                      <td className="p-2">{band ? <span className={band.tone}>{band.label}</span> : "—"}</td>
                      <td className="p-2">
                        <span className={`text-xs ${nextActionTone(l.nextActionAt)}`}>
                          {l.nextActionAt ? new Date(l.nextActionAt).toLocaleDateString() : "none"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {openLead && (
        <LeadDrawer
          leadId={openLead}
          pipeline={pipeline}
          onClose={() => setOpenLead(null)}
        />
      )}
    </div>
  );
}

function LeadCard({ lead, onDrag, onOpen }: { lead: LeadRow; onDrag: () => void; onOpen: () => void }) {
  const band = scoreBand(lead.score);
  return (
    <div
      draggable
      onDragStart={onDrag}
      onClick={onOpen}
      data-testid={`lead-card-${lead.id}`}
      className="cursor-grab rounded-md border border-border bg-card p-2 text-sm active:cursor-grabbing"
    >
      <div className="font-medium">{lead.name ?? "(no name)"}</div>
      {lead.company && <div className="text-xs text-muted">{lead.company}</div>}
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs">{money(lead.valueCents)}</span>
        {band && <span className={`text-xs ${band.tone}`}>{band.label}</span>}
      </div>
      {lead.nextActionAt && (
        <div className={`mt-1 text-[10px] ${nextActionTone(lead.nextActionAt)}`}>
          next: {new Date(lead.nextActionAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function NewLeadForm({ pipeline, onCreated }: { pipeline: Pipeline; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [value, setValue] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          pipelineUuid: pipeline.id,
          accountId: pipeline.accountId,
          stageUuid: pipeline.stages[0]?.id ?? null,
          name: name || null,
          company: company || null,
          valueCents: value ? Math.round(Number(value) * 100) : null,
        }),
      }),
    onSuccess: () => {
      setName("");
      setCompany("");
      setValue("");
      onCreated();
    },
  });
  return (
    <form
      className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() || company.trim()) create.mutate();
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lead name" data-testid="new-lead-name" />
      <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value $" type="number" className="w-28" />
      <Button type="submit" disabled={create.isPending} data-testid="new-lead-submit">
        Add lead
      </Button>
    </form>
  );
}

function ImportCsv({ pipelineId, onDone }: { pipelineId: string; onDone: () => void }) {
  const [result, setResult] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      return api<{ imported: number; skipped: number }>(`/api/pipelines/${pipelineId}/import`, {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: text,
      });
    },
    onSuccess: (r) => {
      setResult(`Imported ${r.imported}, skipped ${r.skipped}`);
      onDone();
    },
    onError: (e) => setResult(e.message),
  });
  return (
    <label className="cursor-pointer text-xs text-accent underline">
      Import CSV
      <input
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
      {result && <span className="ml-2 text-muted">{result}</span>}
    </label>
  );
}
