"use client";

import { useEffect, useState } from "react";

type Check = { id: string; section: string; label: string; pass: boolean; impact: number; fix: string; detail?: string };
type Section = { id: string; label: string; score: number; checks: Check[] };
type Maps = {
  keyword: string;
  points: number;
  found: boolean;
  avgRank: number | null;
  top3Share: number;
  rating: number | null;
  reviews: number | null;
  competitor: { name: string; rating: number | null; reviews: number | null; top3Share: number } | null;
  grid: { rank: number | null }[];
};
type Report = {
  status: "queued" | "running" | "done" | "failed";
  url: string;
  businessName: string | null;
  city: string | null;
  score: number | null;
  letter: string | null;
  finishedAt: string | null;
  result: { sections?: Section[]; topFixes?: Check[]; summary?: string };
  maps: Maps | null;
  checked: { psi: boolean; maps: boolean };
  platform: string | null;
  error?: string;
};

const PLATFORM: Record<string, string> = { wix: "Wix", squarespace: "Squarespace", wordpress: "WordPress", godaddy: "GoDaddy", weebly: "Weebly", shopify: "Shopify", duda: "Duda", ghl: "GoHighLevel" };
const barColor = (n: number) => (n >= 80 ? "var(--pass)" : n >= 60 ? "var(--warn)" : "var(--fail)");
const rankClass = (r: number | null) => (r == null ? "gr-rn" : r === 1 ? "gr-r1" : r <= 3 ? "gr-r2" : r <= 10 ? "gr-r3" : "gr-r4");

export function ReportClient({ token }: { token: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const res = await fetch(`/api/grader/report/${encodeURIComponent(token)}`, { cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "This report isn't available.");
        if (stop) return;
        setR(j);
        if (j.status === "queued" || j.status === "running") timer = setTimeout(load, 4000);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [token]);

  if (error) return <div className="gr-sheet"><p className="gr-err">{error}</p></div>;
  if (!r) return <div className="gr-sheet gr-wait"><span className="gr-spin" aria-hidden /> Loading your report…</div>;

  const name = r.businessName ?? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "");

  if (r.status === "queued" || r.status === "running")
    return (
      <section className="gr-sheet" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="gr-eyebrow">Grading {name}</span>
        <div className="gr-wait">
          <span className="gr-spin" aria-hidden />
          <p>Checking speed, mobile, search{r.city ? " and Google Maps" : ""}. This usually takes one to three minutes — keep this page open.</p>
        </div>
      </section>
    );

  if (r.status === "failed")
    return (
      <section className="gr-sheet" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ fontSize: "1.6rem" }}>We couldn't grade {name}</h1>
        <p>{r.error ?? "The site didn't respond. Check the address and try again."}</p>
        <a className="gr-btn" href="/grade" style={{ alignSelf: "start" }}>
          Try again
        </a>
      </section>
    );

  const sections = r.result.sections ?? [];
  const fixes = r.result.topFixes ?? [];
  const size = Math.round(Math.sqrt(r.maps?.grid.length ?? 0)) || 1;

  return (
    <>
      <section className="gr-sheet gr-stamp" aria-label="Overall grade">
        <div className={`gr-letter gr-${r.letter ?? "F"}`} aria-label={`Grade ${r.letter}, ${r.score} out of 100`}>
          <b>{r.letter}</b>
          <small>{r.score}/100</small>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <span className="gr-eyebrow">Website report{r.city ? ` · ${r.city}` : ""}</span>
          <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.4rem)", overflowWrap: "anywhere" }}>{name}</h1>
          <p className="lede">{r.result.summary}</p>
          <p className="gr-small">
            Checked {r.finishedAt ? new Date(r.finishedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "today"}
            {r.platform ? ` · built on ${PLATFORM[r.platform] ?? r.platform}` : ""}
            {!r.checked.psi ? " · speed estimated from response time" : ""}
          </p>
        </div>
      </section>

      <div className="gr-split">
        <section className="gr-sheet" aria-labelledby="meters-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="meters-h">Scores by area</h2>
          <div className="gr-meters">
            {sections.map((s) => (
              <div key={s.id} className="gr-meter">
                <span>{s.label}</span>
                <span className="gr-bar">
                  <i style={{ width: `${s.score}%`, background: barColor(s.score) }} />
                </span>
                <span className="gr-num">{s.score}</span>
              </div>
            ))}
          </div>
          {!r.checked.maps && <p className="gr-small">Google Maps wasn't checked — add your business name, town and main service to include it.</p>}
        </section>

        <section className="gr-sheet" aria-labelledby="fix-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="fix-h">{fixes.length ? "Fix these first" : "Nothing urgent"}</h2>
          {fixes.length ? (
            <ol className="gr-fixes">
              {fixes.map((f) => (
                <li key={f.id}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <strong>{f.label}</strong>
                    <span style={{ fontSize: 14 }}>{f.fix}</span>
                    {f.detail && <span className="meta">Found: {f.detail}</span>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p>The basics are covered. More service and town pages and more reviews are the next gains.</p>
          )}
        </section>
      </div>

      {r.maps && (
        <section className="gr-sheet gr-split" aria-labelledby="maps-h">
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <h2 id="maps-h">Google Maps for “{r.maps.keyword}”</h2>
            <p>
              We searched from {r.maps.points} spots around {r.city ?? "town"}.{" "}
              {r.maps.found
                ? `You're in the top 3 at ${Math.round(r.maps.top3Share * 100)}% of them${r.maps.avgRank ? `, average position ${r.maps.avgRank}` : ""}.`
                : "You didn't show up at any of them."}
            </p>
            {r.maps.competitor && (
              <p>
                <strong>{r.maps.competitor.name}</strong> is in the top 3 at {Math.round(r.maps.competitor.top3Share * 100)}% of spots
                {r.maps.competitor.reviews != null ? ` with ${r.maps.competitor.reviews} reviews` : ""}
                {r.maps.reviews != null ? ` (you have ${r.maps.reviews})` : ""}.
              </p>
            )}
            <p className="gr-small">Green = #1 · light green = top 3 · amber = 4–10 · red = below 10 · grey = not found</p>
          </div>
          <div className="gr-grid" style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }} role="img" aria-label="Map grid of your ranking at each spot">
            {r.maps.grid.map((g, i) => (
              <span key={i} className={`gr-cell ${rankClass(g.rank)}`}>
                {g.rank ?? "–"}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="gr-sheet" aria-labelledby="all-h" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="all-h">Everything we checked</h2>
        {sections.map((s) => (
          <details key={s.id} open={s.score < 70}>
            <summary style={{ cursor: "pointer", fontWeight: 600, padding: "6px 0" }}>
              {s.label} · {s.score}/100
            </summary>
            <div style={{ overflowX: "auto" }}>
              <table className="gr-detail">
                <tbody>
                  {s.checks.map((c) => (
                    <tr key={c.id}>
                      <td className={c.pass ? "gr-ok" : "gr-no"} aria-label={c.pass ? "Pass" : "Needs work"}>
                        {c.pass ? "✓" : "✕"}
                      </td>
                      <td>{c.label}</td>
                      <td>{c.detail ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
