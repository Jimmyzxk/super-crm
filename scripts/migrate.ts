import "dotenv/config";
import fs from "node:fs/promises";
import pg from "pg";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_DATABASE_PASSWORD;
if (!migrationUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required");
}
if (!appPassword) {
  throw new Error("APP_DATABASE_PASSWORD is required");
}

const MIGRATION_ADVISORY_LOCK_ID = "8472910482910481";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: migrationUrl });

  try {
    await client.connect();
    // Acquire session-level advisory lock to eliminate concurrent DDL races in multi-replica / cluster deployments
    console.log("Acquiring PostgreSQL migration advisory lock...");
    await client.query("select pg_advisory_lock($1::bigint)", [MIGRATION_ADVISORY_LOCK_ID]);
    console.log("PostgreSQL migration advisory lock acquired.");

    const identity = await client.query<{ current_user: string }>("select current_user");
    if (identity.rows[0]?.current_user === "salescrm_migration") {
      throw new Error(
        "MIGRATION_DATABASE_URL must use the login-capable salescrm_admin role, not the NOLOGIN salescrm_migration role",
      );
    }
    await client.query("begin");
    await client.query(
      "do $$ begin create role salescrm; exception when duplicate_object then null; end $$",
    );
    const passwordStatement = await client.query<{ statement: string }>(
      "select format('alter role salescrm login noinherit nobypassrls password %L', $1::text) as statement",
      [appPassword],
    );
    await client.query(passwordStatement.rows[0].statement);
    await client.query(
      "do $$ begin create role salescrm_auth nologin bypassrls; exception when duplicate_object then null; end $$",
    );
    await client.query("alter role salescrm_auth nologin noinherit bypassrls");
    await client.query(
      "do $$ begin create role salescrm_migration nologin bypassrls; exception when duplicate_object then null; end $$",
    );
    await client.query(`
      do $$
      begin
        if (select oid = 10 from pg_roles where rolname = 'salescrm_migration') then
          alter role salescrm_migration nologin noinherit bypassrls;
        else
          alter role salescrm_migration nologin noinherit nosuperuser bypassrls;
        end if;
      end
      $$
    `);
    await client.query("revoke salescrm_migration from salescrm");
    await client.query(`
      do $$
      begin
        if current_user <> 'salescrm_migration' then
          execute 'grant salescrm_migration to ' || quote_ident(current_user);
        end if;
      end
      $$
    `);
    await client.query(
      "do $$ begin create role salescrm_scoring nologin bypassrls; exception when duplicate_object then null; end $$",
    );
    await client.query("alter role salescrm_scoring nologin noinherit bypassrls");
    // 开源版（AGPL-3.0）：salescrm_form_public 角色仅服务于闭源 form-capture 插件的
    // 公开表单端点（public_lookup_published_form），本仓库不再创建该角色。
    await client.query(`
      create table if not exists public.schema_migrations (
        migration_id text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const migrationDirectory = "src/db/migrations";
    const migrations = (await fs.readdir(migrationDirectory))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort()
      .map((file) => [file.replace(/\.sql$/, ""), `${migrationDirectory}/${file}`] as const);

    for (const [migrationId, file] of migrations) {
      const applied = await client.query(
        "select 1 from public.schema_migrations where migration_id = $1",
        [migrationId],
      );
      if (applied.rowCount) continue;

      // Databases created before migration tracking already contain Stage 0.
      const stageZeroExists = migrationId === "0000_stage_0"
        ? await client.query("select to_regclass('public.users') is not null as exists")
        : null;
      if (!stageZeroExists?.rows[0]?.exists) {
        const migrationSql = await fs.readFile(file, "utf8");
        const noTransaction = /^\s*-- migrate:no-transaction\b/m.test(migrationSql);
        if (noTransaction) {
          await client.query("commit");
          try {
            const statements = migrationSql
              .split(/^\s*-- migrate:statement-breakpoint\s*$/m)
              .map((statement) => statement.trim())
              .filter(Boolean);
            for (const statement of statements) {
              await client.query(statement);
            }
          } finally {
            await client.query("begin");
          }
        } else {
          await client.query(migrationSql);
        }
      }
      await client.query(
        "insert into public.schema_migrations (migration_id) values ($1)",
        [migrationId],
      );
    }
    await client.query("commit");
    console.log(`Migrations applied: ${migrations.map(([id]) => id).join(", ")}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [MIGRATION_ADVISORY_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
