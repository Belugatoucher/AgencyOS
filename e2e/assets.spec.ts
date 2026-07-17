import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Assets smoke: pick account, upload+register an asset, see it in the grid,
// create a collection.

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

test("admin can run the assets flow", async ({ page }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  await page.goto("/assets");
  await page.getByTestId("assets-account").selectOption({ index: 1 });

  // upload + register an asset
  await page.getByTestId("asset-file").setInputFiles({
    name: `logo-${run}.png`,
    mimeType: "image/png",
    buffer: Buffer.from("fake png bytes"),
  });
  await expect(page.getByTestId("asset-grid").getByText(`logo-${run}.png`)).toBeVisible();

  // create a collection
  await page.getByTestId("collection-name").fill(`Spring Shoot ${run}`);
  await page.getByTestId("collection-submit").click();
  await expect(page.getByTestId("collections-list").getByText(`Spring Shoot ${run}`)).toBeVisible();
});
