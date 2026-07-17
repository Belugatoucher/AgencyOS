import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Weeks 11-12 smoke: SOP authoring + publish, course + lesson + quiz flow,
// completion matrix, notebook panel. (Embedding + retrieval quality is proven
// by scripts/verify-academy.ts against the live worker.)

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

test("SOPs, courses, quiz, matrix, notebook", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  // SOP: author + publish
  await page.goto("/sops");
  await page.getByTestId("sop-new").click();
  const sopTitle = `Weekly Report SOP ${run}`;
  await page.getByTestId("sop-title").fill(sopTitle);
  await page.getByTestId("sop-body").fill(`# Weekly Report\n\n## Gather\nPull metrics.\n\n## Send\nFriday 3pm.`);
  await page.getByTestId("sop-save").click();
  await expect(page.getByTestId("sops-list").getByText(sopTitle)).toBeVisible();
  await page
    .getByTestId("sops-list")
    .locator("li", { hasText: sopTitle })
    .getByTestId("sop-publish")
    .click();
  await expect(
    page.getByTestId("sops-list").locator("li", { hasText: sopTitle }).getByText("published"),
  ).toBeVisible();

  // Academy: course + doc lesson + mark understood
  await page.goto("/academy");
  const courseTitle = `E2E Course ${run}`;
  await page.getByTestId("course-title").fill(courseTitle);
  await page.getByTestId("course-create").click();
  const courseRow = page.getByTestId("courses-list").locator("li", { hasText: courseTitle });
  await expect(courseRow).toBeVisible();
  await courseRow.getByText(courseTitle).click();
  await page.getByTestId("lesson-title").fill("Read the intro");
  await page.getByTestId("lesson-body").fill("Welcome to the agency.");
  await page.getByTestId("lesson-add").click();
  await expect(courseRow.getByText("1. Read the intro")).toBeVisible();
  await courseRow.getByTestId("lesson-complete").click();
  await expect(courseRow.getByText(/✅ done/)).toBeVisible();

  // publish the course so it lands in the matrix
  await courseRow.getByTestId("course-publish").click();
  await expect(courseRow.getByText("published")).toBeVisible();

  // Matrix shows the completed course for the admin
  await page.getByTestId("academy-tab-matrix").click();
  await expect(page.getByTestId("matrix-table")).toBeVisible();
  const headers = await page.getByTestId("matrix-table").locator("th").allTextContents();
  expect(headers.join("|")).toContain(courseTitle);

  // Notebook panel renders and searches the kb
  await page.getByTestId("academy-tab-notebook").click();
  await expect(page.getByTestId("notebook-input")).toBeVisible();
  await page.getByTestId("notebook-input").fill("weekly report");
  await expect(page.getByTestId("kb-hits")).toBeVisible();

  // Gaps tab renders
  await page.getByTestId("academy-tab-gaps").click();
  await expect(page.getByTestId("gaps-list").or(page.getByText(/No open gaps/))).toBeVisible();
});
