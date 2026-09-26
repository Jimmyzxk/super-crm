import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

// Next.js imports server modules while building routes. Connection validation
// happens when the first query opens a socket, not during module evaluation.
declare global {
  var __db_pool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  const p = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 25,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Prevent uncaught idle client errors from crashing the Node.js process
  p.on("error", (err) => {
    console.error("[db/pool] Unexpected error on idle PostgreSQL client:", err.message);
  });

  return p;
}

export const pool = globalThis.__db_pool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  globalThis.__db_pool = pool;
}

export const db = drizzle(pool, { schema });
export type Db = typeof db;

export async function closeDb(): Promise<void> {
  await pool.end();
}

