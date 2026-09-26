import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export async function checkDatabaseHealthService() {
  await db.execute(sql`select 1`);
}
