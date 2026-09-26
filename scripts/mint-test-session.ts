import "dotenv/config";
import { SignJWT } from "jose";
import pg from "pg";

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://salescrm:salescrm_dev@localhost:54329/salescrm" });
  await client.connect();
  const t = await client.query<{ id: string }>("select id from tenants where status='ACTIVE' limit 1");
  const tenantId = t.rows[0].id;
  await client.query("begin");
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  const u = await client.query<{ id: string; session_version: number }>(
    "select id, session_version from users where tenant_id=$1 and email='admin@example.com' limit 1", [tenantId]);
  await client.query("commit");
  await client.end();
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "");
  const token = await new SignJWT({
    userId: u.rows[0].id, tenantId, role: "ADMIN", sessionVersion: u.rows[0].session_version,
  }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(secret);
  console.log(token);
}
main();
