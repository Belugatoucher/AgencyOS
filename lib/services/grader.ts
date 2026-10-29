import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import { graderReports, leadActivities, leads, pipelines, stages, users, type GraderReport } from "@/lib/db/schema";
import { inspectHomepage } from "@/lib/grader/inspect";
import { OFFER } from "@/lib/grader/offer";
import { grade, type Grade, type GradeInput, type MapsResult } from "@/lib/grader/score";
import { mapsConfigured, psiConfigured, runMapsGrid, runPsi } from "@/lib/grader/sources";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "@/lib/services/notifications";
import { fetchCrawler } from "@/lib/sites/adapters/fetch-crawler";
import { sslProbe } from "@/lib/sites/adapters/probes";
import { safeFetch } from "@/lib/sites/adapters/safe-fetch";
import { normalizeSiteUrl } from "@/lib/sites/pipeline";

// Website grader (docs/18 "Grader", docs/offers/web-seo.md). Three ways in:
//  - public: the /grade lead magnet — visitor's site + contact → lead in the
//    grader pipeline, report link by token, GHL webhook for follow-up.
//  - internal: grade one prospect from the Sites console.
//  - bulk: paste a prospect list; each row becomes a report to pitch with.
// The grading itself is a `sites` queue job (rule 4).

const LINK_DAYS = 120;
const CRAWL_PAGES = 15;
const BULK_MAX = 100;

const token = () => randomBytes(24).toString("base64url"); // 192-bit (audit item 1)
const expires = () => new Date(Date.now() + LINK_DAYS * 86_400_000);
export const reportUrl = (t: string) => `${(process.env.APP_URL ?? "").replace(/\/+$/, "")}/grade/${t}`;

const urlField = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .transform((v, ctx) => {
    const n = normalizeSiteUrl(v);
    if (!n.ok) {
      ctx.addIssue({ code: "custom", message: n.reason });
      return z.NEVER;
    }
    return n.url;
  });
const shortText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

// ---------- Public ----------

export const publicGradeInput = z.object({
  url: urlField,
  businessName: shortText(120),
  city: shortText(80),
  keyword: shortText(80), // "junk removal", "roofer"
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  phone: shortText(40),
  // honeypot — real people leave it empty (same posture as lead intake)
  fax: z.string().max(200).optional(),
  // attribution, for validating the offer by channel
  utm: z
    .object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(200), content: z.string().max(200) })
    .partial()
    .optional(),
});

/** Per-IP and per-site limits are applied in the route; this guards spend. */
async function underDailyCap(): Promise<boolean> {
  const cap = Number(process.env.GRADER_DAILY_CAP ?? 150);
  const since = new Date(Date.now() - 86_400_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(graderReports)
    .where(and(eq(graderReports.source, "public"), gte(graderReports.createdAt, since)));
  return (row?.n ?? 0) < cap;
}

async function graderPipeline() {
  const id = process.env.GRADER_PIPELINE_ID;
  if (!id) return null;
  const [p] = await db.select().from(pipelines).where(eq(pipelines.id, id));
  if (!p) return null;
  const [first] = await db.select().from(stages).where(eq(stages.pipelineId, p.id)).orderBy(asc(stages.position)).limit(1);
  return { pipeline: p, firstStageId: first?.id ?? null };
}

export async function requestPublicGrade(input: z.infer<typeof publicGradeInput>): Promise<Result<{ token: string }>> {
  if (input.fax) return ok({ token: token() }); // bot: pretend, store nothing
  if (!(await underDailyCap())) return err("rate_limited", "The grader is busy today. Leave your details and we'll send your report tomorrow.");

  // the lead lands first, so a failed grade still leaves a person to follow up with
  let leadId: string | null = null;
  const target = await graderPipeline();
  if (target) {
    const [lead] = await db
      .insert(leads)
      .values({
        accountId: target.pipeline.accountId ?? null,
        pipelineUuid: target.pipeline.id,
        stageUuid: target.firstStageId,
        name: input.name,
        email: input.email,
        phone: input.phone ?? null,
        company: input.businessName ?? null,
        source: input.utm?.source ? `grader:${input.utm.source}` : "grader",
        links: [{ label: "Website", url: input.url }],
      })
      .returning();
    leadId = lead!.id;
  }

  const t = token();
  const [row] = await db
    .insert(graderReports)
    .values({
      token: t,
      source: "public",
      url: input.url,
      businessName: input.businessName ?? null,
      city: input.city ?? null,
      keyword: input.keyword ?? null,
      contactName: input.name,
      contactEmail: input.email,
      contactPhone: input.phone ?? null,
      leadId,
      utm: input.utm ?? {},
      expiresAt: expires(),
    })
    .returning();
  await getQueue("sites").add("grader-run", { reportId: row!.id }, { jobId: `grade-${row!.id}` });
  return ok({ token: t });
}

/** What the public report page may show: never contact details. */
export type PublicReport = Pick<GraderReport, "status" | "url" | "businessName" | "city" | "keyword" | "score" | "letter" | "createdAt" | "finishedAt"> & {
  result: Partial<Grade>;
  maps: MapsResult | null;
  checked: { psi: boolean; maps: boolean };
  platform: string | null;
  error: string | null; // user-facing failure reason only
};

export async function getPublicReport(t: string): Promise<Result<PublicReport>> {
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(t)) return err("not_found", "This report link isn't valid.");
  const [r] = await db.select().from(graderReports).where(and(eq(graderReports.token, t), isNull(graderReports.deletedAt)));
  if (!r || r.expiresAt < new Date()) return err("not_found", "This report link has expired. Run the grader again for a fresh one.");
  if (r.status === "done") {
    await db
      .update(graderReports)
      .set({ views: sql`${graderReports.views} + 1`, lastViewedAt: new Date() })
      .where(eq(graderReports.id, r.id));
  }
  const signals = (r.signals ?? {}) as { checked?: { psi: boolean; maps: boolean }; home?: { platform?: string | null } };
  return ok({
    status: r.status,
    url: r.url,
    businessName: r.businessName,
    city: r.city,
    keyword: r.keyword,
    score: r.score,
    letter: r.letter,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    result: (r.result ?? {}) as Partial<Grade>,
    maps: (r.maps as MapsResult | null) ?? null,
    checked: signals.checked ?? { psi: false, maps: false },
    platform: signals.home?.platform ?? null,
    error: r.status === "failed" ? r.error : null,
  });
}

// ---------- Internal + bulk ----------

export const internalGradeInput = z.object({
  url: urlField,
  businessName: shortText(120),
  city: shortText(80),
  keyword: shortText(80),
});

export const bulkGradeInput = z.object({
  keyword: shortText(80),
  rows: z
    .array(z.object({ url: urlField, businessName: shortText(120), city: shortText(80) }))
    .min(1)
    .max(BULK_MAX),
});

export async function createInternalReport(viewer: Viewer, input: z.infer<typeof internalGradeInput>): Promise<Result<GraderReport>> {
  if (!isInternal(viewer)) return err("not_found", "Not found");
  const [row] = await db
    .insert(graderReports)
    .values({ token: token(), source: "internal", ...nullify(input), createdBy: viewer.id, expiresAt: expires() })
    .returning();
  await getQueue("sites").add("grader-run", { reportId: row!.id }, { jobId: `grade-${row!.id}` });
  return ok(row!);
}

export async function createBulkReports(viewer: Viewer, input: z.infer<typeof bulkGradeInput>): Promise<Result<{ batchId: string; queued: number }>> {
  if (!isInternal(viewer)) return err("not_found", "Not found");
  const batchId = randomUUID().slice(0, 8);
  const seen = new Set<string>();
  const rows = input.rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
  const inserted = await db
    .insert(graderReports)
    .values(
      rows.map((r) => ({
        token: token(),
        source: "bulk",
        batchId,
        url: r.url,
        businessName: r.businessName ?? null,
        city: r.city ?? null,
        keyword: input.keyword ?? null,
        createdBy: viewer.id,
        expiresAt: expires(),
      })),
    )
    .returning({ id: graderReports.id });
  const q = getQueue("sites");
  // spread bulk runs so one batch doesn't hammer PageSpeed / DataForSEO at once
  await Promise.all(inserted.map((r, i) => q.add("grader-run", { reportId: r.id }, { jobId: `grade-${r.id}`, delay: i * 20_000 })));
  return ok({ batchId, queued: inserted.length });
}

function nullify<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? null])) as { [K in keyof T]: Exclude<T[K], undefined> | null };
}

export const reportListQuery = z.object({
  source: z.enum(["public", "internal", "bulk"]).optional(),
  batch: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function listReports(viewer: Viewer, q: z.infer<typeof reportListQuery>) {
  if (!isInternal(viewer)) return err("not_found", "Not found") as Result<never>;
  const rows = await db
    .select({
      id: graderReports.id,
      token: graderReports.token,
      source: graderReports.source,
      batchId: graderReports.batchId,
      url: graderReports.url,
      businessName: graderReports.businessName,
      city: graderReports.city,
      contactName: graderReports.contactName,
      contactEmail: graderReports.contactEmail,
      contactPhone: graderReports.contactPhone,
      leadId: graderReports.leadId,
      utm: graderReports.utm,
      status: graderReports.status,
      score: graderReports.score,
      letter: graderReports.letter,
      result: graderReports.result,
      maps: graderReports.maps,
      error: graderReports.error,
      views: graderReports.views,
      lastViewedAt: graderReports.lastViewedAt,
      createdAt: graderReports.createdAt,
    })
    .from(graderReports)
    .where(
      and(
        isNull(graderReports.deletedAt),
        q.source ? eq(graderReports.source, q.source) : undefined,
        q.batch ? eq(graderReports.batchId, q.batch) : undefined,
      ),
    )
    .orderBy(desc(graderReports.createdAt))
    .limit(q.limit);
  return ok(rows.map((r) => ({ ...r, link: reportUrl(r.token) })));
}

export async function deleteReport(viewer: Viewer, id: string): Promise<Result<GraderReport>> {
  if (!isInternal(viewer)) return err("not_found", "Not found");
  const [row] = await db
    .update(graderReports)
    .set({ deletedAt: new Date() })
    .where(and(eq(graderReports.id, id), isNull(graderReports.deletedAt)))
    .returning();
  return row ? ok(row) : err("not_found", "Report not found");
}

export async function rerunReport(viewer: Viewer, id: string): Promise<Result<GraderReport>> {
  if (!isInternal(viewer)) return err("not_found", "Not found");
  const [row] = await db
    .update(graderReports)
    .set({ status: "queued", error: null, expiresAt: expires() })
    .where(and(eq(graderReports.id, id), isNull(graderReports.deletedAt)))
    .returning();
  if (!row) return err("not_found", "Report not found");
  await getQueue("sites").add("grader-run", { reportId: id }, { jobId: `grade-${id}-${Date.now()}` });
  return ok(row);
}

export function graderCapabilities() {
  return {
    psi: psiConfigured(),
    maps: mapsConfigured(),
    pipeline: Boolean(process.env.GRADER_PIPELINE_ID),
    ghlWebhook: Boolean(process.env.GRADER_GHL_WEBHOOK_URL),
    bookingUrl: process.env.GRADER_BOOKING_URL ?? null,
  };
}

// ---------- The job ----------

export async function runGrader(reportId: string, finalAttempt = true) {
  const [r] = await db.select().from(graderReports).where(eq(graderReports.id, reportId));
  if (!r || r.deletedAt) return { reportId, skipped: "missing" };
  if (r.status === "done") return { reportId, skipped: "done" };
  await db.update(graderReports).set({ status: "running" }).where(eq(graderReports.id, reportId));

  try {
    const home = await safeFetch(r.url, { timeoutMs: 20_000 });
    if (home.status >= 400) throw new UserFacingError(`The site answered with an error (HTTP ${home.status}). Check the address and try again.`);
    const signalsHome = inspectHomepage(home.body, home.url);

    // the rest in parallel; each part degrades on its own
    const [crawl, psi, ssl, maps] = await Promise.all([
      fetchCrawler.crawl(home.url, { maxPages: CRAWL_PAGES, timeoutMs: 15_000 }).catch(() => null),
      runPsi(home.url).catch(() => null),
      sslProbe.run({ url: home.url, hostname: new URL(home.url).hostname, siteId: "grader" }).catch(() => null),
      r.businessName && r.city && r.keyword
        ? runMapsGrid({ businessName: r.businessName, city: r.city, keyword: r.keyword, domain: new URL(home.url).hostname }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const crawlSummary = crawl
      ? {
          pages: crawl.pages.length,
          missingMeta: crawl.audit.missingMeta.length,
          thinPages: crawl.audit.thinPages.length,
          brokenLinks: crawl.audit.brokenLinks.filter((b) => b.status >= 400).length,
        }
      : { pages: 1, missingMeta: 0, thinPages: 0, brokenLinks: 0 };

    const mapsResult: MapsResult | null = maps
      ? {
          keyword: maps.keyword,
          points: maps.points,
          found: maps.found,
          avgRank: maps.avgRank,
          top3Share: maps.top3Share,
          rating: maps.rating,
          reviews: maps.reviews,
          competitor: maps.competitor,
          grid: maps.grid,
        }
      : null;

    const input: GradeInput = {
      home: signalsHome,
      fetchMs: home.ms,
      crawl: crawlSummary,
      psi,
      ssl: ssl ? { valid: ssl.status !== "fail", daysLeft: (ssl.detail.daysLeft as number | undefined) ?? null } : null,
      maps: mapsResult,
      nowYear: new Date().getUTCFullYear(),
    };
    const g = grade(input);

    await db
      .update(graderReports)
      .set({
        status: "done",
        score: g.score,
        letter: g.letter,
        result: g,
        signals: { home: signalsHome, crawl: crawlSummary, psi, ssl: input.ssl, fetchMs: home.ms, checked: { psi: Boolean(psi), maps: Boolean(mapsResult) } },
        maps: mapsResult,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(graderReports.id, reportId));

    await handoff({ ...r, score: g.score, letter: g.letter }, g);
    return { reportId, score: g.score, psi: Boolean(psi), maps: Boolean(mapsResult) };
  } catch (e) {
    const userFacing = e instanceof UserFacingError;
    if (userFacing || finalAttempt) {
      const message = userFacing ? e.message : "We couldn't reach the site. Check the address, or try again in a few minutes.";
      await db.update(graderReports).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(graderReports.id, reportId));
      return { reportId, failed: message };
    }
    await db.update(graderReports).set({ status: "queued" }).where(eq(graderReports.id, reportId));
    throw e; // transient: BullMQ retries
  }
}

class UserFacingError extends Error {}

/** After a grade: note on the lead, ping the team for public runs, and hand the contact to GHL's follow-up workflow. */
async function handoff(r: GraderReport, g: Grade) {
  const link = reportUrl(r.token);
  if (r.leadId) {
    await db.insert(leadActivities).values({
      leadId: r.leadId,
      kind: "note",
      body: { via: "grader", text: `Website grade ${g.score}/100 (${g.letter}) for ${r.url}. Top fixes: ${g.topFixes.map((f) => f.label).join("; ") || "none"}. Report: ${link}` },
    });
  }
  if (r.source === "public") {
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    await notify(
      admins.map((a) => a.id),
      {
        kind: "grader_lead",
        body: { text: `${r.contactName ?? "Someone"} graded ${r.businessName ?? r.url}: ${g.score}/100`, href: r.leadId && process.env.GRADER_PIPELINE_ID ? `/leads/${process.env.GRADER_PIPELINE_ID}` : "/sites/grader" },
        slackText: `🧾 New grader lead: ${r.contactName ?? "?"} · ${r.businessName ?? r.url} scored ${g.score}/100 (${g.letter}). ${link}`,
      },
    );
    // GHL's workflow sends the report email + follow-ups; without it, send the report ourselves
    if (process.env.GRADER_GHL_WEBHOOK_URL) {
      await postToGhl(r, g, link).catch((e) => console.error("[grader] GHL webhook failed:", e instanceof Error ? e.message : e));
    } else if (r.contactEmail) {
      await sendReportEmail(r, g, link).catch((e) => console.error("[grader] report email failed:", e instanceof Error ? e.message : e));
    }
  }
}

async function sendReportEmail(r: GraderReport, g: Grade, link: string) {
  const first = r.contactName?.split(/\s+/)[0] ?? "there";
  const fixes = g.topFixes.slice(0, 3).map((f, i) => `${i + 1}. ${f.label} — ${f.fix}`).join("\n");
  const text = [
    `Hi ${first},`,
    ``,
    `Your website (${r.url}) scored ${g.score}/100 (${g.letter}).`,
    ``,
    fixes ? `The fixes that would get you the most calls:\n${fixes}` : `It does the basics well.`,
    ``,
    `Full report: ${link}`,
    ``,
    OFFER.bookingUrl ? `If you'd like these handled for you, grab 15 minutes here: ${OFFER.bookingUrl}` : `Reply to this email if you'd like these handled for you.`,
    ``,
    `— ${OFFER.brand}`,
  ].join("\n");
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    // dev mailbox convention (same as invites); never crash the job over email
    const dir = path.join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "last-grade.txt"), `${r.contactEmail}\n${text}\n`);
    return;
  }
  await nodemailer.createTransport(smtpUrl).sendMail({
    from: process.env.EMAIL_FROM ?? `${OFFER.brand} <no-reply@localhost>`,
    to: r.contactEmail!,
    subject: `Your website grade: ${g.score}/100`,
    text,
  });
}

/**
 * GHL Inbound Webhook (Automation → Workflow → trigger "Inbound Webhook").
 * The workflow creates/updates the contact and starts the follow-up sequence
 * (docs/offers/web-seo.md). Flat keys so GHL's field mapper reads them easily.
 */
async function postToGhl(r: GraderReport, g: Grade, link: string) {
  const url = process.env.GRADER_GHL_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: r.contactName,
      first_name: r.contactName?.split(/\s+/)[0] ?? null,
      email: r.contactEmail,
      phone: r.contactPhone,
      company_name: r.businessName,
      website: r.url,
      city: r.city,
      service: r.keyword,
      grade_score: g.score,
      grade_letter: g.letter,
      grade_fix_1: g.topFixes[0]?.label ?? null,
      grade_fix_2: g.topFixes[1]?.label ?? null,
      grade_fix_3: g.topFixes[2]?.label ?? null,
      grade_report_url: link,
      source: "website-grader",
      utm_source: (r.utm as Record<string, string> | null)?.source ?? null,
      utm_campaign: (r.utm as Record<string, string> | null)?.campaign ?? null,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
