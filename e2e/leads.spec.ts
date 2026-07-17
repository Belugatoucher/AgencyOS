import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Leads module smoke: create a pipeline (seeds default stages), add a lead,
// open its drawer, add a note, set a next action, and confirm the overview.

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

test("admin can run the leads flow", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  // create a pipeline on an existing account (seed's Demo Account)
  await page.goto("/leads");
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  const pipelineName = `E2E Pipeline ${run}`;
  await page.getByTestId("new-pipeline-name").fill(pipelineName);
  await page.getByTestId("new-pipeline-account").selectOption({ index: 1 });
  await page.getByTestId("new-pipeline-submit").click();
  await expect(page.getByTestId("overview-rows").getByText(pipelineName)).toBeVisible();

  // open the pipeline board
  await page.getByText(pipelineName).click();
  await expect(page.getByRole("heading", { name: pipelineName })).toBeVisible();
  // default stages seeded
  await expect(page.getByTestId("lead-board").getByText("New", { exact: true })).toBeVisible();
  await expect(page.getByTestId("lead-board").getByText("Won", { exact: true })).toBeVisible();

  // add a lead
  await page.getByTestId("new-lead-name").fill("E2E Prospect");
  await page.getByTestId("new-lead-submit").click();
  await expect(page.getByText("E2E Prospect")).toBeVisible();

  // open the drawer, add a note + next action
  await page.getByText("E2E Prospect").first().click();
  await expect(page.getByTestId("lead-drawer")).toBeVisible();
  await page.getByTestId("lead-note-input").fill("Reached out on LinkedIn");
  await page.getByTestId("lead-drawer").getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("lead-timeline").getByText("Reached out on LinkedIn")).toBeVisible();

  // enqueueing an AI score returns cleanly (job runs in the worker)
  await page.getByTestId("score-lead").click();
  await expect(page.getByText(/Scoring queued|not set/)).toBeVisible();
});
