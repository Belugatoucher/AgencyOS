"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { api } from "@/lib/fetcher";

type Segment = { start_ms: number; end_ms: number; speaker: string; text: string };
type ActionItem = { text: string; owner_guess: string | null; due_guess: string | null; task_id: string | null };
type Detail = {
  meeting: { id: string; title: string; status: string; occurredAt: string };
  transcript: { segments: Segment[]; speakers: Record<string, string> } | null;
  notes: { summary: string | null; decisions: string[] | null; actionItems: ActionItem[] | null; followups: string[] | null } | null;
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function MeetingClient({ meetingId, title }: { meetingId: string; title: string }) {
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const key = ["meeting", meetingId];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<Detail>(`/api/meetings/${meetingId}`),
    refetchInterval: (query) => {
      const s = (query.state.data as Detail | undefined)?.meeting.status;
      return s === "ready" || s === "failed" ? false : 4000; // poll while processing
    },
  });
  const { data: audio } = useQuery({
    queryKey: ["meeting-audio", meetingId],
    queryFn: () => api<{ url: string | null; mime: string }>(`/api/meetings/${meetingId}/audio`),
    retry: false,
  });

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [taskMsg, setTaskMsg] = useState<string | null>(null);

  const makeTasks = useMutation({
    mutationFn: (indexes: number[]) =>
      api<{ created: number }>(`/api/meetings/${meetingId}/tasks`, { method: "POST", body: JSON.stringify({ indexes }) }),
    onSuccess: (r) => {
      setTaskMsg(`Created ${r.created} task(s).`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const rename = useMutation({
    mutationFn: (speakers: Record<string, string>) =>
      api(`/api/meetings/${meetingId}/speakers`, { method: "PATCH", body: JSON.stringify({ speakers }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const { meeting, transcript, notes } = data;
  const speakers = transcript?.speakers ?? {};

  function seek(ms: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      void audioRef.current.play();
    }
  }
  const speakerLabels = [...new Set((transcript?.segments ?? []).map((s) => s.speaker))];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/notes" className="text-sm text-muted hover:text-foreground">
            ← Notes
          </Link>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <Badge>{meeting.status}</Badge>
      </div>

      {audio?.url && <audio ref={audioRef} src={audio.url} controls className="w-full" data-testid="meeting-audio-player" />}

      {meeting.status !== "ready" && meeting.status !== "failed" && (
        <p className="rounded-md border border-border bg-card p-3 text-sm text-muted">
          Processing ({meeting.status})… transcript and notes appear here when ready.
        </p>
      )}
      {meeting.status === "failed" && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Processing failed. Check /admin/health, then reprocess.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {notes && (
            <Card title="Summary">
              <p className="text-sm">{notes.summary}</p>
              {notes.decisions && notes.decisions.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-muted">Decisions</h3>
                  <ul className="list-disc pl-4 text-sm">
                    {notes.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          {notes?.actionItems && notes.actionItems.length > 0 && (
            <Card
              title="Action items"
              actions={
                <Button
                  variant="outline"
                  disabled={selected.size === 0 || makeTasks.isPending}
                  onClick={() => makeTasks.mutate([...selected])}
                  data-testid="make-tasks"
                >
                  Create {selected.size || ""} task{selected.size === 1 ? "" : "s"}
                </Button>
              }
            >
              <ul className="flex flex-col gap-1" data-testid="action-items">
                {notes.actionItems.map((ai, i) => (
                  <li key={i} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-background">
                    <input
                      type="checkbox"
                      disabled={!!ai.task_id}
                      checked={selected.has(i)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setSelected(next);
                      }}
                      className="mt-1"
                    />
                    <span>
                      {ai.text}
                      {ai.due_guess && <span className="ml-2 text-xs text-warning">due {ai.due_guess}</span>}
                      {ai.task_id && <Badge>task created</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
              {taskMsg && <p className="mt-2 text-xs text-muted">{taskMsg}</p>}
            </Card>
          )}
        </div>

        <Card title="Transcript">
          {speakerLabels.length > 0 && (
            <div className="mb-3 flex flex-col gap-1">
              {speakerLabels.map((sp) => (
                <div key={sp} className="flex items-center gap-2 text-xs">
                  <span className="text-muted">{sp}</span>
                  <input
                    defaultValue={speakers[sp] ?? ""}
                    placeholder="name"
                    className="rounded border border-border bg-background px-2 py-0.5"
                    onBlur={(e) => {
                      if (e.target.value) rename.mutate({ ...speakers, [sp]: e.target.value });
                    }}
                    data-testid={`rename-${sp}`}
                  />
                </div>
              ))}
            </div>
          )}
          {transcript?.segments?.length ? (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto text-sm" data-testid="transcript">
              {transcript.segments.map((s, i) => (
                <li key={i} className="rounded-md p-1 hover:bg-background">
                  <button className="text-xs text-accent" onClick={() => seek(s.start_ms)}>
                    [{fmt(s.start_ms)}]
                  </button>{" "}
                  <span className="text-muted">{speakers[s.speaker] ?? s.speaker}:</span> {s.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No transcript yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
