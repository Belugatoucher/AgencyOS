"use client";

import { useRef, useState } from "react";
import { Badge, Button, Card, Input } from "@/components/ui";

export type ReviewComment = {
  id: string;
  body: string;
  authorId: string | null;
  guestName: string | null;
  timestampMs: number | null;
  kind: string;
  changeStatus: string | null;
  resolvedAt: string | null;
  parentId: string | null;
  createdAt: string;
};

type Media = { mime: string; mediaUrl: string | null; hlsUrl: string | null; status: string } | null;

function fmt(ms: number | null): string {
  if (ms == null) return "";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Frame-anchored review player + comment rail, shared by the internal item page
 * and the public share page. The player is a plain <video>/<img>; comment
 * timestamps come from the element's currentTime (docs/01 frame-accuracy).
 * hls.js would attach to hlsUrl when present; MVP plays the direct source.
 */
export function ReviewPlayer({
  media,
  comments,
  canComment,
  canModerate,
  onComment,
  onResolve,
  onChangeStatus,
  footer,
}: {
  media: Media;
  comments: ReviewComment[];
  canComment: boolean;
  canModerate: boolean;
  onComment: (c: { body: string; timestampMs: number | null; kind: "note" | "change" }) => void;
  onResolve?: (id: string, resolved: boolean) => void;
  onChangeStatus?: (id: string, status: "accepted" | "declined" | "done", declineReason?: string) => void;
  footer?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"note" | "change">("note");

  const isVideo = media?.mime.startsWith("video/");
  const isImage = media?.mime.startsWith("image/");

  function currentMs(): number | null {
    if (isVideo && videoRef.current) return Math.round(videoRef.current.currentTime * 1000);
    return null;
  }
  function seek(ms: number | null) {
    if (ms != null && videoRef.current) videoRef.current.currentTime = ms / 1000;
  }

  const top = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_360px]">
      <Card>
        {media?.status === "processing" && <Badge>processing…</Badge>}
        {isVideo && media?.mediaUrl ? (
          <video ref={videoRef} src={media.mediaUrl} controls className="w-full rounded-md bg-black" data-testid="review-video" />
        ) : isImage && media?.mediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.mediaUrl} alt="review" className="w-full rounded-md" />
        ) : (
          <div className="flex h-48 items-center justify-center rounded-md bg-background text-sm text-muted" data-testid="no-media">
            {media?.mediaUrl ? "Unsupported preview" : "Media unavailable in this environment"}
          </div>
        )}
        {footer && <div className="mt-3">{footer}</div>}
      </Card>

      <Card title="Comments">
        {canComment && (
          <form
            className="mb-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) {
                onComment({ body, timestampMs: currentMs(), kind });
                setBody("");
              }
            }}
          >
            <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Comment at current time" data-testid="comment-body" />
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="checkbox" checked={kind === "change"} onChange={(e) => setKind(e.target.checked ? "change" : "note")} />
                Request a change
              </label>
              <Button type="submit" data-testid="comment-add">
                Add {kind === "change" ? "change" : "comment"}
              </Button>
            </div>
          </form>
        )}
        <ul className="flex flex-col gap-2" data-testid="comment-rail">
          {top.map((c) => (
            <li key={c.id} className="rounded-md border border-border bg-background p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {c.timestampMs != null && (
                    <button className="text-xs text-accent" onClick={() => seek(c.timestampMs)}>
                      @{fmt(c.timestampMs)}
                    </button>
                  )}
                  {c.kind === "change" && <Badge>change {c.changeStatus}</Badge>}
                  {c.resolvedAt && <Badge>resolved</Badge>}
                </span>
                <span className="text-xs text-muted">{c.guestName ?? "team"}</span>
              </div>
              <div className="mt-1">{c.body}</div>
              {canModerate && (
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {c.kind === "note" && onResolve && (
                    <button className="text-muted hover:text-foreground" onClick={() => onResolve(c.id, !c.resolvedAt)}>
                      {c.resolvedAt ? "reopen" : "resolve"}
                    </button>
                  )}
                  {c.kind === "change" && onChangeStatus && c.changeStatus === "open" && (
                    <>
                      <button className="text-success" onClick={() => onChangeStatus(c.id, "accepted")}>
                        accept
                      </button>
                      <button className="text-success" onClick={() => onChangeStatus(c.id, "done")}>
                        done
                      </button>
                      <button
                        className="text-destructive"
                        onClick={() => {
                          const reason = prompt("Reason for declining this change?");
                          if (reason) onChangeStatus(c.id, "declined", reason);
                        }}
                      >
                        decline
                      </button>
                    </>
                  )}
                </div>
              )}
              {repliesOf(c.id).map((r) => (
                <div key={r.id} className="ml-3 mt-1 border-l border-border pl-2 text-xs">
                  <span className="text-muted">{r.guestName ?? "team"}:</span> {r.body}
                </div>
              ))}
            </li>
          ))}
          {top.length === 0 && <li className="text-sm text-muted">No comments yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
