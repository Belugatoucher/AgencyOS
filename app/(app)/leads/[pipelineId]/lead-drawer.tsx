"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { scoreBand, type LeadActivity, type LeadRow, type Pipeline } from "../lead-types";

type Detail = { lead: LeadRow; timeline: LeadActivity[] };
type Member = { id: string; name: string; email: string; role: string };

export function LeadDrawer({
  leadId,
  pipeline,
  onClose,
}: {
  leadId: string;
  pipeline: Pipeline;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const key = ["lead", leadId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/api/leads/${leadId}`) });
  const { data: members } = useQuery({ queryKey: ["team"], queryFn: () => api<Member[]>("/api/team") });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const note = useMutation({
    mutationFn: (body: string) =>
      api(`/api/leads/${leadId}/notes`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: invalidate,
  });
  const score = useMutation({
    mutationFn: () => api(`/api/leads/${leadId}/score`, { method: "POST" }),
  });

  const [noteText, setNoteText] = useState("");
  const [scoreMsg, setScoreMsg] = useState<string | null>(null);

  if (!data) return null;
  const { lead, timeline } = data;
  const band = scoreBand(lead.score);

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-4"
        onClick={(e) => e.stopPropagation()}
        data-testid="lead-drawer"
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">{lead.name ?? "(no name)"}</h2>
            {lead.company && <p className="text-sm text-muted">{lead.company}</p>}
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            ✕
          </button>
        </div>

        {band && (
          <div className="mb-3 rounded-md border border-border bg-background p-2 text-sm">
            <span className={band.tone}>Score {band.label}</span>
            {lead.scoreRationale && <p className="mt-1 text-xs text-muted">{lead.scoreRationale}</p>}
          </div>
        )}

        <div className="flex flex-col gap-2 text-sm">
          <Field label="Value">
            <Input
              type="number"
              defaultValue={lead.valueCents != null ? lead.valueCents / 100 : ""}
              onBlur={(e) =>
                patch.mutate({ valueCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })
              }
              className="w-full"
            />
          </Field>
          <Field label="Email">
            <Input defaultValue={lead.email ?? ""} onBlur={(e) => patch.mutate({ email: e.target.value || null })} className="w-full" />
          </Field>
          <Field label="Phone">
            <Input defaultValue={lead.phone ?? ""} onBlur={(e) => patch.mutate({ phone: e.target.value || null })} className="w-full" />
          </Field>
          <Field label="Owner">
            <Select
              value={lead.ownerId ?? ""}
              onChange={(e) => patch.mutate({ ownerId: e.target.value || null })}
              className="w-full"
              data-testid="lead-owner"
            >
              <option value="">Unassigned</option>
              {members?.filter((m) => m.role !== "client").map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Next action">
            <Input
              type="date"
              defaultValue={lead.nextActionAt ? lead.nextActionAt.slice(0, 10) : ""}
              onChange={(e) => patch.mutate({ nextActionAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className="w-full"
              data-testid="lead-next-action"
            />
          </Field>
          <Field label="Internal notes">
            <textarea
              defaultValue={lead.internalNotes ?? ""}
              onBlur={(e) => patch.mutate({ internalNotes: e.target.value || null })}
              rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
        </div>

        <div className="my-3 flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="score-lead"
            disabled={score.isPending}
            onClick={() =>
              score.mutate(undefined, {
                onSuccess: () => setScoreMsg("Scoring queued — refresh in a moment."),
                onError: (e) => setScoreMsg((e as Error).message),
              })
            }
          >
            {score.isPending ? "Queuing…" : "AI score"}
          </Button>
          {scoreMsg && <span className="text-xs text-muted">{scoreMsg}</span>}
        </div>

        <h3 className="mb-2 mt-4 text-sm font-semibold">Timeline</h3>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (noteText.trim()) {
              note.mutate(noteText);
              setNoteText("");
            }
          }}
        >
          <Input
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note"
            className="flex-1"
            data-testid="lead-note-input"
          />
          <Button type="submit" variant="outline">
            Add
          </Button>
        </form>
        <ul className="flex flex-col gap-2" data-testid="lead-timeline">
          {timeline.map((a) => (
            <li key={a.id} className="rounded-md bg-background p-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge>{a.kind.replaceAll("_", " ")}</Badge>
                <span className="text-xs text-muted">{new Date(a.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1">{describeActivity(a)}</div>
            </li>
          ))}
          {timeline.length === 0 && <li className="text-sm text-muted">No activity yet.</li>}
        </ul>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function describeActivity(a: LeadActivity): string {
  const body = a.body as Record<string, unknown>;
  if (a.kind === "stage_change") return `Moved to ${String(body.toName ?? "a new stage")}`;
  if (a.kind === "note") return String(body.text ?? "");
  return JSON.stringify(body);
}
