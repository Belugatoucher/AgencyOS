import { defineConfig } from "@playwright/test";

// Smoke test env: local Postgres/Redis, dev mailbox for magic links, S3 stub
// standing in for R2. Prereqs: `pnpm build`, `pnpm db:migrate`, `pnpm db:seed`
// (see STATUS.md). CHROMIUM_PATH overrides the browser binary when the
// environment pre-installs one (e.g. /opt/pw-browsers/chromium).
const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://agencyos@localhost:5432/agencyos",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret",
  APP_URL: "http://localhost:3000",
  DEV_MAILBOX: "1",
  R2_ENDPOINT: "http://localhost:9000",
  R2_ACCESS_KEY: "stub",
  R2_SECRET: "stub",
  R2_BUCKET: "agencyos",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1, // smoke path is stateful (dev mailbox file)
  use: {
    baseURL: "http://localhost:3000",
    ...(process.env.CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
      : {}),
  },
  webServer: [
    {
      command: "pnpm start",
      url: "http://localhost:3000/login",
      reuseExistingServer: true,
      timeout: 60_000,
      env,
    },
    {
      command: "npx tsx tests/s3-stub.ts",
      url: "http://localhost:9000",
      reuseExistingServer: true,
      timeout: 15_000,
      env,
    },
  ],
});
