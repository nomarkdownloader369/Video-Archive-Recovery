import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();

export const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : (null as unknown as InstanceType<typeof Pool>);

export const db = databaseUrl
  ? drizzle(pool, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);

export * from "./schema";
