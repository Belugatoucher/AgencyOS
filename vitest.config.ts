import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "workers/**/*.test.ts"],
    // Dummy connection strings so modules that import the db/redis clients load;
    // postgres.js and ioredis connect lazily, so no real connection is opened
    // by the pure-logic unit tests.
    env: {
      DATABASE_URL: "postgresql://agencyos@localhost:5432/agencyos",
      REDIS_URL: "redis://localhost:6379",
    },
  },
});
