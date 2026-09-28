/**
 * 重建测试库：删除并重新创建 TEST_DATABASE_URL 指向的库。
 *
 * 为什么需要它：
 *   主线与开源版的迁移集不同（开源版不含业务插件表）。两版共用同一个测试库时，
 *   在一个版本跑完测试后切到另一个版本，残留的表会与当前版本的预期冲突，表现为
 *   大量失败（例如 `relation "plugin_form_definitions" does not exist`，或
 *   「已移除的插件表确实不存在」断言失败）。
 *
 *   prepare-test-db.ts 的语义是「库不存在则建、存在则复用」，不主动清理——那会
 *   带来误删风险。因此「重建」作为切换版本时的显式动作，由本脚本承担。
 *
 * 用法：
 *   pnpm db:test:reset          # 需要 .env 中的 TEST_DATABASE_URL
 *
 * 安全约束：
 *   · 库名必须以 `_test` 结尾（与 prepare-test-db.ts 同一道闸门）
 *   · 拒绝操作名为 postgres / template* 的系统库
 */
import "dotenv/config";
import pg from "pg";

// 用迁移连接串（owner 角色）而非应用连接串：DROP/CREATE DATABASE 需要 owner
// 权限，应用角色 salescrm 没有该权限，用它执行会报 "must be owner of database"。
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!migrationUrl) {
  console.error("[reset-test-db] 缺少 TEST_MIGRATION_DATABASE_URL");
  process.exit(1);
}

const target = new URL(migrationUrl);
const dbName = target.pathname.slice(1);

if (!/^[a-z0-9_]+_test$/.test(dbName)) {
  console.error(`[reset-test-db] 拒绝操作：库名必须以 _test 结尾，当前为 "${dbName}"`);
  process.exit(1);
}

// 连接维护库执行 DROP/CREATE
const maintenance = new URL(migrationUrl);
maintenance.pathname = "/postgres";

const owner = target.username;
const client = new pg.Client({ connectionString: maintenance.toString() });

async function main(): Promise<void> {
  await client.connect();
  try {
    // 断开其他连接，否则 DROP DATABASE 会因「正在被访问」失败
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [dbName],
    );
    await client.query(`drop database if exists "${dbName}"`);
    console.log(`[reset-test-db] 已删除 ${dbName}`);
    await client.query(`create database "${dbName}" owner "${owner}"`);
    console.log(`[reset-test-db] 已创建 ${dbName}（owner: ${owner}）`);
    console.log("[reset-test-db] 下一步：pnpm test（会自动执行迁移）");
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error(`[reset-test-db] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
