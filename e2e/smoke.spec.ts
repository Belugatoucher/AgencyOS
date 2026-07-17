import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Week-1 definition of done (HANDOFF.md): log in via magic link as admin,
// create an account, invite a member, upload a file, see it in the files
// table, and see the health page.

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ryan@vngrd.media";
const LINK_FILE = path.join(process.cwd(), ".dev-mail", "last-link.txt");
const run = Date.now();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  // reset magic-link rate limits so reruns aren't throttled by earlier runs
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const keys = await redis.keys("rl:magic:*");
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

async function readMagicLink(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    if (existsSync(LINK_FILE)) {
      const [, url] = readFileSync(LINK_FILE, "utf8").split("\n");
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("magic link never arrived in .dev-mail/last-link.txt");
}

test("admin can run the whole week-1 path", async ({ page }) => {
  // --- log in via magic link
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();

  await page.goto(await readMagicLink());
  await expect(page).toHaveURL(/\/accounts/);

  // --- create an account
  const accountName = `E2E Agency ${run}`;
  await page.getByTestId("new-account-name").fill(accountName);
  await page.getByRole("button", { name: "Create account" }).click();
  const accountLink = page.getByTestId("accounts-list").getByText(accountName);
  await expect(accountLink).toBeVisible();

  // --- invite a member on the team page
  await page.goto("/team");
  await page.getByTestId("team-invite-name").fill("E2E Member");
  await page.getByTestId("team-invite-email").fill(`e2e-member-${run}@example.com`);
  await page.getByTestId("team-invite-submit").click();
  await expect(page.getByTestId("team-list").getByText(`e2e-member-${run}@example.com`)).toBeVisible();

  // --- open the account, invite a client contact
  await page.goto("/accounts");
  await page.getByText(accountName).click();
  await expect(page.getByRole("heading", { name: accountName })).toBeVisible();
  await page.getByTestId("invite-name").fill("E2E Client");
  await page.getByTestId("invite-email").fill(`e2e-client-${run}@example.com`);
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("members-list").getByText(`e2e-client-${run}@example.com`)).toBeVisible();

  // --- upload a file (browser → presigned stub → registered in files table)
  await page.getByTestId("file-input").setInputFiles({
    name: `e2e-${run}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from("agency os smoke test"),
  });
  await expect(page.getByTestId("files-list").getByText(`e2e-${run}.txt`)).toBeVisible();

  // --- health page
  await page.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "Health" })).toBeVisible();
  await expect(page.getByText("Queues")).toBeVisible();
});

test("magic links are single-use", async ({ page }) => {
  const url = await readMagicLink(); // the link consumed by the previous test
  await page.goto(url);
  await expect(page).toHaveURL(/login/); // bounced back with an error, no session
});
