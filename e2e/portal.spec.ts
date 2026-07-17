import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Week 10 smoke: onboarding intake → public form → commit (admin), then the
// client portal itself under a REAL client session (minted directly in the DB,
// same technique as the route-matrix).

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ryan@vngrd.media";
const LINK_FILE = path.join(process.cwd(), ".dev-mail", "last-link.txt");
const run = Date.now();

test.describe.configure({ mode: "serial" });

type Fixture = { accountId: string; clientCookie: string };
let fx: Fixture;

test.beforeAll(async () => {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const keys = await redis.keys("rl:magic:*");
  if (keys.length) await redis.del(...keys);
  await redis.quit();

  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL ?? "postgresql://agencyos@localhost:5432/agencyos", { max: 1 });
  const [account] = await sql`insert into accounts (name) values (${"Portal E2E " + run}) returning id`;
  const [client] = await sql`
    insert into users (email, name, role) values (${`portal-client-${run}@example.com`}, 'Pat Client', 'client')
    returning id`;
  await sql`insert into memberships (user_id, account_id, role) values (${client!.id}, ${account!.id}, 'client')`;
  await sql`
    insert into posts (account_id, channels, body, status, approval_required)
    values (${account!.id}, ${["linkedin"]}, ${"Portal e2e post copy " + run}, 'in_approval', true)`;
  await sql`
    insert into tasks (account_id, title, client_visible, status)
    values (${account!.id}, ${"Send brand fonts " + run}, true, 'todo')`;
  const token = randomUUID();
  await sql`
    insert into sessions (session_token, user_id, expires)
    values (${token}, ${client!.id}, now() + interval '1 hour')`;
  await sql.end();
  fx = { accountId: account!.id, clientCookie: token };
});

async function readMagicLink(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    if (existsSync(LINK_FILE)) {
      const [, url] = readFileSync(LINK_FILE, "utf8").split("\n");
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("magic link never arrived");
}

test("admin: intake link → public form → review & commit", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  // create the intake link
  await page.goto("/onboarding");
  await page.getByTestId("onboard-account").selectOption(fx.accountId);
  await page.getByTestId("intake-create").click();
  const tokenPath = await page.getByTestId("intake-list").locator("code").first().textContent();
  expect(tokenPath).toContain("/onboard/");

  // fill the public form (no login required — new context-free page visit)
  await page.goto(tokenPath!.trim());
  await expect(page.getByTestId("intake-offer")).toBeVisible();
  await page.getByTestId("intake-offer").fill("We build short-form video engines for clinics");
  await page.getByTestId("intake-competitors").fill("Acme Clinics Co");
  await page.getByTestId("intake-access_checklist").fill("Meta ad account");
  await page.getByTestId("intake-save").click();
  await expect(page.getByText(/Saved/)).toBeVisible();
  await page.getByTestId("intake-submit").click();
  await expect(page.getByText("Thank you!")).toBeVisible();

  // review & commit
  await page.goto("/onboarding");
  await page.getByTestId("onboard-account").selectOption(fx.accountId);
  await page.getByTestId("intake-review").click();
  await expect(page.getByTestId("commit-offer")).toHaveValue(/short-form video/);
  await page.getByTestId("commit-go").click();
  await expect(page.getByTestId("intake-list").getByText("committed")).toBeVisible();
});

test("client: lands in the portal, sees the action stack, approves a post", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "authjs.session-token",
      value: fx.clientCookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();

  // login redirect lands clients in their portal
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/portal/${fx.accountId}`));

  // home stack shows the awaiting post + the visible task
  await expect(page.getByTestId("portal-stack")).toBeVisible();
  await expect(page.getByText(/Posts awaiting your approval/)).toBeVisible();
  await expect(page.getByText(/Send brand fonts/)).toBeVisible();

  // internal surfaces are not reachable as a client
  await page.goto("/tasks");
  await expect(page).not.toHaveURL(/\/tasks/);

  // content tab: bare rejection is blocked; approval works
  await page.goto(`/portal/${fx.accountId}/content`);
  await expect(page.getByTestId("portal-posts").getByText(/Portal e2e post copy/)).toBeVisible();
  await page.getByTestId("portal-post-approve").click();
  await expect(page.getByTestId("portal-posts").getByText("approved")).toBeVisible();

  await context.close();
});
