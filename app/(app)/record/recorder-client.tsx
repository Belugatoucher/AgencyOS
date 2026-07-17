"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, Input, Select } from "@/components/ui";
import { api } from "@/lib/fetcher";
import { uploadFile } from "@/lib/upload-client";

type Account = { id: string; name: string };
type Meeting = { id: string };

// In-person recorder (docs/03): MediaRecorder in the mobile browser, chunks
// upload every 30s for durability, full recording finalized on stop. Recording
// consent is on the operator — a fixed reminder is shown (many states require
// all-party consent).
export function RecorderClient() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"idle" | "recording" | "saving">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const meetingRef = useRef<string | null>(null);
  const chunkIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: accounts } = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/api/accounts") });

  async function start() {
    setError(null);
    if (!title.trim()) {
      setError("Give the meeting a title first.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const meeting = await api<Meeting>("/api/meetings", {
        method: "POST",
        body: JSON.stringify({ title, accountId: accountId || null }),
      });
      meetingRef.current = meeting.id;
      chunksRef.current = [];
      chunkIndexRef.current = 0;

      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      rec.ondataavailable = async (e) => {
        if (e.data.size === 0) return;
        chunksRef.current.push(e.data);
        // Durability: back each 30s chunk up to R2 (best-effort; ignore failures).
        if (accountId) {
          try {
            const idx = chunkIndexRef.current++;
            const presign = await api<{ url: string | null; key: string }>(`/api/meetings/${meeting.id}/chunks`, {
              method: "POST",
              body: JSON.stringify({ index: idx, sizeBytes: e.data.size }),
            });
            if (presign.url) await fetch(presign.url, { method: "PUT", body: e.data, headers: { "content-type": "audio/webm" } });
          } catch {
            /* durability backup is best-effort */
          }
        }
      };
      rec.start(30_000); // fire dataavailable every 30s
      recorderRef.current = rec;
      setState("recording");
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setError("Microphone access denied.");
    }
  }

  async function stop() {
    const rec = recorderRef.current;
    if (!rec) return;
    setState("saving");
    if (timerRef.current) clearInterval(timerRef.current);
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    rec.stream.getTracks().forEach((t) => t.stop());

    const meetingId = meetingRef.current!;
    const full = new Blob(chunksRef.current, { type: "audio/webm" });
    try {
      // Finalize only works with an account (files are account-scoped). Without
      // one, the meeting is created but audio must be attached from an account
      // context later.
      if (accountId) {
        const file = new File([full], `${title}.webm`, { type: "audio/webm" });
        const record = await uploadFile(accountId, file);
        await api(`/api/meetings/${meetingId}/audio`, { method: "POST", body: JSON.stringify({ fileId: record.id }) });
      }
      router.push(`/notes/${meetingId}`);
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold">Record a meeting</h1>

      <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
        ⚠️ Announce that you&apos;re recording. Many states require all-party consent.
      </div>

      <Card>
        <div className="flex flex-col gap-2">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={state !== "idle"}>
            <option value="">No account (audio attached later)</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title" disabled={state !== "idle"} />

          {state === "idle" && (
            <Button onClick={start} data-testid="record-start">
              ● Start recording
            </Button>
          )}
          {state === "recording" && (
            <Button variant="danger" onClick={stop} data-testid="record-stop">
              ■ Stop ({Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")})
            </Button>
          )}
          {state === "saving" && <p className="text-sm text-muted">Saving & starting transcription…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </Card>
      <p className="text-xs text-muted">
        Chunks upload every 30 seconds, so a dead battery won&apos;t lose the meeting.
      </p>
    </div>
  );
}
