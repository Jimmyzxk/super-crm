import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let quotaService: typeof import("@/core/quota/service");
let leaderboardService: typeof import("@/core/workbench/leaderboard");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;
let managerId: string;
let ctxSales: TenantContext;
let ctxManager: TenantContext;

describe("销售目标配额引擎与实时工作台联动 (Sales Quota & Realtime Linkage)", () => {
  beforeAll(async () => {
    await owner.connect();
    quotaService = await import("@/core/quota/service");
    leaderboardService = await import("@/core/workbench/leaderboard");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('销售配额测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const uS = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '测试销售员', 'SALES') returning id",
      [tenantId, `quota-sales-${ts}@example.com`],
    );
    salesId = uS.rows[0].id;

    const uM = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '测试主管', 'MANAGER') returning id",
      [tenantId, `quota-mgr-${ts}@example.com`],
    );
    managerId = uM.rows[0].id;

    ctxSales = { tenantId, userId: salesId, role: "SALES" };
    ctxManager = { tenantId, userId: managerId, role: "MANAGER" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from sales_quotas where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("主管为销售员配置 2026 年 8 月目标 50 万元与 8 笔赢单", async () => {
    const quota = await quotaService.upsertSalesQuota(ctxManager, {
      userId: salesId,
      year: 2026,
      periodType: "MONTHLY",
      periodKey: "2026-M08",
      targetAmountCents: 50000000, // 50 万元
      targetDealsCount: 8,
      note: "8月年中冲刺对赌",
    });

    expect(quota.userId).toBe(salesId);
    expect(quota.targetAmountCents).toBe(50000000);
    expect(quota.targetDealsCount).toBe(8);
  });

  it("主管批量导入/批量更新多位成员目标", async () => {
    const batchRes = await quotaService.batchUpsertSalesQuotas(ctxManager, {
      quotas: [
        {
          userId: salesId,
          year: 2026,
          periodType: "MONTHLY",
          periodKey: "2026-M08",
          targetAmountCents: 60000000, // 60 万元
          targetDealsCount: 10,
        },
      ],
    });

    expect(batchRes.count).toBe(1);

    const list = await quotaService.listSalesQuotas(ctxManager, {
      year: 2026,
      periodType: "MONTHLY",
      periodKey: "2026-M08",
      userId: salesId,
    });
    expect(list[0].targetAmountCents).toBe(60000000);
  });

  it("当销售员签约一笔 30 万元商机并在途储备 120 万元商机时，目标大盘实时计算达成率、缺口与管线倍数", async () => {
    // 1. 创建客户
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '配额测试科技公司', 'ENTERPRISE', $2) returning id",
      [tenantId, salesId],
    );
    const customerId = cRes.rows[0].id;

    // 2. 创建一笔已赢单商机 30 万元 (actual_close_at 设为 2026-08-15)
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount, actual_amount, actual_close_at) values ($1, $2, $3, '30万赢单项目', 'WON', 30000000, 30000000, '2026-08-15T10:00:00Z')",
      [tenantId, customerId, salesId],
    );

    // 3. 创建两笔在途推进中商机 共 120 万元 (STAGE_DISCOVERY)
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, '在途商机A', 'DISCOVERY', 70000000)",
      [tenantId, customerId, salesId],
    );
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, '在途商机B', 'PROPOSAL', 50000000)",
      [tenantId, customerId, salesId],
    );

    // 4. 查询目标大盘
    const dashboard = await quotaService.getSalesQuotaAttainmentDashboard(ctxManager, {
      year: 2026,
      periodType: "MONTHLY",
      periodKey: "2026-M08",
    });

    const member = dashboard.members.find((m) => m.userId === salesId);
    expect(member).toBeDefined();
    expect(member?.targetAmountCents).toBe(60000000); // 60 万
    expect(member?.wonAmountCents).toBe(30000000); // 30 万已完成
    expect(member?.attainmentRate).toBe(50); // 50% 达成率
    expect(member?.quotaGapCents).toBe(30000000); // 30 万缺口
    expect(member?.openPipelineAmountCents).toBe(120000000); // 120 万在途
    // coverage ratio = 120万 / 30万 = 4.0x
    expect(member?.pipelineCoverageRatio).toBe(4.0);
  });

  it("排行榜联动：其他月份的配额不能串月冒充本月目标", async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1;
    const currentKey = `${currentYear}-M${String(currentMonthNum).padStart(2, "0")}`;

    // 先清掉当月配额（前序用例给 2026-M08 配过 60 万，本月即当前月）
    await owner.query(
      "delete from sales_quotas where tenant_id = $1 and user_id = $2 and period_key = $3",
      [tenantId, salesId, currentKey],
    );

    // 只配置"上个月"的配额 99 万（本月不配）
    const prevMonthNum = currentMonthNum === 1 ? 12 : currentMonthNum - 1;
    const prevKey = `${currentMonthNum === 1 ? currentYear - 1 : currentYear}-M${String(prevMonthNum).padStart(2, "0")}`;
    await owner.query(
      `insert into sales_quotas (tenant_id, user_id, year, period_type, period_key, target_amount_cents)
       values ($1, $2, $3, 'MONTHLY', $4, 99000000)
       on conflict (tenant_id, user_id, period_type, period_key) do update set target_amount_cents = 99000000`,
      [tenantId, salesId, currentYear, prevKey],
    );

    const board = await leaderboardService.getSalesLeaderboardService(ctxSales, "MONTHLY");
    // 本月（currentKey）无配额 → 应回落默认 20 万，而不是拿上月 99 万冒充
    expect(board.currentUserGamification.targetQuota).toBe(20000000);

    // 配置本月配额 66 万后 → 精确命中
    await owner.query(
      `insert into sales_quotas (tenant_id, user_id, year, period_type, period_key, target_amount_cents)
       values ($1, $2, $3, 'MONTHLY', $4, 66000000)
       on conflict (tenant_id, user_id, period_type, period_key) do update set target_amount_cents = 66000000`,
      [tenantId, salesId, currentYear, currentKey],
    );
    const board2 = await leaderboardService.getSalesLeaderboardService(ctxSales, "MONTHLY");
    expect(board2.currentUserGamification.targetQuota).toBe(66000000);
  });

  it("配额看板数据隔离：SALES 角色仅返回自己名下的目标、赢单和管道数据，主管看全员", async () => {
    const currentYear = new Date().getFullYear();
    await owner.query(
      `insert into sales_quotas (tenant_id, user_id, year, period_type, period_key, target_amount_cents)
       values ($1, $2, $3, 'MONTHLY', $4, 88000000)
       on conflict (tenant_id, user_id, period_type, period_key) do update set target_amount_cents = 88000000`,
      [tenantId, managerId, currentYear, `${currentYear}-M01`],
    );

    // 销售调用 dashboard -> 仅包含自己
    const salesDash = await quotaService.getSalesQuotaAttainmentDashboard(ctxSales, { year: currentYear });
    expect(salesDash.members.every((m) => m.userId === salesId)).toBe(true);

    // 主管调用 dashboard -> 包含全员
    const mgrDash = await quotaService.getSalesQuotaAttainmentDashboard(ctxManager, { year: currentYear });
    const userIds = mgrDash.members.map((m) => m.userId);
    expect(userIds).toContain(salesId);
    expect(userIds).toContain(managerId);
  });
});
