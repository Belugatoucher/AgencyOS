import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { isAdmin, isInternal, type Viewer } from "@/lib/access";
import { anthropic, LEAD_SCORING_MODEL, messageText } from "@/lib/ai/anthropic";
import { db } from "@/lib/db";
import {
  courses,
  files,
  kbChunks,
  lessonProgress,
  lessons,
  sops,
  tasks,
  trainingAssignments,
  users,
  type Course,
  type Lesson,
  type TrainingAssignment,
} from "@/lib/db/schema";
import { chunkText, embedTexts } from "@/lib/embeddings";
import { getQueue } from "@/lib/queues";
import { err, ok, type Result } from "@/lib/result";
import { notify } from "@/lib/services/notifications";
import type { Segment } from "@/lib/transcribe";

// Academy (docs/16): courses from videos + SOPs, assigned by role, tracked to
// completion. Everything internal — clients never see training.

export const LESSON_KINDS = ["video", "sop", "doc", "quiz"] as const;

function guard(viewer: Viewer): Result<true> {
  if (!isInternal(viewer)) return err("forbidden", "The Academy is internal");
  return ok(true);
}

// ---- Courses & lessons ----

export const courseInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).nullish(),
  audienceRoles: z.array(z.string().max(30)).max(10).default([]),
  required: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

export const quizSchema = z.object({
  pass_threshold: z.number().min(0).max(1).default(0.8),
  questions: z
    .array(
      z.object({
        q: z.string().min(1).max(1000),
        kind: z.enum(["multiple_choice", "true_false"]),
        options: z.array(z.string().max(500)).min(2).max(6),
        answer_index: z.number().int().min(0),
        evidence_ms: z.number().int().min(0).nullish(),
        evidence_anchor: z.string().max(200).nullish(),
        why: z.string().max(500).nullish(),
      }),
    )
    .min(1)
    .max(7),
});
export type Quiz = z.infer<typeof quizSchema>;

export const lessonInput = z.object({
  courseId: z.string().uuid(),
  position: z.number().int().min(0),
  title: z.string().trim().min(1).max(300),
  kind: z.enum(LESSON_KINDS),
  videoFileId: z.string().uuid().nullish(),
  sopId: z.string().uuid().nullish(),
  body: z.string().max(100_000).nullish(),
  estMinutes: z.number().int().min(1).max(600).nullish(),
  quiz: quizSchema.nullish(),
});

export async function createCourse(viewer: Viewer, input: z.infer<typeof courseInput>): Promise<Result<Course>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [row] = await db
    .insert(courses)
    .values({ ...input, description: input.description ?? null })
    .returning();
  return ok(row!);
}

export async function listCourses(viewer: Viewer): Promise<Result<(Course & { lessonCount: number })[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const rows = await db
    .select({
      course: courses,
      lessonCount: sql<number>`(select count(*) from ${lessons} where ${lessons.courseId} = ${courses.id})::int`,
    })
    .from(courses)
    .where(ne(courses.status, "archived"))
    .orderBy(asc(courses.position), asc(courses.title));
  return ok(rows.map((r) => ({ ...r.course, lessonCount: r.lessonCount })));
}

export async function publishCourse(viewer: Viewer, id: string): Promise<Result<Course>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [row] = await db.update(courses).set({ status: "published" }).where(eq(courses.id, id)).returning();
  if (!row) return err("not_found", "Course not found");
  return ok(row);
}

export async function createLesson(viewer: Viewer, input: z.infer<typeof lessonInput>): Promise<Result<Lesson>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId));
  if (!course) return err("not_found", "Course not found");
  if (input.kind === "video" && !input.videoFileId) return err("invalid", "Video lessons need a video file");
  if (input.kind === "sop" && !input.sopId) return err("invalid", "SOP lessons need a linked SOP");
  if (input.videoFileId) {
    const [file] = await db.select().from(files).where(eq(files.id, input.videoFileId));
    if (!file) return err("invalid", "Video file not found");
  }
  if (input.sopId) {
    const [sop] = await db.select().from(sops).where(eq(sops.id, input.sopId));
    if (!sop) return err("invalid", "Linked SOP not found");
  }
  const [row] = await db
    .insert(lessons)
    .values({
      courseId: input.courseId,
      position: input.position,
      title: input.title,
      kind: input.kind,
      videoFileId: input.videoFileId ?? null,
      sopId: input.sopId ?? null,
      body: input.body ?? null,
      estMinutes: input.estMinutes ?? null,
      quiz: input.quiz ?? null,
    })
    .returning();
  // Video rides the existing rails: HLS (media queue) → whisper → kb embed.
  if (row!.videoFileId) await getQueue("media").add("lesson-media", { lessonId: row!.id });
  return ok(row!);
}

export type CourseDetail = {
  course: Course;
  lessons: (Lesson & { myStatus: string; myScore: number | null })[];
};

export async function getCourse(viewer: Viewer, id: string): Promise<Result<CourseDetail>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [course] = await db.select().from(courses).where(eq(courses.id, id));
  if (!course) return err("not_found", "Course not found");
  const rows = await db
    .select({ lesson: lessons, status: lessonProgress.status, score: lessonProgress.score })
    .from(lessons)
    .leftJoin(
      lessonProgress,
      and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.userId, viewer.id)),
    )
    .where(eq(lessons.courseId, id))
    .orderBy(asc(lessons.position));
  return ok({
    course,
    lessons: rows.map((r) => ({
      ...r.lesson,
      myStatus: r.status ?? "todo",
      myScore: r.score === null || r.score === undefined ? null : Number(r.score),
    })),
  });
}

/** Worker job: chunk + embed a lesson transcript into kb_chunks (with start_ms). */
export async function embedLesson(lessonId: string): Promise<{ chunks: number }> {
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) throw new Error(`Lesson ${lessonId} not found`);
  const segments = (lesson.transcript ?? []) as Segment[];
  if (segments.length === 0) throw new Error(`Lesson ${lessonId} has no transcript`);

  // Group segments into ~chunk-sized windows, carrying the window's start_ms
  // so Notebook citations can jump to the moment in the video (docs/16).
  const windows: { startMs: number; text: string }[] = [];
  let buf: string[] = [];
  let startMs = segments[0]!.start_ms;
  for (const seg of segments) {
    if (buf.join(" ").length > 1000 && buf.length > 0) {
      windows.push({ startMs, text: buf.join(" ") });
      buf = [];
      startMs = seg.start_ms;
    }
    buf.push(seg.text);
  }
  if (buf.length) windows.push({ startMs, text: buf.join(" ") });

  const pieces = windows.flatMap((w) => chunkText(w.text).map((text) => ({ startMs: w.startMs, text })));
  const embeddings = await embedTexts(pieces.map((p) => p.text));
  await db.delete(kbChunks).where(and(eq(kbChunks.source, "lesson"), eq(kbChunks.sourceId, lessonId)));
  for (let i = 0; i < pieces.length; i++) {
    await db.insert(kbChunks).values({
      source: "lesson",
      sourceId: lessonId,
      startMs: pieces[i]!.startMs,
      chunkText: pieces[i]!.text,
      embedding: embeddings[i]!,
    });
  }
  return { chunks: pieces.length };
}

// ---- Progress & quizzes ----

/** Grade pure so it's testable: score = fraction correct. */
export function gradeQuiz(quiz: Quiz, answers: number[]): {
  score: number;
  passed: boolean;
  wrong: { index: number; evidenceMs: number | null; evidenceAnchor: string | null; why: string | null }[];
} {
  const wrong: { index: number; evidenceMs: number | null; evidenceAnchor: string | null; why: string | null }[] = [];
  quiz.questions.forEach((q, i) => {
    if (answers[i] !== q.answer_index) {
      wrong.push({
        index: i,
        evidenceMs: q.evidence_ms ?? null,
        evidenceAnchor: q.evidence_anchor ?? null,
        why: q.why ?? null,
      });
    }
  });
  const score = (quiz.questions.length - wrong.length) / quiz.questions.length;
  return { score, passed: score >= quiz.pass_threshold, wrong };
}

export async function submitQuiz(
  viewer: Viewer,
  lessonId: string,
  answers: number[],
): Promise<Result<ReturnType<typeof gradeQuiz>>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) return err("not_found", "Lesson not found");
  const quiz = quizSchema.safeParse(lesson.quiz);
  if (!quiz.success) return err("invalid", "This lesson has no quiz");
  if (answers.length !== quiz.data.questions.length) return err("invalid", "Answer every question");

  const result = gradeQuiz(quiz.data, answers);
  await db
    .insert(lessonProgress)
    .values({
      userId: viewer.id,
      lessonId,
      status: result.passed ? "done" : "in_progress",
      score: String(result.score),
      attempts: 1,
      completedAt: result.passed ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: {
        status: result.passed ? "done" : "in_progress",
        score: String(result.score),
        attempts: sql`${lessonProgress.attempts} + 1`,
        completedAt: result.passed ? new Date() : null,
      },
    });
  return ok(result);
}

/** Mark a non-quiz lesson done ("mark understood" gate for sop/doc/video). */
export async function completeLesson(viewer: Viewer, lessonId: string): Promise<Result<{ status: string }>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId));
  if (!lesson) return err("not_found", "Lesson not found");
  if (lesson.quiz) return err("invalid", "This lesson completes by passing its quiz");
  await db
    .insert(lessonProgress)
    .values({ userId: viewer.id, lessonId, status: "done", completedAt: new Date() })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: { status: "done", completedAt: new Date() },
    });
  return ok({ status: "done" });
}

// ---- Assignments (docs/16 role-based assignment) ----

export const assignmentInput = z.object({
  courseId: z.string().uuid(),
  roles: z.array(z.enum(["admin", "member"])).max(5).default([]),
  userIds: z.array(z.string().uuid()).max(50).default([]),
  dueDays: z.number().int().min(1).max(365).default(14),
});

export async function createAssignment(
  viewer: Viewer,
  input: z.infer<typeof assignmentInput>,
): Promise<Result<TrainingAssignment>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId));
  if (!course) return err("not_found", "Course not found");
  const [row] = await db.insert(trainingAssignments).values(input).returning();

  // Fire immediately for explicit users + current role holders.
  const targets = new Set(input.userIds);
  if (input.roles.length) {
    const holders = await db.select({ id: users.id }).from(users).where(inArray(users.role, input.roles));
    for (const h of holders) targets.add(h.id);
  }
  for (const userId of targets) await assignCourseToUser(userId, course.id, course.title, input.dueDays);
  return ok(row!);
}

/** Idempotent per user+course: one My-Tasks task + notification (docs/16). */
async function assignCourseToUser(userId: string, courseId: string, courseTitle: string, dueDays: number) {
  const title = `Complete course: ${courseTitle}`;
  const existing = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, userId), eq(tasks.title, title), eq(tasks.sourceId, courseId)));
  if (existing.length) return;
  await db.insert(tasks).values({
    title,
    assigneeId: userId,
    dueAt: new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000),
    source: "manual",
    sourceId: courseId,
  });
  void notify([userId], {
    kind: "course_assigned",
    body: { courseId, title: courseTitle, dueDays },
  });
}

/** Fired when a user is created/changes role (docs/16 assignment rules). */
export async function applyAssignmentsForUser(userId: string, role: string): Promise<{ assigned: number }> {
  const rules = await db
    .select({ rule: trainingAssignments, course: courses })
    .from(trainingAssignments)
    .innerJoin(courses, eq(courses.id, trainingAssignments.courseId))
    .where(eq(trainingAssignments.active, true));
  let assigned = 0;
  for (const { rule, course } of rules) {
    const roleMatch = (rule.roles ?? []).includes(role);
    const userMatch = (rule.userIds ?? []).includes(userId);
    if (!roleMatch && !userMatch) continue;
    await assignCourseToUser(userId, course.id, course.title, rule.dueDays);
    assigned++;
  }
  return { assigned };
}

// ---- Completion matrix (people × courses, docs/16) ----

export type MatrixRow = {
  userId: string;
  name: string;
  role: string;
  courses: { courseId: string; title: string; done: number; total: number }[];
};

export async function completionMatrix(viewer: Viewer): Promise<Result<MatrixRow[]>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (!isAdmin(viewer)) return err("forbidden", "The completion matrix is for managers");

  const people = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(ne(users.role, "client"));
  const publishedCourses = await db
    .select()
    .from(courses)
    .where(eq(courses.status, "published"))
    .orderBy(asc(courses.position));
  const allLessons = await db.select({ id: lessons.id, courseId: lessons.courseId }).from(lessons);
  const progress = await db.select().from(lessonProgress).where(eq(lessonProgress.status, "done"));
  const doneByUser = new Map<string, Set<string>>();
  for (const p of progress) {
    if (!doneByUser.has(p.userId)) doneByUser.set(p.userId, new Set());
    doneByUser.get(p.userId)!.add(p.lessonId);
  }

  const rows: MatrixRow[] = people.map((person) => ({
    userId: person.id,
    name: person.name,
    role: person.role,
    courses: publishedCourses.map((c) => {
      const courseLessons = allLessons.filter((l) => l.courseId === c.id);
      const done = courseLessons.filter((l) => doneByUser.get(person.id)?.has(l.id)).length;
      return { courseId: c.id, title: c.title, done, total: courseLessons.length };
    }),
  }));
  return ok(rows);
}

// ---- AI lesson/quiz draft (prompts/course-builder.md, CLAUDE.md rule 6) ----

const draftSchema = z.object({
  lesson: z.object({
    title: z.string(),
    summary: z.string(),
    chapters: z.array(z.object({ title: z.string(), start_ms: z.number() })).default([]),
    key_points: z.array(z.string()).default([]),
    linked_sop_sections: z.array(z.string()).default([]),
  }),
  quiz: quizSchema.nullable(),
});
export type LessonDraft = z.infer<typeof draftSchema>;

let cachedPrompt: string | null = null;
async function courseBuilderPrompt(): Promise<string> {
  if (cachedPrompt) return cachedPrompt;
  const md = await readFile(path.join(process.cwd(), "prompts", "course-builder.md"), "utf8");
  const match = md.match(/## System prompt\s*\n+```\n([\s\S]*?)\n```/);
  if (!match) throw new Error("Could not parse prompts/course-builder.md");
  cachedPrompt = match[1]!.trim();
  return cachedPrompt;
}

export const draftInput = z.object({
  sopId: z.string().uuid().nullish(),
  lessonId: z.string().uuid().nullish(), // transcript source
  audienceRoles: z.array(z.string().max(30)).max(10).default([]),
});

/** Draft a lesson + quiz from an SOP and/or a lesson transcript. Human edits before publish. */
export async function draftLessonContent(
  viewer: Viewer,
  input: z.infer<typeof draftInput>,
): Promise<Result<LessonDraft>> {
  const g = guard(viewer);
  if (!g.ok) return g as Result<never>;
  if (!input.sopId && !input.lessonId) return err("invalid", "Give the builder an SOP or a transcript source");

  let sopMd: string | null = null;
  let transcript: Segment[] | null = null;
  if (input.sopId) {
    const [sop] = await db.select().from(sops).where(eq(sops.id, input.sopId));
    if (!sop) return err("not_found", "SOP not found");
    sopMd = sop.body;
  }
  if (input.lessonId) {
    const [lesson] = await db.select().from(lessons).where(eq(lessons.id, input.lessonId));
    if (!lesson) return err("not_found", "Lesson not found");
    transcript = (lesson.transcript ?? null) as Segment[] | null;
    if (!transcript?.length) return err("invalid", "That lesson has no transcript yet");
  }

  const sourceType = sopMd && transcript ? "both" : sopMd ? "sop" : "transcript";
  const user = [
    `Source type: ${sourceType}`,
    `Audience roles: ${JSON.stringify(input.audienceRoles)}`,
    sopMd ?? "",
    transcript ? JSON.stringify(transcript.slice(0, 800)) : "",
  ].join("\n");

  const client = anthropic();
  const system = await courseBuilderPrompt();
  async function attempt(): Promise<LessonDraft> {
    const msg = await client.messages.create({
      model: LEAD_SCORING_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = messageText(msg).trim();
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return draftSchema.parse(JSON.parse(json));
  }
  try {
    try {
      return ok(await attempt());
    } catch {
      return ok(await attempt()); // one retry, then fail loudly (rule 6)
    }
  } catch (e) {
    return err("internal", e instanceof Error ? e.message : "Draft failed");
  }
}
