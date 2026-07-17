import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { isInternal, type Viewer } from "@/lib/access";
import { sendInviteEmail } from "@/lib/auth/invite-mail";
import { db } from "@/lib/db";
import {
  courseEntitlements,
  coursePurchases,
  courses,
  users,
  type Course,
  type CourseEntitlement,
} from "@/lib/db/schema";
import { err, ok, type Result } from "@/lib/result";
import { createCheckoutSession, stripeConfigured } from "@/lib/stripe";

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

// ---- Stripe storefront (db/009) ----

export type CatalogCourse = {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  buyable: boolean; // Stripe configured
};

/** Public catalog: published paid courses WITH a price. Nothing else leaks. */
export async function listCatalog(): Promise<CatalogCourse[]> {
  const rows = await db
    .select({ id: courses.id, title: courses.title, description: courses.description, priceCents: courses.priceCents })
    .from(courses)
    .where(and(eq(courses.access, "paid"), eq(courses.status, "published")))
    .orderBy(courses.position);
  return rows
    .filter((r): r is typeof r & { priceCents: number } => r.priceCents != null && r.priceCents > 0)
    .map((r) => ({ ...r, buyable: stripeConfigured() }));
}

export const checkoutInput = z.object({
  courseId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(255).optional(), // Stripe collects it if absent
});

/** Create a Checkout Session for one catalog course. Public, rate-limited at the route. */
export async function startCheckout(
  input: z.infer<typeof checkoutInput>,
): Promise<Result<{ url: string }>> {
  if (!stripeConfigured()) return err("internal", "Payments are not configured");
  const [course] = await db.select().from(courses).where(eq(courses.id, input.courseId));
  if (!course || course.access !== "paid" || course.status !== "published" || !course.priceCents) {
    return err("not_found", "Course not found");
  }
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  try {
    const session = await createCheckoutSession({
      courseId: course.id,
      courseTitle: course.title,
      amountCents: course.priceCents,
      customerEmail: input.email,
      successUrl: `${appUrl}/learn?purchased=1`,
      cancelUrl: `${appUrl}/diy?cancelled=1`,
    });
    return ok({ url: session.url });
  } catch (e) {
    console.error("[stripe] checkout creation failed:", e);
    return err("internal", "Could not start checkout — try again shortly");
  }
}

// Shape of the webhook's checkout.session.completed object (the parts we use).
export const completedSession = z.object({
  id: z.string().min(1).max(255),
  payment_status: z.string(),
  amount_total: z.number().int().nullish(),
  metadata: z.object({ course_id: z.string().uuid() }).partial().nullish(),
  client_reference_id: z.string().uuid().nullish(),
  customer_details: z.object({ email: z.string().email().nullish() }).nullish(),
  customer_email: z.string().email().nullish(),
});
export type CompletedSession = z.infer<typeof completedSession>;

/**
 * Fulfillment (billing queue job): find-or-create the learner, grant the
 * entitlement (source stripe), record the purchase, send the sign-in pointer.
 * Idempotent on stripe_session_id — webhook retries and replays are no-ops.
 */
export async function fulfillStripeSession(session: CompletedSession): Promise<{ granted: boolean }> {
  if (session.payment_status !== "paid") throw new Error(`Session ${session.id} is not paid`);
  const courseId = session.metadata?.course_id ?? session.client_reference_id;
  if (!courseId) throw new Error(`Session ${session.id} carries no course_id`);
  const email = session.customer_details?.email ?? session.customer_email;
  if (!email) throw new Error(`Session ${session.id} carries no customer email`);

  const [course] = await db.select().from(courses).where(eq(courses.id, courseId));
  if (!course || course.access !== "paid") throw new Error(`Session ${session.id}: course ${courseId} not sellable`);

  // Idempotency gate: the purchase row's unique session id.
  const [purchase] = await db
    .insert(coursePurchases)
    .values({
      courseId,
      email: email.toLowerCase(),
      stripeSessionId: session.id,
      amountCents: session.amount_total ?? course.priceCents ?? 0,
    })
    .onConflictDoNothing()
    .returning();
  if (!purchase) return { granted: false }; // already fulfilled

  let [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  let created = false;
  if (!user) {
    [user] = await db.insert(users).values({ email: email.toLowerCase(), name: "", role: "client" }).returning();
    created = true;
  }
  await db
    .insert(courseEntitlements)
    .values({ courseId, userId: user!.id, source: "stripe" })
    .onConflictDoNothing();
  await db.update(coursePurchases).set({ userId: user!.id }).where(eq(coursePurchases.id, purchase.id));
  if (created) await sendInviteEmail(email, email);
  return { granted: true };
}
