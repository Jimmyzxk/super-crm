/**
 * 破坏性种子脚本守卫（SEED GUARD）
 *
 * 独立模块：不含任何数据库连接、不含插件依赖，导入即为纯函数，
 * 因此可以被单元测试直接 import 而无副作用（见 tests/unit/wave6-f01-seed.test.ts）。
 *
 * 放行条件（满足其一）：
 *   1. SEED_CONFIRM=yes（显式二次确认）
 *   2. 目标库同时满足 hostname ∈ {localhost, 127.0.0.1}
 *      且 dbname 含 demo / showcase / salescrm_dev / salescrm_test
 * 其余一律 fail-closed 抛错，防止误把演示数据灌进生产库。
 */
export function assertSeedAllowed(): void {
  const confirm = process.env.SEED_CONFIRM;
  if (confirm === "yes") return;
  const rawUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "";
  try {
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.toLowerCase();
    const dbname = (parsed.pathname || "").replace(/^\//, "").toLowerCase();
    const hostAllowed = hostname === "localhost" || hostname === "127.0.0.1";
    const dbAllowed = dbname.includes("demo") || dbname.includes("showcase") || dbname.includes("salescrm_dev") || dbname.includes("salescrm_test");
    if (hostAllowed && dbAllowed) return;
  } catch {
    // 解析失败则走 fail-closed，需显式确认
  }
  throw new Error(
    "[SEED GUARD] 破坏性种子脚本被拦截：目标库未命中白名单（仅 localhost/127.0.0.1 且库名含 demo/showcase/salescrm_dev/salescrm_test 放行），且未设置 SEED_CONFIRM=yes。请确认目标库为演示库后重试（export SEED_CONFIRM=yes）。"
  );
}
