import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Tasks module smoke: create a task, open it, add a checklist item, complete
// it (checklist warning), comment, and see it move on the board.

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

test("admin can run the tasks flow", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());
  // members land on My Tasks
  await expect(page).toHaveURL(/\/tasks/);

  // create a task assigned to me so it lands in My Tasks
  const title = `E2E Task ${run}`;
  await page.getByTestId("new-task-title").fill(title);
  // pick the first real assignee (the seeded admin — this viewer)
  await page.getByTestId("new-task-assignee").selectOption({ index: 1 });
  await page.getByTestId("new-task-submit").click();
  await expect(page.getByText(title)).toBeVisible();

  // open it
  await page.getByText(title).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // add a checklist item
  await page.getByTestId("checklist-input").fill("Ship it");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("checklist").getByText("Ship it")).toBeVisible();

  // complete the task with an open checklist item → warning shown
  await page.getByTestId("task-status").selectOption("done");
  await expect(page.getByText(/unchecked checklist item/)).toBeVisible();

  // comment
  await page.getByTestId("comment-input").fill("Looks good to me");
  await page.getByTestId("comment-submit").click();
  await expect(page.getByTestId("comments").getByText("Looks good to me")).toBeVisible();

  // board shows the task in the Done column
  await page.goto("/tasks/board");
  await expect(page.getByTestId("column-done").getByText(title)).toBeVisible();

  // workload view renders
  await page.goto("/tasks/workload");
  await expect(page.getByTestId("workload")).toBeVisible();
});
