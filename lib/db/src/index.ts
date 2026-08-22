import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// The API can serve the checked-in backup catalog when no database is provisioned.
// Keep the Drizzle client available for typed imports, but never connect unless a
// real DATABASE_URL is present.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/unused",
});
export const db = drizzle(pool, { schema });

export * from "./schema";
