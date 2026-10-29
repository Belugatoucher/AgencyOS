"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Public grader form. Posts to /api/grader (rate-limited, honeypot, SSRF-safe),
// then sends the visitor to their report, which fills in as checks finish.
export function GradeForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [utm, setUtm] = useState<Record<string, string>>({});

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const u: Record<string, string> = {};
    for (const k of ["source", "medium", "campaign", "content"]) {
      const v = p.get(`utm_${k}`);
      if (v) u[k] = v.slice(0, 200);
    }
    setUtm(u);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body = {
      url: String(f.get("url") ?? ""),
      businessName: String(f.get("businessName") ?? ""),
      city: String(f.get("city") ?? ""),
      keyword: String(f.get("keyword") ?? ""),
      name: String(f.get("name") ?? ""),
      email: String(f.get("email") ?? ""),
      phone: String(f.get("phone") ?? ""),
      fax: String(f.get("fax") ?? ""),
      utm: Object.keys(utm).length ? utm : undefined,
    };
    try {
      const res = await fetch("/api/grader", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !j.token) throw new Error(j.error ?? "Something went wrong. Try again.");
      router.push(`/grade/${j.token}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="gr-form" onSubmit={onSubmit} noValidate={false}>
      <h2 style={{ fontSize: "1.1rem" }}>Grade my website</h2>
      <label htmlFor="g-url">
        Website
        <input id="g-url" name="url" required inputMode="url" autoComplete="url" placeholder="yourbusiness.com" />
      </label>
      <div className="gr-row">
        <label htmlFor="g-biz">
          Business name
          <input id="g-biz" name="businessName" autoComplete="organization" placeholder="Granite Oak Hauling" />
        </label>
        <label htmlFor="g-city">
          Town
          <input id="g-city" name="city" autoComplete="address-level2" placeholder="Wooster, OH" />
        </label>
      </div>
      <label htmlFor="g-kw">
        Main service <span className="hint">what customers search for — needed for the Google Maps check</span>
        <input id="g-kw" name="keyword" placeholder="junk removal" />
      </label>
      <div className="gr-row">
        <label htmlFor="g-name">
          Your name
          <input id="g-name" name="name" required autoComplete="name" />
        </label>
        <label htmlFor="g-email">
          Email
          <input id="g-email" name="email" type="email" required autoComplete="email" />
        </label>
      </div>
      <label htmlFor="g-phone">
        Phone <span className="hint">optional</span>
        <input id="g-phone" name="phone" type="tel" autoComplete="tel" />
      </label>
      {/* honeypot: hidden from people, filled by bots */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="g-fax">
          Fax
          <input id="g-fax" name="fax" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <button className="gr-btn" type="submit" disabled={busy}>
        {busy ? "Starting your report…" : "Get my free grade"}
      </button>
      {error && <p className="gr-err" role="alert">{error}</p>}
      <p className="gr-small">
        We'll send you a copy of your report and follow up about your results by email, and by text if you add a phone number. Message and data rates may apply;
        reply STOP to opt out. No spam, no list selling.
      </p>
    </form>
  );
}
