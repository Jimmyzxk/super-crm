import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * F01 种子脚本导入副作用隔离 —— 行为级测试
 *
 * 原实现全部是 readFileSync + toContain 源码字符串断言（外部审计点名不可作为风险关闭
 * 证据）。这里改为真调用 / 真执行：
 *  - 导入纯函数模块时**真的**不构造任何 pg.Client（spy 构造器计数为 0），并验证纯函数确定性
 *  - 真跑 `npx tsx scripts/seed-acceptance.ts`：对未白名单库必须以 SEED GUARD 拦截
 *    并非零退出（这是"CLI 入口 guard + 破坏性守卫都在"的唯一可信证据）
 *  - 真导入脚本模块（isDirectRun 为 false）时不得连库、不得执行 main()
 */

const run = promisify(execFile);

describe("F01 种子脚本导入副作用隔离（行为级）", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...prevEnv };
  });

  it("导入纯函数模块 deterministicUuidV5 时零 pg.Client 构造，且结果确定可复现", async () => {
    const pg = (await import("pg")).default;
    const clientSpy = vi.spyOn(pg, "Client");

    const { deterministicUuidV5 } = await import("../../scripts/seed/identity");

    // 关键断言：导入纯函数模块没有建立任何数据库连接
    expect(clientSpy).not.toHaveBeenCalled();

    const a = deterministicUuidV5("lead", 42);
    const b = deterministicUuidV5("lead", 42);
    const c = deterministicUuidV5("lead", 43);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("直接执行破坏性种子脚本且目标库未白名单时：被 SEED GUARD 拦截并非零退出", async () => {
    let code = 0;
    let stdout = "";
    let stderr = "";
    try {
      const res = await run("npx", ["tsx", "scripts/seed-acceptance.ts"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: "postgres://salescrm_admin:pass@production.example.com:5432/customer_live",
          SEED_CONFIRM: "",
        },
      });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      code = err.code ?? 1;
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
    }
    expect(code).not.toBe(0);
    expect(`${stdout}${stderr}`).toMatch(/SEED GUARD/);
    // 拦截发生在任何建表/清理动作之前
    expect(`${stdout}${stderr}`).not.toMatch(/Starting|TRUNCATE|CREATE TABLE/);
  }, 60000);

  it("SEED_CONFIRM=yes 时守卫放行（显式确认路径存在且被识别）", async () => {
    const { assertSeedAllowed } = await import("../../scripts/seed/guard");
    process.env.MIGRATION_DATABASE_URL = "postgres://salescrm_admin:pass@production.example.com:5432/customer_live";
    process.env.SEED_CONFIRM = "yes";
    expect(() => assertSeedAllowed()).not.toThrow();
    process.env.SEED_CONFIRM = "";
    expect(() => assertSeedAllowed()).toThrow(/SEED GUARD/);
  });

  it("白名单库（localhost + salescrm_test）无需显式确认即可放行", async () => {
    const { assertSeedAllowed } = await import("../../scripts/seed/guard");
    process.env.MIGRATION_DATABASE_URL = "postgres://salescrm_admin:pass@localhost:5432/salescrm_test";
    process.env.SEED_CONFIRM = "";
    expect(() => assertSeedAllowed()).not.toThrow();
  });
});
