import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const testMigrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const testAppUrl = process.env.TEST_DATABASE_URL;
if (!testMigrationUrl || !testAppUrl) {
  throw new Error("TEST_MIGRATION_DATABASE_URL and TEST_DATABASE_URL are required");
}

const target = new URL(testMigrationUrl);
const databaseName = target.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(databaseName)) {
  throw new Error("Test database name must end with _test");
}
if (new URL(testAppUrl).pathname !== target.pathname) {
  throw new Error("Test application and migration URLs must target the same database");
}

const maintenanceUrl = new URL(testMigrationUrl);
maintenanceUrl.pathname = "/postgres";

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  try {
    await client.connect();
    const exists = await client.query("select 1 from pg_database where datname = $1", [databaseName]);
    if (!exists.rowCount) {
      await client.query(`create database "${databaseName}"`);
    }
  } finally {
    await client.end();
  }

  const migration = spawnSync("pnpm", ["db:migrate"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MIGRATION_DATABASE_URL: testMigrationUrl,
      DATABASE_URL: testAppUrl,
    },
    stdio: "inherit",
  });
  if (migration.status !== 0) process.exit(migration.status ?? 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
