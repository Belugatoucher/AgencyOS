import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Intelligence smoke (docs/08 + docs/09): hooks add + semantic search,
// research paste, creative log, Brain edit + suggestion queue. Chat needs an
// API key, so it's covered by the route-matrix (auth ordering) and the service
// wiring; the UI shows its error state loudly.

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

test("hooks, research, creatives, and the Brain round-trip", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  // Hooks: add one, find it by meaning. Waiting for the client select to have
  // real options proves hydration + the accounts query resolved, so controlled
  // inputs actually register fills.
  await page.goto("/intelligence");
  // generous timeout: first hit compiles the page + /api/accounts in dev
  await expect(page.getByTestId("intel-account").locator("option").nth(1)).toBeAttached({ timeout: 30_000 });
  const hookText = `Nobody talks about payroll software this way ${run}`;
  await page.getByTestId("hook-text").fill(hookText);
  await page.getByTestId("hook-format").selectOption("contrarian");
  await page.getByTestId("hook-create").click();
  await expect(page.getByTestId("hooks-list").getByText(hookText)).toBeVisible();
  await page.getByTestId("hooks-search").fill("payroll software");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("hooks-list").getByText(hookText)).toBeVisible();
  await expect(page.getByText(/% match/).first()).toBeVisible();

  // Research: paste a doc, it lands as processing (worker embeds it)
  await page.getByTestId("intel-tab-research").click();
  const docTitle = `VOC roundup ${run}`;
  await page.getByTestId("research-title").fill(docTitle);
  await page.getByTestId("research-text").fill("Customers love the fast support. Setup felt confusing at first.");
  await page.getByTestId("research-create").click();
  await expect(page.getByTestId("research-list").getByText(docTitle)).toBeVisible();

  // Creatives + Brain are per-client
  await page.getByTestId("intel-account").selectOption({ index: 1 });
  await page.getByTestId("intel-tab-creatives").click();
  const learning = `Hook-first edits win ${run}`;
  await page.getByTestId("creative-spend").fill("150");
  await page.getByTestId("creative-roas").fill("3.5");
  await page.getByTestId("creative-learning").fill(learning);
  await page.getByTestId("creative-create").click();
  await expect(page.getByTestId("creatives-list").getByText(learning)).toBeVisible();

  // Brain: the creative's learning shows up as a pending suggestion; accept it
  await page.getByTestId("intel-tab-brain").click();
  await expect(page.getByTestId("brain-suggestions").getByText(learning)).toBeVisible();
  await page
    .getByTestId("brain-suggestions")
    .locator("li", { hasText: learning })
    .getByRole("button", { name: "Accept" })
    .click();
  // accepted learning lands in the Learnings card
  await expect(page.getByText(learning).first()).toBeVisible();

  // Brain editor: patch a field, version bumps
  const heading = await page.getByText(/Client Brain \(v(\d+)\)/).textContent();
  const v = Number(heading!.match(/v(\d+)/)![1]);
  await page.getByTestId("brain-offer").fill(`Done-for-you content engine ${run}`);
  await page.getByTestId("brain-save").click();
  await expect(page.getByText(`Client Brain (v${v + 1})`)).toBeVisible();

  // Chat tab renders (model call itself needs a key; UI must load)
  await page.getByTestId("intel-tab-chat").click();
  await expect(page.getByTestId("chat-input")).toBeVisible();
});
