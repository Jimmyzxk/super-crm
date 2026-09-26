import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { normalizeEmail } from "../src/core/auth/types";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const email = normalizeEmail(process.env.DEV_ADMIN_EMAIL ?? "");
const password = process.env.DEV_ADMIN_PASSWORD ?? "";
const developmentTenantId = "00000000-0000-4000-8000-000000000001";

if (!migrationUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required");
}
if (!email || password.length < 8) {
  throw new Error("DEV_ADMIN_EMAIL and an 8+ character DEV_ADMIN_PASSWORD are required");
}
if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed must not run in production");
}

const SEED_DEV_ADVISORY_LOCK_ID = "8472910482910483";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: migrationUrl });
  try {
    await client.connect();
    await client.query("select pg_advisory_lock($1::bigint)", [SEED_DEV_ADVISORY_LOCK_ID]);
    await client.query("begin");
    const existing = await client.query<{ tenant_id: string }>(
      "select tenant_id from public.users where email = $1",
      [email],
    );
    const tenantId = existing.rows[0]?.tenant_id ?? developmentTenantId;
    await client.query(
      `insert into public.tenants (id, name)
       values ($1, '本地演示企业')
       on conflict (id) do update
       set name = excluded.name, status = 'ACTIVE', updated_at = now()`,
      [tenantId],
    );

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `insert into public.users
         (tenant_id, email, password_hash, name, role, status)
       values ($1, $2, $3, '本地管理员', 'ADMIN', 'ACTIVE')
       on conflict (email) do update
       set password_hash = excluded.password_hash,
           name = excluded.name,
           role = 'ADMIN',
           status = 'ACTIVE',
           session_version = public.users.session_version + 1,
           failed_login_count = 0,
           locked_until = null,
           updated_at = now()`,
      [tenantId, email, passwordHash],
    );

    const devAdminRes = await client.query<{ id: string }>(
      "select id from public.users where email = $1 and tenant_id = $2",
      [email, tenantId]
    );
    const devAdminId = devAdminRes.rows[0]?.id;

    // 开源版（AGPL-3.0）：合同模板库属闭源 contracts 插件，其表与种子数据不在本仓库，
    // 故开发种子不再写入 plugin_contract_templates。此处仍校验管理员行确实落库。
    if (!devAdminId) throw new Error("Failed to resolve development admin id");

    await client.query("commit");
    console.log(`Development admin ready: ${email}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [SEED_DEV_ADVISORY_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
