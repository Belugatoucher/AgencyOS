import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { isInternal, type Viewer } from "@/lib/access";
import { db } from "@/lib/db";
import {
  accounts,
  assets,
  files,
  leads,
  meetings,
  posts,
  reviewItems,
  tasks,
  transcripts,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

// Search-everywhere (roadmap wk10 polish): one query across the modules an
// internal user lives in. Title/name ILIKE everywhere + the transcript FTS
// rail from docs/03. Internal only — clients get the portal, not the firehose.

export type SearchHit = {
  kind: "task" | "lead" | "asset" | "meeting" | "post" | "review" | "account";
  id: string;
  title: string;
  sub: string | null;
  href: string;
};

const LIMIT_PER_KIND = 5;

export async function searchEverything(viewer: Viewer, q: string): Promise<Result<SearchHit[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Search is internal");
  const needle = `%${q}%`;
  const hits: SearchHit[] = [];

  const accountRows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(ilike(accounts.name, needle), isNull(accounts.deletedAt)))
    .limit(LIMIT_PER_KIND);
  hits.push(...accountRows.map((a): SearchHit => ({ kind: "account", id: a.id, title: a.name, sub: null, href: `/accounts/${a.id}` })));

  const taskRows = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(ilike(tasks.title, needle))
    .orderBy(desc(tasks.createdAt))
    .limit(LIMIT_PER_KIND);
  hits.push(...taskRows.map((t): SearchHit => ({ kind: "task", id: t.id, title: t.title, sub: t.status, href: `/tasks/${t.id}` })));

  const leadRows = await db
    .select({ id: leads.id, name: leads.name, company: leads.company, pipelineUuid: leads.pipelineUuid })
    .from(leads)
    .where(or(ilike(leads.name, needle), ilike(leads.company, needle)))
    .orderBy(desc(leads.createdAt))
    .limit(LIMIT_PER_KIND);
  hits.push(
    ...leadRows.map(
      (l): SearchHit => ({ kind: "lead", id: l.id, title: l.name ?? "(unnamed lead)", sub: l.company, href: `/leads/${l.pipelineUuid}?lead=${l.id}` }),
    ),
  );

  const assetRows = await db
    .select({ id: assets.id, filename: files.filename, type: assets.type })
    .from(assets)
    .innerJoin(files, eq(files.id, assets.fileId))
    .where(and(ilike(files.filename, needle), sql`${assets.status} != 'archived'`))
    .orderBy(desc(assets.createdAt))
    .limit(LIMIT_PER_KIND);
  hits.push(...assetRows.map((a): SearchHit => ({ kind: "asset", id: a.id, title: a.filename, sub: a.type, href: `/assets?focus=${a.id}` })));

  // Meetings: title match OR transcript full-text (docs/03 tsv rail).
  const meetingRows = await db
    .selectDistinct({ id: meetings.id, title: meetings.title, occurredAt: meetings.occurredAt })
    .from(meetings)
    .leftJoin(transcripts, eq(transcripts.meetingId, meetings.id))
    .where(
      or(
        ilike(meetings.title, needle),
        sql`to_tsvector('english', ${transcripts.segments}::text) @@ plainto_tsquery('english', ${q})`,
      ),
    )
    .orderBy(desc(meetings.occurredAt))
    .limit(LIMIT_PER_KIND);
  hits.push(
    ...meetingRows.map(
      (m): SearchHit => ({
        kind: "meeting",
        id: m.id,
        title: m.title,
        sub: m.occurredAt.toISOString().slice(0, 10),
        href: `/notes/${m.id}`,
      }),
    ),
  );

  const postRows = await db
    .select({ id: posts.id, body: posts.body, status: posts.status })
    .from(posts)
    .where(ilike(posts.body, needle))
    .orderBy(desc(posts.createdAt))
    .limit(LIMIT_PER_KIND);
  hits.push(
    ...postRows.map(
      (p): SearchHit => ({
        kind: "post",
        id: p.id,
        title: (p.body ?? "").slice(0, 80),
        sub: p.status,
        href: `/calendar?post=${p.id}`,
      }),
    ),
  );

  const reviewRows = await db
    .select({ id: reviewItems.id, title: reviewItems.title })
    .from(reviewItems)
    .where(and(ilike(reviewItems.title, needle), isNull(reviewItems.deletedAt)))
    .orderBy(desc(reviewItems.createdAt))
    .limit(LIMIT_PER_KIND);
  hits.push(...reviewRows.map((r): SearchHit => ({ kind: "review", id: r.id, title: r.title, sub: null, href: `/review/${r.id}` })));

  return ok(hits);
}
