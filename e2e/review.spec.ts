import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Review smoke: create an item, upload a version, add a comment, approve.
// Then open the minted public share link and pass the PIN gate.

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

test("admin can run the review flow and share publicly", async ({ page, context }) => {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/login");
  await page.getByPlaceholder("you@agency.com").fill(ADMIN_EMAIL);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await readMagicLink());

  await page.goto("/review");
  await page.getByTestId("review-account").selectOption({ index: 1 });
  const title = `E2E Cut ${run}`;
  await page.getByTestId("review-title").fill(title);
  await page.getByTestId("review-create").click();
  await expect(page.getByTestId("review-items").getByText(title)).toBeVisible();

  // open the item, upload a version
  await page.getByText(title).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByTestId("version-file").setInputFiles({
    name: `cut-${run}.mp4`,
    mimeType: "video/mp4",
    buffer: Buffer.from("fake mp4 bytes"),
  });
  await expect(page.getByTestId("version-chips").getByText("v1")).toBeVisible();

  // add a comment (media unavailable in this env → timestamp null, still posts)
  await page.getByTestId("comment-body").fill("Opening shot runs long");
  await page.getByTestId("comment-add").click();
  await expect(page.getByTestId("comment-rail").getByText("Opening shot runs long")).toBeVisible();

  // approve the version (no open changes → allowed)
  await page.getByTestId("approve-btn").click();
  await expect(page.getByText("Approved ✅")).toBeVisible();

  // mint a share link, then open the public page and clear the PIN gate
  await page.getByTestId("share-btn").click();
  const shareCode = page.locator("code");
  await expect(shareCode).toBeVisible();
  const shareUrl = (await shareCode.textContent())!.trim();

  const guest = await context.newPage();
  await guest.goto(shareUrl);
  await guest.getByTestId("pin-input").fill("1234");
  await guest.getByTestId("pin-submit").click();
  // guest names themselves, then sees the item
  await expect(guest.getByTestId("guest-name")).toBeVisible();
  await guest.getByTestId("guest-name").fill("Client Reviewer");
  await guest.getByTestId("guest-continue").click();
  await expect(guest.getByRole("heading", { name: title })).toBeVisible();
  await guest.close();
});
