import { eq } from "drizzle-orm";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadActivities, leads, pipelines, stages } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

// Public intake schema (audit item 6): strict Zod with size caps; a honeypot
// field ("website_url") that real users leave empty; per-IP rate limiting is
// applied in the route before this runs.
export const intakeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  message: z.string().trim().max(5000).optional(),
  // honeypot — must be empty; bots fill it
  website_url: z.string().max(0).optional(),
});

/** Resolve a pipeline by its public intake token. Null = unknown/disabled. */
export async function pipelineByIntakeToken(token: string) {
  if (!token || token.length < 20) return null;
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.intakeToken, token));
  return pipeline ?? null;
}

export async function ingestIntake(
  token: string,
  input: z.infer<typeof intakeSchema>,
): Promise<Result<{ id: string }>> {
  // honeypot tripped → pretend success, drop silently (don't tip off bots)
  if (input.website_url) return ok({ id: "dropped" });

  const pipeline = await pipelineByIntakeToken(token);
  if (!pipeline) return err("not_found", "This form is not available");

  // land in the first stage of the pipeline
  const [firstStage] = await db
    .select()
    .from(stages)
    .where(eq(stages.pipelineId, pipeline.id))
    .orderBy(asc(stages.position))
    .limit(1);

  const [lead] = await db
    .insert(leads)
    .values({
      accountId: pipeline.accountId ?? null,
      pipelineUuid: pipeline.id,
      stageUuid: firstStage?.id ?? null,
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      source: "intake",
    })
    .returning();

  if (input.message) {
    await db.insert(leadActivities).values({
      leadId: lead!.id,
      kind: "note",
      body: { text: input.message, via: "intake" },
    });
  }

  return ok({ id: lead!.id });
}

// ===== CSV import (internal, authenticated) =====

export const csvRowSchema = z.object({
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  value: z.string().trim().max(30).optional(), // parsed to cents
  source: z.string().trim().max(100).optional(),
});

// Tiny CSV parser (header row + comma split with quoted-field support). Kept
// dependency-free; imports are internal so input is semi-trusted.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.length)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); if (row.some((f) => f.length)) rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
    return obj;
  });
}

function toCents(value?: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const MAX_CSV_ROWS = 5000;

export async function importCsv(
  pipelineId: string,
  accountId: string | null,
  text: string,
): Promise<Result<{ imported: number; skipped: number }>> {
  const [firstStage] = await db
    .select()
    .from(stages)
    .where(eq(stages.pipelineId, pipelineId))
    .orderBy(asc(stages.position))
    .limit(1);

  const parsed = parseCsv(text);
  if (parsed.length === 0) return err("invalid", "No rows found in CSV");
  if (parsed.length > MAX_CSV_ROWS) return err("invalid", `CSV exceeds ${MAX_CSV_ROWS} rows`);

  let imported = 0;
  let skipped = 0;
  for (const raw of parsed) {
    const r = csvRowSchema.safeParse(raw);
    if (!r.success || (!r.data.name && !r.data.email && !r.data.company)) {
      skipped++;
      continue;
    }
    await db.insert(leads).values({
      accountId,
      pipelineUuid: pipelineId,
      stageUuid: firstStage?.id ?? null,
      name: r.data.name ?? null,
      email: r.data.email ?? null,
      phone: r.data.phone ?? null,
      company: r.data.company ?? null,
      valueCents: toCents(r.data.value),
      source: r.data.source ?? "csv",
    });
    imported++;
  }
  return ok({ imported, skipped });
}
