import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Notes smoke: create a meeting and open its page. (Transcription + Claude
// notes need faster-whisper + an API key, so this covers the UI/CRUD path;
// the transcript→notes→tasks flow is verified separately against seeded data.)

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

test("admin can create and open a meeting", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  await page.goto("/notes");
  await page.getByTestId("notes-account").selectOption({ index: 1 });
  const title = `E2E Meeting ${run}`;
  await page.getByTestId("meeting-title").fill(title);
  await page.getByTestId("meeting-create").click();
  await expect(page.getByTestId("meetings-list").getByText(title)).toBeVisible();

  await page.getByText(title).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  // fresh meeting is in an unprocessed state until audio + pipeline run
  await expect(page.getByText(/Processing \(uploaded\)/)).toBeVisible();

  // the recorder page loads with its consent notice
  await page.goto("/record");
  await expect(page.getByText(/all-party consent/)).toBeVisible();
});
