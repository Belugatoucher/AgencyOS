import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Hardening pass smoke: password sign-in end-to-end, and the paid DIY area —
// an external learner (no memberships) lands on /learn, sees ONLY their
// entitled course, and completes a lesson.

const run = Date.now();

type Fixture = { learnerEmail: string; sessionToken: string; entitledTitle: string; lockedTitle: string };
let fx: Fixture;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ?? "postgresql://agencyos@localhost:5432/agencyos", { max: 1 });

  const learnerEmail = `diy-${run}@example.com`;
  const [learner] = await sql`
    insert into users (email, name, role) values (${learnerEmail}, 'Dee Learner', 'client') returning id`;

  const [entitled] = await sql`
    insert into courses (title, status, access) values (${`DIY Ads 101 ${run}`}, 'published', 'paid') returning id`;
  await sql`
    insert into lessons (course_id, position, title, kind, body)
    values (${entitled!.id}, 1, 'Welcome to Ads 101', 'doc', 'Start here.')`;
  await sql`insert into course_entitlements (course_id, user_id) values (${entitled!.id}, ${learner!.id})`;
  await sql`
    insert into courses (title, status, access) values (${`DIY Locked ${run}`}, 'published', 'paid')`;

  const sessionToken = randomUUID();
  await sql`
    insert into sessions (session_token, user_id, expires) values (${sessionToken}, ${learner!.id}, now() + interval '1 hour')`;
  await sql.end();
  fx = { learnerEmail, sessionToken, entitledTitle: `DIY Ads 101 ${run}`, lockedTitle: `DIY Locked ${run}` };
});

test("learner sets a password via API, signs in with it via the UI", async ({ browser }) => {
  // set the password under the minted session (the normal "after first
  // magic link" path)
  const context = await browser.newContext();
  await context.addCookies([
    { name: "authjs.session-token", value: fx.sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const setRes = await context.request.post("http://localhost:3000/api/auth/password", {
    data: { password: "diy-learner-pass-123" },
  });
  expect(setRes.ok()).toBeTruthy();
  await context.close();

  // fresh browser, no session: password sign-in from the login page
  const clean = await browser.newContext();
  const page = await clean.newPage();
  await page.goto("/login");
  await page.getByTestId("pw-login-toggle").click();
  await page.getByTestId("pw-email").fill(fx.learnerEmail);
  await page.getByTestId("pw-password").fill("wrong-password-first");
  await page.getByTestId("pw-submit").click();
  await expect(page.getByText(/Wrong email or password/)).toBeVisible();

  await page.getByTestId("pw-password").fill("diy-learner-pass-123");
  await page.getByTestId("pw-submit").click();
  // no memberships → the DIY shelf
  await expect(page).toHaveURL(/\/learn/);

  // sees only the entitled course; completes its lesson
  await expect(page.getByTestId("learn-list").getByText(fx.entitledTitle)).toBeVisible();
  await expect(page.getByTestId("learn-list").getByText(fx.lockedTitle)).not.toBeVisible();
  await page.getByText(fx.entitledTitle).click();
  await expect(page.getByTestId("learn-lessons").getByText("1. Welcome to Ads 101")).toBeVisible();
  await page.getByTestId("learn-complete").click();
  await expect(page.getByTestId("learn-lessons").getByText(/✅ done/)).toBeVisible();

  // internal surfaces stay closed
  await page.goto("/academy");
  await expect(page).not.toHaveURL(/\/academy/);
  await clean.close();
});
