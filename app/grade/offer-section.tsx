import { money, OFFER } from "@/lib/grader/offer";

// The offer, shown under the grader and at the end of every report. Server
// component: prices and links come from lib/grader/offer.ts + env.
export function OfferSection({ context }: { context: "landing" | "report" }) {
  return (
    <section className="gr-wrap" style={{ gap: 16 }} aria-labelledby="offer-h">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="gr-eyebrow">{context === "report" ? "Want these fixed?" : "Or skip the homework"}</span>
        <h2 id="offer-h">{OFFER.headline}</h2>
        <p className="lede">
          One setup fee, then a small monthly that covers hosting, edits, and the local search work. You own the site.
        </p>
      </div>
      <div className="gr-pkgs">
        {OFFER.packages.map((p) => (
          <article key={p.id} className={`gr-sheet gr-pkg ${p.highlight ? "hl" : ""}`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h3 style={{ fontSize: "1.2rem" }}>{p.name}</h3>
              {p.highlight && <span className="gr-eyebrow">Most picked</span>}
            </div>
            <p className="gr-price">
              <b>{money(p.setup)}</b> setup · <b>{money(p.monthly)}</b>/mo
            </p>
            <p style={{ fontSize: 14, color: "var(--ink-2)" }}>{p.pitch}</p>
            <ul>
              {p.includes.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="gr-band">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <strong>{OFFER.guarantee}</strong>
          {OFFER.founding.enabled && <span className="gr-small">{OFFER.founding.line}</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {OFFER.bookingUrl && (
            <a className="gr-btn" href={OFFER.bookingUrl} target="_blank" rel="noopener">
              Book a 15-minute call
            </a>
          )}
          {OFFER.phone && (
            <span className="gr-small" style={{ alignSelf: "center" }}>
              or call <span style={{ userSelect: "all", fontFamily: "var(--mono)" }}>{OFFER.phone}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
