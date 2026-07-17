/* End-to-end verification of Weeks 11-12 against the real DB (pgvector) and
 * the running worker. Run: pnpm tsx scripts/verify-academy.ts (with .env). */
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { kbChunks, notebookGaps, sops as sopsTable, tasks, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/access";
import { createSop, publishSop, sopStalenessSweep, promoteToSop } from "@/lib/services/sops";
import {
  applyAssignmentsForUser,
  completionMatrix,
  createAssignment,
  createCourse,
  createLesson,
  getCourse,
  publishCourse,
  submitQuiz,
  completeLesson,
} from "@/lib/services/academy";
import { listGaps, notebookGapReport, searchHandbook } from "@/lib/services/notebook";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name} ${detail}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [admin] = await db.select().from(users).where(eq(users.email, "ryan@vngrd.media"));
  const viewer: Viewer = { id: admin!.id, role: "admin", membershipAccountIds: [] };

  // ---- 1. SOP publish → worker embeds → anchored kb chunks → retrieval ----
  const sop = await createSop(viewer, {
    title: "Client Kickoff Call",
    category: "client_mgmt",
    tags: ["kickoff"],
    body: [
      "# Client Kickoff Call",
      "How we start every engagement.",
      "## Before The Call",
      "Prepare the kickoff deck, review the intake answers, and confirm the attendee list two days ahead.",
      "## During The Call",
      "Walk the roadmap, agree on the communication cadence, and capture decisions in the meeting recorder.",
      "## Naming Conventions",
      "Every ad name carries the creative id slug so the metrics matcher can attribute spend.",
    ].join("\n"),
    reviewEveryDays: 90,
  });
  check("sop: created draft", sop.ok);
  const pub = await publishSop(viewer, sop.ok ? sop.value.id : "");
  check("sop: published + versioned", pub.ok && pub.value.status === "published" && pub.value.version === 2);

  let chunks: (typeof kbChunks.$inferSelect)[] = [];
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    chunks = await db
      .select()
      .from(kbChunks)
      .where(and(eq(kbChunks.source, "sop"), eq(kbChunks.sourceId, sop.ok ? sop.value.id : "")));
    if (chunks.length) break;
  }
  check("sop: worker embedded chunks", chunks.length >= 4, `chunks=${chunks.length}`);
  check("sop: heading anchors present", chunks.some((c) => c.anchor === "naming-conventions"));

  const hits = await searchHandbook(viewer, "ad naming conventions metrics attribution");
  check("notebook: retrieval ok", hits.ok && hits.value.length > 0);
  if (hits.ok && hits.value[0]) {
    check(
      "notebook: naming-conventions section ranks first with citation",
      hits.value[0].citation.includes("#naming-conventions"),
      hits.value[0].citation,
    );
  }

  // ---- 2. Course + lessons + quiz + matrix ----
  const course = await createCourse(viewer, { title: "Agency Onboarding (verify)", required: true, audienceRoles: ["member"], position: 0 });
  check("course: created", course.ok);
  const courseId = course.ok ? course.value.id : "";
  await publishCourse(viewer, courseId);
  const docLesson = await createLesson(viewer, { courseId, position: 1, title: "Welcome", kind: "doc", body: "Read me." });
  const quizLesson = await createLesson(viewer, {
    courseId,
    position: 2,
    title: "Naming quiz",
    kind: "quiz",
    quiz: {
      pass_threshold: 0.8,
      questions: [
        { q: "Ad names carry…", kind: "multiple_choice", options: ["emoji", "the creative id slug", "dates", "nothing"], answer_index: 1, evidence_anchor: "naming-conventions" },
        { q: "The matcher depends on naming", kind: "true_false", options: ["true", "false"], answer_index: 0 },
      ],
    },
  });
  check("lessons: created", docLesson.ok && quizLesson.ok);

  const failAttempt = await submitQuiz(viewer, quizLesson.ok ? quizLesson.value.id : "", [0, 1]);
  check("quiz: failing attempt returns rewatch evidence", failAttempt.ok && !failAttempt.value.passed && failAttempt.value.wrong[0]?.evidenceAnchor === "naming-conventions");
  const passAttempt = await submitQuiz(viewer, quizLesson.ok ? quizLesson.value.id : "", [1, 0]);
  check("quiz: passing attempt completes", passAttempt.ok && passAttempt.value.passed);
  await completeLesson(viewer, docLesson.ok ? docLesson.value.id : "");
  const detail = await getCourse(viewer, courseId);
  check("progress: both lessons done", detail.ok && detail.value.lessons.every((l) => l.myStatus === "done"));

  const matrix = await completionMatrix(viewer);
  const myRow = matrix.ok ? matrix.value.find((r) => r.userId === admin!.id) : null;
  const myCourse = myRow?.courses.find((c) => c.courseId === courseId);
  check("matrix: shows 2/2 for the verifier", myCourse?.done === 2 && myCourse?.total === 2, JSON.stringify(myCourse));

  // ---- 3. Assignment rules: rule → task in My Tasks; idempotent re-fire ----
  const rule = await createAssignment(viewer, { courseId, roles: ["member"], userIds: [], dueDays: 14 });
  check("assignment: rule created", rule.ok);
  const [member] = await db.select().from(users).where(eq(users.role, "member")).limit(1);
  if (member) {
    const before = await db.select().from(tasks).where(and(eq(tasks.assigneeId, member.id), eq(tasks.sourceId, courseId)));
    check("assignment: task spawned for role holder", before.length === 1, `tasks=${before.length}`);
    await applyAssignmentsForUser(member.id, "member"); // re-fire must not duplicate
    const after = await db.select().from(tasks).where(and(eq(tasks.assigneeId, member.id), eq(tasks.sourceId, courseId)));
    check("assignment: idempotent on re-fire", after.length === 1, `tasks=${after.length}`);
  }

  // ---- 4. Staleness engine ----
  await db
    .update(sopsTable)
    .set({ lastReviewedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) })
    .where(eq(sopsTable.id, sop.ok ? sop.value.id : ""));
  const sweep = await sopStalenessSweep();
  const [afterSweep] = await db.select().from(sopsTable).where(eq(sopsTable.id, sop.ok ? sop.value.id : ""));
  check("staleness: overdue SOP flagged needs_review", sweep.flagged >= 1 && afterSweep?.status === "needs_review");

  // ---- 5. Promote-to-SOP + gaps ----
  const promoted = await promoteToSop(viewer, { source: "task", sourceId: (await db.select().from(tasks).limit(1))[0]!.id, category: "ops" });
  check("promote: task became a draft SOP", promoted.ok && promoted.value.status === "draft");
  await db.insert(notebookGaps).values({ question: "How do we handle refunds? (verify)", askedBy: admin!.id, confidence: "none" });
  const gaps = await listGaps(viewer);
  check("gaps: open gap listed", gaps.ok && gaps.value.some((g) => g.question.includes("refunds")));
  const report = await notebookGapReport();
  check("gaps: weekly report ran", report.open >= 1, JSON.stringify(report));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
