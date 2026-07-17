import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { sendInviteEmail } from "@/lib/auth/invite-mail";
import { db } from "@/lib/db";
import { courseEntitlements, courses, users, type Course, type CourseEntitlement } from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";

// Paid DIY courses (db/008): an Academy section external learners can buy
// into. Access = entitlement rows; payments come later (Stripe webhook →
// same insert with source 'stripe'), manual grants ship first.

export async function isEntitled(userId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: courseEntitlements.id })
    .from(courseEntitlements)
    .where(and(eq(courseEntitlements.courseId, courseId), eq(courseEntitlements.userId, userId)));
  return rows.length > 0;
}

/**
 * Course-level access check used by the Academy services: internal users see
 * everything; external learners need an entitlement to a PUBLISHED paid
 * course. Denials are 404 — entitlement existence is not probeable.
 */
export async function canUseCourse(viewer: Viewer, courseId: string): Promise<boolean> {
  if (isInternal(viewer)) return true;
  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course || course.status !== "published" || course.access !== "paid") return false;
  return isEntitled(viewer.id, courseId);
}

export const grantInput = z.object({
  courseId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255),
});

/**
 * Manual grant (admin console): find-or-create the learner (role client — no
 * memberships, so they see nothing but /learn), entitle them, send the
 * sign-in pointer.
 */
export async function grantEntitlement(
  viewer: Viewer,
  input: z.infer<typeof grantInput>,
): Promise<Result<CourseEntitlement>> {
  if (!isInternal(viewer)) return err("forbidden", "Entitlements are managed by the team");
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId));
  if (!course) return err("not_found", "Course not found");
  if (course.access !== "paid") return err("invalid", "Only paid courses take entitlements");

  let [user] = await db.select().from(users).where(eq(users.email, input.email));
  let created = false;
  if (!user) {
    [user] = await db.insert(users).values({ email: input.email, name: "", role: "client" }).returning();
    created = true;
  }
  const [row] = await db
    .insert(courseEntitlements)
    .values({ courseId: input.courseId, userId: user!.id, grantedBy: viewer.id })
    .onConflictDoNothing()
    .returning();
  if (created) await sendInviteEmail(input.email, input.email);
  if (!row) return err("conflict", "Already entitled");
  return ok(row);
}

export async function listEntitlements(
  viewer: Viewer,
  courseId: string,
): Promise<Result<{ id: string; email: string; source: string; createdAt: Date }[]>> {
  if (!isInternal(viewer)) return err("forbidden", "Entitlements are managed by the team");
  const rows = await db
    .select({
      id: courseEntitlements.id,
      email: users.email,
      source: courseEntitlements.source,
      createdAt: courseEntitlements.createdAt,
    })
    .from(courseEntitlements)
    .innerJoin(users, eq(users.id, courseEntitlements.userId))
    .where(eq(courseEntitlements.courseId, courseId))
    .orderBy(desc(courseEntitlements.createdAt));
  return ok(rows);
}

/** The learner's shelf: published paid courses they're entitled to (internal: all). */
export async function listMyDiyCourses(viewer: Viewer): Promise<Result<Course[]>> {
  if (isInternal(viewer)) {
    return ok(
      await db
        .select()
        .from(courses)
        .where(and(eq(courses.access, "paid"), eq(courses.status, "published")))
        .orderBy(courses.position),
    );
  }
  const rows = await db
    .select({ course: courses })
    .from(courseEntitlements)
    .innerJoin(courses, eq(courses.id, courseEntitlements.courseId))
    .where(
      and(
        eq(courseEntitlements.userId, viewer.id),
        eq(courses.status, "published"),
        eq(courses.access, "paid"),
      ),
    )
    .orderBy(courses.position);
  return ok(rows.map((r) => r.course));
}
