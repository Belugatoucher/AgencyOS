import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Scheduler smoke: pick an account, create a post via the composer, see it on
// the calendar. (Publish + AI draft need the worker / an API key and are
// verified separately.)

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ryan@vngrd.media";
const LINK_FILE = path.join(process.cwd(), ".dev-mail", "last-link.txt");
const run = Date.now();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
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
  throw new Error("magic link never arrived");
}

test("admin can compose a post on the calendar", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  await page.goto("/calendar");
  await page.getByTestId("calendar-account").selectOption({ index: 1 });
  await page.getByTestId("new-post").click();

  // compose a linkedin post
  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByTestId("channel-linkedin").click();
  await page.getByTestId("post-body").fill(`E2E scheduled update ${run}`);
  await page.getByTestId("save-post").click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // an instagram-only draft with no media shows a validation issue
  await page.getByTestId("channel-linkedin").click(); // toggle off
  await page.getByTestId("channel-instagram").click();
  await page.getByTestId("save-post").click();
  await expect(page.getByTestId("issues")).toContainText(/requires at least one media/);

  await page.locator("aside").getByRole("button", { name: "✕" }).click();
  // the saved post appears on the grid
  await expect(page.getByTestId("calendar-grid")).toBeVisible();
});
