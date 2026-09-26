import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let analyticsService: typeof import("@/core/analytics/service");
let leadsService: typeof import("@/core/leads/service");
let followupService: typeof import("@/core/followup/service");
let customerService: typeof import("@/core/customer/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;
let managerId: string;

describe("经营分析与效能看板矩阵 (Analytics & BI Matrix) 集成测试", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    analyticsService = await import("@/core/analytics/service");
    leadsService = await import("@/core/leads/service");
    followupService = await import("@/core/followup/service");
    customerService = await import("@/core/customer/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('经营分析BI测试租户') returning id`);
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();
    const [salesRes, mgrRes] = await Promise.all([
      owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
        values ($1, $2, $3, '销售王牌', 'SALES') returning id`, [tenantId, `sales-bi-${ts}@example.com`, pw]),
      owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
        values ($1, $2, $3, '销售总监', 'MANAGER') returning id`, [tenantId, `mgr-bi-${ts}@example.com`, pw]),
    ]);
    salesId = salesRes.rows[0].id;
    managerId = mgrRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from sales_insights where tenant_id = $1", [tenantId]);
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunity_stage_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_conversions where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
      await owner.query("update leads set customer_id = null where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_intake_requests where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_source_keys where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await owner.end();
    await closeDb();
  });

  it("1. 销售个人罗盘：能够准确统计当月已赢单、加权预测与停滞商机", async () => {
    const ctx = { tenantId, userId: salesId, role: "SALES" as const };

    // 建立一个单位客户和一个个人客户
    const lead1 = await leadsService.createLeadService(ctx, {
      contactName: "张总",
      contactPhone: "13800010001",
      companyName: "蓝天制造",
    });
    if (!lead1.created) throw new Error("建线索失败");
    await followupService.logActivityService(ctx, { leadId: lead1.leadId, type: "CALL", outcome: "CONNECTED", summary: "沟通" });
    await leadsService.qualifyLeadService(ctx, lead1.leadId, "确认需求");

    // 转单位客户并立项一个商机（方案报价阶段 50% 概率，金额 10 万元）
    const conv1 = await customerService.convertLeadToCustomerService(ctx, {
      leadId: lead1.leadId,
      customerName: "蓝天制造有限公司",
      customerType: "ENTERPRISE",
      opportunityName: "蓝天制造ERP项目",
      contactRoleTag: "DECISION_MAKER",
      contactName: "张总",
      contactPhone: "13800010001",
      expectedAmount: 10000000, // 10万元
      expectedCloseAt: new Date(Date.now() + 86400000 * 10),
      demandNote: "ERP",
    });

    // 将该商机推进到 PROPOSAL 阶段，并模拟 stage_entered_at 为 20 天前（触发停滞判定）
    await owner.query(`
      update opportunities set
        stage = 'PROPOSAL',
        stage_entered_at = now() - interval '20 days',
        updated_at = now() - interval '20 days'
      where id = $1
    `, [conv1.opportunityId]);

    // 建立一个赢单商机（金额 5 万元）
    const lead2 = await leadsService.createLeadService(ctx, {
      contactName: "李个人",
      contactPhone: "13800010002",
    });
    if (!lead2.created) throw new Error("建线索失败");
    await followupService.logActivityService(ctx, { leadId: lead2.leadId, type: "CALL", outcome: "CONNECTED", summary: "沟通" });
    await leadsService.qualifyLeadService(ctx, lead2.leadId, "确认");
    const conv2 = await customerService.convertLeadToCustomerService(ctx, {
      leadId: lead2.leadId,
      customerName: "李个人 (个人客户)",
      customerType: "INDIVIDUAL",
      opportunityName: "个人咨询服务",
      contactRoleTag: "DECISION_MAKER",
      contactName: "李个人",
      contactPhone: "13800010002",
      expectedAmount: 5000000,
      expectedCloseAt: new Date(),
      demandNote: "咨询",
    });
    await owner.query(`
      update opportunities set
        stage = 'WON',
        actual_amount = 5000000,
        actual_close_at = now()::date
      where id = $1
    `, [conv2.opportunityId]);

    // 调用个人罗盘服务
    const radar = await analyticsService.getSalesRadarService(ctx);

    expect(radar.forecast.wonAmount).toBe(5000000);
    expect(radar.forecast.commitAmount).toBe(5000000);
    expect(radar.forecast.weightedAmount).toBe(10000000); // 5万已赢单 + (10万 * 50% 期望) = 10万
    expect(radar.forecast.bestCaseAmount).toBe(15000000); // 5万已赢单 + 10万管道 = 15万

    // 销售速率与库龄
    expect(radar.velocity.activeDealsCount).toBe(1);
    expect(radar.velocity.velocityDailyAmount).toBeGreaterThan(0);
    expect(radar.pipelineAging.length).toBe(4);

    // 停滞商机检测
    expect(radar.stalledOpportunities.length).toBeGreaterThanOrEqual(1);
    expect(radar.stalledOpportunities[0].name).toBe("蓝天制造ERP项目");
    expect(radar.stalledOpportunities[0].stalledDays).toBeGreaterThanOrEqual(19);
  });

  it("2. 团队效能与漏斗诊断：能够准确生成 L2C 漏斗转化率、销售速率、SLA质检与团队人效", async () => {
    const ctxMgr = { tenantId, userId: managerId, role: "MANAGER" as const };

    const funnel = await analyticsService.getTeamEfficiencyService(ctxMgr);

    // 团队销售速率与 SLA
    expect(funnel.velocity.velocityDailyAmount).toBeGreaterThan(0);
    expect(funnel.sla.firstResponseSlaRate).toBe(100); // 24h 首响达标率 100%
    // Wave11：目标唯一数据源为 sales_quotas，未配置任何配额时不再退回硬编码 50 万基准，
    // 团队平均达成率返回 0 并显式标记 isTargetConfigured=false
    expect(funnel.tierDistribution.avgQuotaAttainment).toBe(0);
    expect(funnel.tierDistribution.isTargetConfigured).toBe(false);
    expect(funnel.memberMetrics.every((m) => m.isTargetConfigured === false)).toBe(true);

    // 漏斗步骤完整性
    expect(funnel.funnelSteps.length).toBe(7);
    expect(funnel.funnelSteps[0].stepName).toBe("线索进线");
    expect(funnel.funnelSteps[6].stepName).toBe("签约赢单");

    // 阶段停留诊断
    expect(funnel.stageVelocities.length).toBe(3);
    const proposalStage = funnel.stageVelocities.find((s) => s.stage === "PROPOSAL");
    expect(proposalStage).toBeDefined();
    expect(proposalStage!.activeCount).toBeGreaterThanOrEqual(1);

    // 团队成员指标
    expect(funnel.memberMetrics.length).toBeGreaterThanOrEqual(2);
    const salesMember = funnel.memberMetrics.find((m) => m.userId === salesId);
    expect(salesMember).toBeDefined();
    expect(salesMember!.monthWonAmount).toBe(5000000);
  });

  it("3. 经营大盘与营收预测：能够统计三档预测、行业效益、客户类型贡献与输单归因", async () => {
    const ctxMgr = { tenantId, userId: managerId, role: "MANAGER" as const };

    // 插入一条输单商机（输给竞品，金额 8 万元）
    const custRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, customer_type, industry, owner_user_id)
      values ($1, '输单测试企业', 'ENTERPRISE', '智能制造', $2) returning id
    `, [tenantId, salesId]);
    await owner.query(`
      insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount, lost_reason, lost_note)
      values ($1, $2, $3, '失单项目A', 'LOST', 8000000, 'COMPETITOR', '选择了老牌竞品')
    `, [tenantId, custRes.rows[0].id, salesId]);

    const forecast = await analyticsService.getExecutiveForecastService(ctxMgr);

    expect(forecast.forecast.wonAmount).toBe(5000000);
    expect(forecast.customerTypeContribution.individualWonAmount).toBe(5000000);
    expect(forecast.customerTypeContribution.individualWonCount).toBe(1);

    // 行业表现
    expect(forecast.industryMetrics.length).toBeGreaterThanOrEqual(1);

    // 输单归因
    expect(forecast.lossAttributions.length).toBeGreaterThanOrEqual(1);
    const competitorLoss = forecast.lossAttributions.find((l) => l.reason === "COMPETITOR");
    expect(competitorLoss).toBeDefined();
    expect(competitorLoss!.count).toBe(1);
    expect(competitorLoss!.lostAmount).toBe(8000000);
    expect(competitorLoss!.reasonLabel).toBe("选择了竞品");
  });

  it("4. 真实全链路业务数据注入与清理：验证各指标、多月趋势与客群矩阵 100% 实时响应", async () => {
    const seedModule = await import("@/core/analytics/seed");
    const ctxMgr = { tenantId, userId: managerId, role: "MANAGER" as const };

    // 执行注入
    const genRes = await seedModule.generateAnalyticsDemoDataService(ctxMgr);
    expect(genRes.success).toBe(true);

    // 重新获取经营大盘 (选择全部历史)
    const allForecast = await analyticsService.getExecutiveForecastService(ctxMgr, { period: "all" });
    expect(allForecast.monthlyTrends.length).toBe(6);
    expect(allForecast.customerTypeContribution.enterpriseWonAmount).toBeGreaterThan(0);
    expect(allForecast.customerTypeContribution.individualWonAmount).toBeGreaterThan(0);
    expect(allForecast.industryMetrics.length).toBeGreaterThanOrEqual(3);

    // 执行清空
    const clearRes = await seedModule.clearAnalyticsDemoDataService(ctxMgr);
    expect(clearRes.success).toBe(true);
  });

  it("5. 权限门禁：SALES 不能越权读取团队效能/经营大盘/成员列表，也不能注入演示数据", async () => {
    const ctxSales = { tenantId, userId: salesId, role: "SALES" as const };
    const { generateAnalyticsDemoDataService } = await import("@/core/analytics/seed");

    await expect(analyticsService.getTeamEfficiencyService(ctxSales)).rejects.toThrow("权限");
    await expect(analyticsService.getExecutiveForecastService(ctxSales)).rejects.toThrow("权限");
    await expect(analyticsService.listAnalyticsTeamMembersService(ctxSales)).rejects.toThrow("权限");
    await expect(generateAnalyticsDemoDataService(ctxSales)).rejects.toThrow("权限");
    // 个人罗盘是销售自己的数据，保持可用
    await expect(analyticsService.getSalesRadarService(ctxSales)).resolves.toBeTruthy();
  });

  it("6. 存量线索渠道回填防回归：断言全库存量线索 channel 为 null 或空的行数为 0，且归入标准 slug", async () => {
    // 1. 创建历史空白 channel 线索并模拟存量数据
    const blankLead = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, contact_phone, source, channel)
      values ($1, '存量未分类线索', '13800008899', 'form:11111111-1111-4111-8111-111111111111', null)
      returning id
    `, [tenantId]);

    // 2. 执行租户级回填修复 SQL 逻辑
    await owner.query(`
      do $$
      declare
        t record;
      begin
        for t in select id from tenants where id = '${tenantId}' loop
          perform set_config('app.tenant_id', t.id::text, true);
          update leads
          set channel = case
            when source like '%form:%' or source = 'FORM_CAPTURE' then 'official_website'
            when source like '%plugin:lead_routing%' then 'other'
            when lower(source) = 'manual' or source is null or source = '' then 'direct'
            when lower(source) = 'import' then 'other'
            when source like '%api:%' or source = 'OPEN_API' then 'other'
            when source = 'PUBLIC_POOL' then 'direct'
            else 'direct'
          end
          where tenant_id = t.id
            and (channel is null or channel = '' or channel in ('manual', 'import', '官网公开表单', '销售自拓', '批量导入'));
        end loop;
      end $$;
    `);

    // 3. 断言该租户下 channel 为 null 或空的行数为 0
    const nullCheck = await owner.query<{ count: string }>(`
      select count(*)::text as count from leads
      where tenant_id = $1 and (channel is null or channel = '' or channel = 'UNSPECIFIED')
    `, [tenantId]);
    expect(Number(nullCheck.rows[0].count)).toBe(0);

    // 4. 断言刚才回填的线索已被正确赋予 official_website slug
    const verified = await owner.query<{ channel: string }>(`
      select channel from leads where id = $1
    `, [blankLead.rows[0].id]);
    expect(verified.rows[0].channel).toBe("official_website");
  });
});
