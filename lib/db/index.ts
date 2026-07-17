import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// postgres.js keeps a small pool; workers and app share this module.
const client = postgres(url, { max: 10, onnotice: () => {} });

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
