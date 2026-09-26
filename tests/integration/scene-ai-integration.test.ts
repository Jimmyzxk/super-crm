import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import type { TenantContext } from "@/core/tenant";
import { zonedWallClock } from "@/core/shared/tz";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

describe("Wave 11: AI 场景化融入集成测试 (Scene AI Integration)", () => {
  let tenantId: string;
  let adminUserId: string;
  let salesAUserId: string;
  let salesBUserId: string;
  let adminCtx: TenantContext;
  let salesACtx: TenantContext;

  let customerId: string;
  let salesBOppId: string;

  let saveInsightReportService: typeof import("@/core/ai-hub/service").saveInsightReportService;
  let listInsightReportsService: typeof import("@/core/ai-hub/service").listInsightReportsService;
  let getInsightReportByIdService: typeof import("@/core/ai-hub/service").getInsightReportByIdService;
  let getMyRecentRecommendationsService: typeof import("@/core/ai-hub/morning-copilot-service").getMyRecentRecommendationsService;
  let getTodayMorningRecommendationsService: typeof import("@/core/ai-hub/morning-copilot-service").getTodayMorningRecommendationsService;

  let runChampionAnalysisAction: typeof import("@/core/ai-hub/actions").runChampionAnalysisAction;
  let runCompanyProfileAction: typeof import("@/core/ai-hub/actions").runCompanyProfileAction;
  let runDealAttributionAction: typeof import("@/core/ai-hub/actions").runDealAttributionAction;
  let listMyRecentRecommendationsAction: typeof import("@/core/ai-hub/actions").listMyRecentRecommendationsAction;
  let authSession: typeof import("@/core/auth/session");

  beforeAll(async () => {
    const hubService = await import("@/core/ai-hub/service");
    saveInsightReportService = hubService.saveInsightReportService;
    listInsightReportsService = hubService.listInsightReportsService;
    getInsightReportByIdService = hubService.getInsightReportByIdService;

    const morningService = await import("@/core/ai-hub/morning-copilot-service");
    getMyRecentRecommendationsService = morningService.getMyRecentRecommendationsService;
    getTodayMorningRecommendationsService = morningService.getTodayMorningRecommendationsService;

    const actions = await import("@/core/ai-hub/actions");
    runChampionAnalysisAction = actions.runChampionAnalysisAction;
    runCompanyProfileAction = actions.runCompanyProfileAction;
    runDealAttributionAction = actions.runDealAttributionAction;
    listMyRecentRecommendationsAction = actions.listMyRecentRecommendationsAction;

    authSession = await import("@/core/auth/session");

    await owner.connect();

    // 1. 初始化测试租户
    const res = await owner.query<{ id: string }>(
      `insert into tenants (name) values ('Scene AI Corp') returning id`
    );
    tenantId = res.rows[0].id;

    const rand = Math.random().toString(36).substring(7);
    const adminEmail = `admin_scene_${rand}@test.com`;
    const salesAEmail = `sales_a_scene_${rand}@test.com`;
    const salesBEmail = `sales_b_scene_${rand}@test.com`;

    // 2. 初始化用户 (ADMIN, SALES A, SALES B)
    const adminRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash)
       values ($1, $2, '主管老王', 'ADMIN', 'ACTIVE', 'hashed') returning id`,
      [tenantId, adminEmail]
    );
    adminUserId = adminRes.rows[0].id;

    const salesARes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash)
       values ($1, $2, '销售小张', 'SALES', 'ACTIVE', 'hashed') returning id`,
      [tenantId, salesAEmail]
    );
    salesAUserId = salesARes.rows[0].id;

    const salesBRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash)
       values ($1, $2, '销售小李', 'SALES', 'ACTIVE', 'hashed') returning id`,
      [tenantId, salesBEmail]
    );
    salesBUserId = salesBRes.rows[0].id;

    adminCtx = { tenantId, userId: adminUserId, role: "ADMIN" };
    salesACtx = { tenantId, userId: salesAUserId, role: "SALES" };

    // 3. 初始化客户与商机
    const custRes = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, name, industry) values ($1, '飞天智联集团', '软件与信息服务') returning id`,
      [tenantId]
    );
    customerId = custRes.rows[0].id;

    await owner.query<{ id: string }>(
      `insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage, expected_amount, actual_amount, actual_close_at)
       values ($1, '小张赢单项目', $2, $3, 'WON', 1000000, 1000000, now()) returning id`,
      [tenantId, customerId, salesAUserId]
    );

    const oppBRes = await owner.query<{ id: string }>(
      `insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage, expected_amount, lost_reason, lost_note)
       values ($1, '小李输单项目', $2, $3, 'LOST', 500000, 'PRICE', '客户预算不足') returning id`,
      [tenantId, customerId, salesBUserId]
    );
    salesBOppId = oppBRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      for (const tbl of ["ai_insight_reports", "notifications", "ai_recommendations", "ai_agent_traces", "tasks", "activities", "opportunities", "contacts", "customers", "users"]) {
        await owner.query(`delete from ${tbl} where tenant_id = $1`, [tenantId]);
      }
      await owner.query(`delete from tenants where id = $1`, [tenantId]);
    }
    await owner.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. 认知报告持久化存档往返（生成即入库 + 历史按周期与类型查询）", async () => {
    const period = "2026-09";
    const content = "## 企业画像分析\n客盘结构均衡，制造业占比40%，高客单客户留存稳定。";
    const evidence = { totalCustomers: 50, avgContractValue: 200000 };

    const saved = await saveInsightReportService(adminCtx, {
      kind: "COMPANY_PROFILE",
      period,
      content,
      evidence,
      sampleSize: 15,
    });

    expect(saved).toBeDefined();
    expect(saved.id).toBeDefined();
    expect(saved.kind).toBe("COMPANY_PROFILE");
    expect(saved.period).toBe("2026-09");
    expect(saved.sampleSize).toBe(15);
    expect(saved.confidence).toBe("MEDIUM");

    // 历史列表查询
    const list = await listInsightReportsService(adminCtx, "COMPANY_PROFILE");
    expect(list.length).toBeGreaterThanOrEqual(1);
    const target = list.find((r) => r.id === saved.id);
    expect(target).toBeDefined();
    expect(target?.content).toContain("客盘结构均衡");

    // 单条详情查询
    const fetched = await getInsightReportByIdService(adminCtx, saved.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(saved.id);
    expect(fetched?.content).toBe(content);
  });

  it("1.1 样本量梯度驱动置信度自动判定（25/15/5 -> HIGH/MEDIUM/LOW）", async () => {
    // 样本量 25 -> 判定为 HIGH
    const reportHigh = await saveInsightReportService(adminCtx, {
      kind: "COMPANY_PROFILE",
      period: "2026-07",
      content: "大样本画像分析报告",
      sampleSize: 25,
    });
    expect(reportHigh.confidence).toBe("HIGH");

    // 样本量 15 -> 判定为 MEDIUM
    const reportMedium = await saveInsightReportService(adminCtx, {
      kind: "COMPANY_PROFILE",
      period: "2026-06",
      content: "中等样本画像分析报告",
      sampleSize: 15,
    });
    expect(reportMedium.confidence).toBe("MEDIUM");

    // 样本量 5 -> 判定为 LOW
    const reportLow = await saveInsightReportService(adminCtx, {
      kind: "COMPANY_PROFILE",
      period: "2026-05",
      content: "小样本画像分析报告",
      sampleSize: 5,
    });
    expect(reportLow.confidence).toBe("LOW");
  });

  it("2. 月首日判定逻辑：仅在每月 1 日触发 L2/L3 认知月报自动编排", () => {
    const day1Date = new Date("2026-09-01T08:30:00+08:00");
    const day2Date = new Date("2026-09-02T08:30:00+08:00");
    const day15Date = new Date("2026-09-15T08:30:00+08:00");

    expect(zonedWallClock(day1Date).day).toBe(1);
    expect(zonedWallClock(day2Date).day).toBe(2);
    expect(zonedWallClock(day15Date).day).toBe(15);

    const isDay1Cron = (d: Date) => zonedWallClock(d).day === 1;
    expect(isDay1Cron(day1Date)).toBe(true);
    expect(isDay1Cron(day2Date)).toBe(false);
    expect(isDay1Cron(day15Date)).toBe(false);
  });

  it("3. 销冠打法反哺一线销售通知：含可复制动作摘要、链接正确、金额敏感字段脱敏", async () => {
    const period = "2026-09";
    const contentWithAmounts = `## 销冠打法解构
销冠个人总赢单金额 ¥480,000元，平均成单金额 15.8万元。
### 可复制动作
- 每次开单前与决策人进行现场深度面谈
- 报价前向客户提供阶梯价值测算方案
- 商务谈判阶段主动设置排他条款
### 转折点分析
关键决策在第 14 天确立。`;

    const report = await saveInsightReportService(adminCtx, {
      kind: "CHAMPION_ANALYSIS",
      period,
      content: contentWithAmounts,
      sampleSize: 25,
    });

    expect(report.confidence).toBe("HIGH");

    // 验证所有 ACTIVE 销售用户均收到 CHAMPION_PRACTICE 通知
    const notifs = await owner.query<{
      user_id: string;
      type: string;
      title: string;
      body: string;
      link: string;
    }>(
      `select user_id, type, title, body, link from notifications
       where tenant_id = $1 and type = 'CHAMPION_PRACTICE'
       order by created_at desc`,
      [tenantId]
    );

    const salesUserIds = notifs.rows.map((n) => n.user_id);
    expect(salesUserIds).toContain(salesAUserId);
    expect(salesUserIds).toContain(salesBUserId);

    const salesANotif = notifs.rows.find((n) => n.user_id === salesAUserId);
    expect(salesANotif).toBeDefined();
    expect(salesANotif?.title).toContain("销冠打法提炼");
    expect(salesANotif?.link).toBe(`/ai-hub?tab=management&reportId=${report.id}`);

    // 断言通知内容包含动作摘要，且绝不包含明细金额 (¥480,000 或 15.8万元)
    expect(salesANotif?.body).toContain("深度面谈");
    expect(salesANotif?.body).toContain("阶梯价值测算");
    expect(salesANotif?.body).not.toContain("480,000");
    expect(salesANotif?.body).not.toContain("15.8");

    // 验证销售人员查询历史认知报告时，服务端仅返回结构化公共摘要（不含任何金额/联系方式，含可复制动作）
    const salesReportList = await listInsightReportsService(salesACtx, "CHAMPION_ANALYSIS");
    const salesView = salesReportList.find((r) => r.id === report.id);
    expect(salesView).toBeDefined();
    expect(salesView?.content).toContain("深度面谈");
    expect(salesView?.content).toContain("阶梯价值测算");
    expect(salesView?.content).not.toContain("480,000");
    expect(salesView?.content).not.toContain("15.8");
    expect(salesView?.content).not.toContain("¥***");
    expect(salesView?.content).not.toContain("***万元");
    expect(salesView?.content).not.toContain("138");
    // 通知体同理已脱敏为摘要，前文已断言 notContain 金额
    expect(salesANotif?.body).not.toContain("¥");
  });

  it("4. SALES 角色越权访问归因与经营智能体的权限拦截", async () => {
    // A. 销售人员试图分析非本人负责的商机归因 -> 拒绝
    vi.spyOn(authSession, "requireSession").mockResolvedValue(salesACtx as never);
    const attributionForbiddenRes = await runDealAttributionAction(salesBOppId);
    expect(attributionForbiddenRes.ok).toBe(false);
    expect(attributionForbiddenRes.message).toContain("销售人员仅可对自己负责的商机执行归因分析");

    // B. 销售人员试图运行经营智能体 (销冠解构/企业画像) -> 拒绝
    const champForbiddenRes = await runChampionAnalysisAction();
    expect(champForbiddenRes.ok).toBe(false);
    expect(champForbiddenRes.message).toContain("权限不足，仅主管或管理员可运行经营智能体");

    const compForbiddenRes = await runCompanyProfileAction();
    expect(compForbiddenRes.ok).toBe(false);
    expect(compForbiddenRes.message).toContain("权限不足，仅主管或管理员可运行经营智能体");

    // C. 销售人员试图查看其他销售的晨会建议 -> 抛出 FORBIDDEN 异常
    await expect(
      getTodayMorningRecommendationsService(salesACtx, salesBUserId)
    ).rejects.toThrow("无权查看其他销售的晨会建议");
  });

  it("5. 晨会历史隔离：销售仅能查阅本人近 7 天建议回顾及状态标记", async () => {
    // 写入销售 A 与 销售 B 各自的历史晨会建议
    await owner.query(
      `insert into ai_recommendations (
        tenant_id, user_id, recommendation_type, title, content, confidence_score, is_applied, feedback_verdict, created_at
      ) values
      ($1, $2, 'MORNING_COPILOT', '小张专属建议：推进方案报价', '客户已确认需求', 90, true, 'HELPFUL', now() - interval '2 days'),
      ($1, $3, 'MORNING_COPILOT', '小李专属建议：催办定金', '等待财务打款', 85, false, 'NOT_APPLICABLE', now() - interval '1 day')`,
      [tenantId, salesAUserId, salesBUserId]
    );

    // 服务端查询：小张仅能查到本人建议
    const salesARecent = await getMyRecentRecommendationsService(salesACtx, 7);
    expect(salesARecent.length).toBeGreaterThanOrEqual(1);
    expect(salesARecent.every((r) => !r.title.includes("小李"))).toBe(true);
    const targetA = salesARecent.find((r) => r.title.includes("小张专属建议"));
    expect(targetA).toBeDefined();
    expect(targetA?.isApplied).toBe(true);
    expect(targetA?.feedbackVerdict).toBe("HELPFUL");

    // Action 级查询
    vi.spyOn(authSession, "requireSession").mockResolvedValue(salesACtx as never);
    const actionRes = await listMyRecentRecommendationsAction(7);
    expect(actionRes.ok).toBe(true);
    if (actionRes.ok) {
      expect(actionRes.data.some((r) => r.title.includes("小张专属建议"))).toBe(true);
      expect(actionRes.data.some((r) => r.title.includes("小李专属建议"))).toBe(false);
    }
  });
});
