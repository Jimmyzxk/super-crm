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

let collaborationService: typeof import("@/core/collaboration/service");
let scheduleService: typeof import("@/core/schedule/service");
let followupService: typeof import("@/core/followup/service");
let leaderboardService: typeof import("@/core/workbench/leaderboard");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;
let managerId: string;
let salesCtx: TenantContext;
let managerCtx: TenantContext;
let opportunityId: string;
let customerId: string;

describe("销售-主管协同作战战情室、智能工作日历与实时战报 (Deal Collaboration & Calendar)", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    collaborationService = await import("@/core/collaboration/service");
    scheduleService = await import("@/core/schedule/service");
    followupService = await import("@/core/followup/service");
    leaderboardService = await import("@/core/workbench/leaderboard");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('战情室协同测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const [sRes, mRes] = await Promise.all([
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '一线销售张三', 'SALES') returning id",
        [tenantId, `sales-collab-${ts}@example.com`],
      ),
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售总监李四', 'MANAGER') returning id",
        [tenantId, `mgr-collab-${ts}@example.com`],
      ),
    ]);

    salesId = sRes.rows[0].id;
    managerId = mRes.rows[0].id;
    salesCtx = { tenantId, userId: salesId, role: "SALES" };
    managerCtx = { tenantId, userId: managerId, role: "MANAGER" };

    // 建立测试客户与商机
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, owner_user_id) values ($1, '协同测试企业A', $2) returning id",
      [tenantId, salesId],
    );
    customerId = cRes.rows[0].id;

    const oppRes = await owner.query<{ id: string }>(
      "insert into opportunities (tenant_id, customer_id, name, owner_user_id, stage, expected_amount) values ($1, $2, '协同大单项目A', $3, 'NEGOTIATION', 5000000) returning id",
      [tenantId, customerId, salesId],
    );
    opportunityId = oppRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from deal_interventions where tenant_id = $1", [tenantId]);
      await owner.query("delete from sales_schedules where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 销售可在商机详情中呼叫主管协同介入，状态变为 REQUESTED 并生成审计日志", async () => {
    const intervention = await collaborationService.requestManagerInterventionService(salesCtx, {
      opportunityId,
      interventionType: "DISCOUNT_APPROVAL",
      requestNote: "客户要求额外 85 折优惠，申请主管特批底价",
    });

    expect(intervention.id).toBeDefined();
    expect(intervention.opportunityId).toBe(opportunityId);
    expect(intervention.interventionType).toBe("DISCOUNT_APPROVAL");
    expect(intervention.status).toBe("REQUESTED");
    expect(intervention.requestNote).toBe("客户要求额外 85 折优惠，申请主管特批底价");

    const list = await collaborationService.listDealInterventionsService(salesCtx, { opportunityId });
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(intervention.id);
  });

  it("2. 主管可录入批复与指导意见并解决协同介入，状态变为 RESOLVED", async () => {
    const list = await collaborationService.listDealInterventionsService(managerCtx, { opportunityId, status: "REQUESTED" });
    expect(list.length).toBe(1);

    const targetIntervention = list[0];
    await collaborationService.resolveManagerInterventionService(managerCtx, {
      interventionId: targetIntervention.id,
      status: "RESOLVED",
      managerFeedback: "特批 88 折，附带赠送 1 年专业技术支持，若客户签约需约定付款周期 15 天内",
      coachingNotes: "若客户继续压价，可建议削减二次开发定制模块",
    });

    const updatedList = await collaborationService.listDealInterventionsService(managerCtx, { opportunityId });
    const resolved = updatedList.find((i) => i.id === targetIntervention.id);
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.managerFeedback).toContain("特批 88 折");
    expect(resolved?.coachingNotes).toContain("削减二次开发定制模块");
    expect(resolved?.resolvedAt).toBeDefined();
  });

  it("3. 协同介入赢单率 ROI 归因分析可计算有介入 vs 无介入的转化对比", async () => {
    // 将该商机推进为 WON 赢单
    await owner.query(
      "update opportunities set stage = 'WON', actual_amount = 4500000, actual_close_at = (now() at time zone 'Asia/Shanghai')::date where id = $1",
      [opportunityId],
    );

    const analytics = await collaborationService.getInterventionWinRateAnalyticsService(managerCtx);
    expect(analytics.withInterventionWonCount).toBe(1);
    expect(analytics.withInterventionTotalCount).toBe(1);
    expect(analytics.withInterventionWonRate).toBe(100);
  });

  it("4. 提交跟进记录若包含下次跟进时间，自动同步生成智能日历条目", async () => {
    const nextDate = new Date(Date.now() + 86400000 * 2); // 2 天后

    await followupService.logActivityService(salesCtx, {
      customerId,
      type: "VISIT",
      outcome: "INTERESTED",
      summary: "方案汇报完毕，客户决策委员会下周二上会",
      nextFollowUpAt: nextDate,
    });

    const schedules = await scheduleService.listSalesSchedulesService(salesCtx);
    const autoSchedule = schedules.find((s) => s.source === "AUTO_FROM_FOLLOWUP");
    expect(autoSchedule).toBeDefined();
    expect(autoSchedule?.scheduleType).toBe("VISIT");
    expect(autoSchedule?.status).toBe("PENDING");
    expect(autoSchedule?.customerId).toBe(customerId);
  });

  it("5. 支持手动创建日程、勾选完成与删除", async () => {
    const created = await scheduleService.createSalesScheduleService(salesCtx, {
      title: "下周三高层碰头会",
      scheduleType: "MEETING",
      startAt: new Date(Date.now() + 86400000 * 3),
      note: "携带最新合同草案",
    });

    expect(created.id).toBeDefined();
    expect(created.status).toBe("PENDING");

    await scheduleService.completeSalesScheduleService(salesCtx, created.id);
    const list = await scheduleService.listSalesSchedulesService(salesCtx, { status: "COMPLETED" });
    const found = list.find((s) => s.id === created.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe("COMPLETED");

    await scheduleService.deleteSalesScheduleService(salesCtx, created.id);
    const afterDelete = await scheduleService.listSalesSchedulesService(salesCtx);
    expect(afterDelete.find((s) => s.id === created.id)).toBeUndefined();
  });

  it("6. 实时战报排行榜与提成阶梯计算准确反映当期业绩与销冠", async () => {
    const leaderboard = await leaderboardService.getSalesLeaderboardService(salesCtx, "MONTHLY");

    expect(leaderboard.items.length).toBeGreaterThanOrEqual(2);
    expect(leaderboard.topGun).toBeDefined();
    expect(leaderboard.topGun?.userId).toBe(salesId);
    expect(leaderboard.topGun?.wonAmount).toBe(4500000);

    expect(leaderboard.currentUserGamification.wonAmount).toBe(4500000);
    expect(leaderboard.currentUserGamification.attainmentRate).toBeGreaterThan(0);
    expect(leaderboard.currentUserGamification.currentTierName).toBeDefined();
  });

  it("7. 战情室协同介入越权防护：非归属人禁止呼叫主管介入，教练笔记对销售脱敏", async () => {
    const uRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '无关销售小王', 'SALES') returning id",
      [tenantId, `other-collab-${Date.now()}@example.com`],
    );
    const otherSalesCtx: TenantContext = { tenantId, userId: uRes.rows[0].id, role: "SALES" };

    // 非归属销售尝试申请介入 -> 403 FORBIDDEN
    await expect(
      collaborationService.requestManagerInterventionService(otherSalesCtx, {
        opportunityId,
        interventionType: "DISCOUNT_APPROVAL",
        requestNote: "越权申请",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 销售小张查看介入列表 -> coachingNotes 对销售脱敏为 null
    const salesList = await collaborationService.listDealInterventionsService(salesCtx, { opportunityId });
    expect(salesList.length).toBeGreaterThanOrEqual(1);
    expect(salesList[0].coachingNotes).toBeNull();

    // 主管查看介入列表 -> 可见 coachingNotes
    const mgrList = await collaborationService.listDealInterventionsService(managerCtx, { opportunityId });
    expect(mgrList[0].coachingNotes).toContain("削减二次开发定制模块");
  });

  it("8. 日程服务安全校验：外键归属校验、销售防越权与 Zod 校验", async () => {
    const uRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '别组销售小赵', 'SALES') returning id",
      [tenantId, `other-sched-${Date.now()}@example.com`],
    );
    const otherSalesCtx: TenantContext = { tenantId, userId: uRes.rows[0].id, role: "SALES" };

    // 1) 不存在的外键 leadId 拦截为 NOT_FOUND
    await expect(
      scheduleService.createSalesScheduleService(salesCtx, {
        title: "跟进线索日程",
        scheduleType: "CALL",
        leadId: "00000000-0000-0000-0000-000000000000",
        startAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 2) 创建正常日程
    const mySched = await scheduleService.createSalesScheduleService(salesCtx, {
      title: "我的专属日程",
      scheduleType: "CALL",
      startAt: new Date(),
    });

    // 3) 他人越权完成/删除日程被拒
    await expect(
      scheduleService.completeSalesScheduleService(otherSalesCtx, mySched.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      scheduleService.deleteSalesScheduleService(otherSalesCtx, mySched.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 清理创建的日程
    await scheduleService.deleteSalesScheduleService(salesCtx, mySched.id);
  });
});
