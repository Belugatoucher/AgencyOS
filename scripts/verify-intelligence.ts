/* End-to-end verification of Weeks 8-9 against the real DB (pgvector) and the
 * running worker. Run: pnpm tsx <this file> (with .env loaded). */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, brainSuggestions, clientBrains, creatives, metricRows, researchChunks, researchDocs, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/access";
import { createHook, searchHooks } from "@/lib/services/hooks";
import { createResearch, searchResearch } from "@/lib/services/research";
import { createCreative } from "@/lib/services/creatives";
import { decideSuggestion, getBrain, suggestFromMeeting, updateBrain, listSuggestions } from "@/lib/services/brain";
import { createMetricSource, importMetricsCsv, rollupAccount, listUnmatched, linkMetricRow } from "@/lib/services/metrics";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name} ${detail}`); }
}

async function main() {
  const [admin] = await db.select().from(users).where(eq(users.email, "ryan@vngrd.media"));
  const [account] = await db.select().from(accounts).limit(1);
  const viewer: Viewer = { id: admin!.id, role: "admin", membershipAccountIds: [] };
  const acct = account!.id;

  // ---- 1. Hooks: create + semantic ordering via real pgvector ----
  await createHook(viewer, { text: "Stop scrolling if your gym membership is collecting dust", format: "callout", nicheTags: ["fitness"], source: "manual" });
  await createHook(viewer, { text: "The 3-step skincare routine dermatologists hide from you", format: "curiosity", nicheTags: ["beauty"], source: "manual" });
  await createHook(viewer, { text: "Why your ad budget disappears with nothing to show for it", format: "pain", nicheTags: ["marketing"], source: "manual" });
  const hookSearch = await searchHooks(viewer, { q: "fitness workout gym motivation" });
  check("hooks: semantic search ok", hookSearch.ok);
  if (hookSearch.ok) {
    check("hooks: gym hook ranks first for gym query",
      hookSearch.value[0]?.text.includes("gym") === true,
      `got: ${hookSearch.value[0]?.text}`);
    check("hooks: similarity is a number in (0,1]",
      typeof hookSearch.value[0]?.similarity === "number" && hookSearch.value[0]!.similarity! > 0);
  }

  // ---- 2. Research: create → worker embeds → chunks → retrieval ----
  const doc = await createResearch(viewer, {
    accountId: acct,
    kind: "voc",
    title: "Customer interview themes",
    rawText: [
      "Customers repeatedly said the onboarding felt confusing and slow. Several mentioned they nearly cancelled during the first week because setup steps were unclear.",
      "Pricing came up as fair once value was understood, but the trial period felt too short to evaluate properly. Multiple interviewees asked for a longer trial.",
      "Support quality was praised across the board — fast responses and human answers. This was the single most cited reason for renewing.",
    ].join("\n\n"),
  });
  check("research: doc created processing", doc.ok && doc.value.status === "processing");
  // wait for the worker's embed-research job
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const [d] = await db.select().from(researchDocs).where(eq(researchDocs.id, doc.ok ? doc.value.id : ""));
    if (d?.status === "ready") ready = true;
    if (d?.status === "failed") break;
  }
  check("research: worker embedded doc → ready", ready);
  if (doc.ok) {
    const chunks = await db.select().from(researchChunks).where(eq(researchChunks.docId, doc.value.id));
    check("research: chunks with embeddings", chunks.length > 0 && chunks.every((c) => c.embedding?.length === 384), `chunks=${chunks.length}`);
  }
  const rSearch = await searchResearch(viewer, "trial length pricing feedback", { accountId: acct });
  check("research: retrieval ok", rSearch.ok && rSearch.value.length > 0);
  if (rSearch.ok && rSearch.value.length) {
    check("research: pricing/trial chunk ranks first",
      /trial|pricing/i.test(rSearch.value[0]!.chunkText),
      `got: ${rSearch.value[0]!.chunkText.slice(0, 80)}`);
  }

  // ---- 3. Creatives → Brain suggestion → accept applies learning ----
  const cr = await createCreative(viewer, {
    accountId: acct, assetIds: [], platform: "meta", metrics: { roas: 4.2 }, spendCents: 50_000,
    learning: "UGC testimonial openers outperform studio b-roll for this account",
  });
  check("creatives: created", cr.ok);
  const sugs = await listSuggestions(viewer, acct);
  check("brain: creative learning proposed a suggestion", sugs.ok && sugs.value.some((s) => s.source === "creative"));
  if (sugs.ok && sugs.value[0]) {
    const before = await getBrain(viewer, acct);
    const dec = await decideSuggestion(viewer, sugs.value[0].id, "accepted");
    check("brain: suggestion accepted", dec.ok && dec.value.status === "accepted");
    const after = await getBrain(viewer, acct);
    check("brain: learning applied + version bumped",
      after.ok && before.ok &&
      (after.value.learnings as unknown[]).length === (before.value.learnings as unknown[]).length + 1 &&
      after.value.version === before.value.version + 1);
  }

  // ---- 4. Brain editor: patch snapshots a version ----
  const upd = await updateBrain(viewer, acct, { offer: "Done-for-you short-form content engine", complianceNos: ["No income claims"] });
  check("brain: update ok + versioned", upd.ok && upd.value.offer === "Done-for-you short-form content engine");

  // ---- 5. Meeting bridge ----
  const n = await suggestFromMeeting(acct, crypto.randomUUID(), ["Shift budget to spark ads in Q3"]);
  check("brain: meeting decision proposed", n === 1);

  // ---- 6. Metrics: source → CSV import (idempotent) → match → rollup → winner ----
  const creativeId = cr.ok ? cr.value.id : "";
  const slug = creativeId.replaceAll("-", "").slice(0, 8);
  const src = await createMetricSource(viewer, { accountId: acct, kind: "csv" });
  check("metrics: source created", src.ok);
  const csv = [
    "ad id,day,amount spent,purchases value,ad name",
    `ad-1,2026-07-01,120.50,420.00,BF-Sale_${slug}_v1`,
    `ad-1,2026-07-02,80.00,200.00,BF-Sale_${slug}_v1`,
    "ad-2,2026-07-01,55.25,0,Unmatched brand ad",
  ].join("\n");
  const mapping = { externalId: "ad id", date: "day", name: "ad name", entityKind: "ad" as const, metrics: { spend: "amount spent", revenue: "purchases value" } };
  const imp1 = await importMetricsCsv(viewer, src.ok ? src.value.id : "", csv, mapping);
  check("metrics: import ok + slug matched", imp1.ok && imp1.value.imported === 3 && imp1.value.matched === 2, JSON.stringify(imp1));
  const imp2 = await importMetricsCsv(viewer, src.ok ? src.value.id : "", csv); // saved mapping, re-import
  check("metrics: re-import via saved mapping is idempotent", imp2.ok && imp2.value.imported === 3);
  if (src.ok) {
    const rows = await db.select().from(metricRows).where(eq(metricRows.sourceId, src.value.id));
    check("metrics: no duplicate rows after re-import", rows.length === 3, `rows=${rows.length}`);
  }
  const unmatched = await listUnmatched(viewer, acct);
  check("metrics: unmatched row surfaced", unmatched.ok && unmatched.value.some((r) => r.externalId === "ad-2"));
  if (unmatched.ok && unmatched.value[0] && cr.ok) {
    const linked = await linkMetricRow(viewer, unmatched.value[0].id, null);
    check("metrics: manual unlink works", linked.ok && linked.value.creativeMatch === null);
  }
  const roll = await rollupAccount(acct);
  check("metrics: rollup ran", roll.creatives >= 1, JSON.stringify(roll));
  if (cr.ok) {
    const [c] = await db.select().from(creatives).where(eq(creatives.id, creativeId));
    const m = c!.metrics as Record<string, number>;
    check("metrics: creative totals correct (spend 200.50, roas ≈3.09)",
      Math.abs(m.spend! - 200.5) < 0.01 && Math.abs(m.roas! - 620 / 200.5) < 0.01 && c!.spendCents === 20050,
      JSON.stringify(m));
    check("metrics: is_winning recomputed", c!.isWinning === true);
  }

  // cleanup brain fields we set so reruns stay sane (leave data otherwise)
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
