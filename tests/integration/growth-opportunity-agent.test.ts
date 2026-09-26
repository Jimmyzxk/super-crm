import "dotenv/config";
import pg from "pg";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { BusinessError } from "@/core/shared/result";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const db = new pg.Client({ connectionString: migrationUrl });

let runGrowthOpportunityAgent: typeof import("@/core/ai-hub/agents/growth-opportunity").runGrowthOpportunityAgent;
let aiGateway: typeof import("@/core/ai-gateway/client");
let customerRevenueTieringTool: typeof import("@/core/ai-hub/tools/growth").customerRevenueTieringTool;
let crossSellCandidatesTool: typeof import("@/core/ai-hub/tools/growth").crossSellCandidatesTool;
let dormantHighValueTool: typeof import("@/core/ai-hub/tools/growth").dormantHighValueTool;
let renewalPipelineTool: typeof import("@/core/ai-hub/tools/growth").renewalPipelineTool;

describe("Growth Opportunity Agent (Wave 3)", () => {
  const ts = Date.now();
  let adminCtx: TenantContext;
  let salesCtx: TenantContext;
  let tenantId: string;
  let customerAId: string;
  let productId: string;

  beforeAll(async () => {
    runGrowthOpportunityAgent = (await import("@/core/ai-hub/agents/growth-opportunity")).runGrowthOpportunityAgent;
    aiGateway = await import("@/core/ai-gateway/client");
    const growthTools = await import("@/core/ai-hub/tools/growth");
    customerRevenueTieringTool = growthTools.customerRevenueTieringTool;
    crossSellCandidatesTool = growthTools.crossSellCandidatesTool;
    dormantHighValueTool = growthTools.dormantHighValueTool;
    renewalPipelineTool = growthTools.renewalPipelineTool;

    await db.connect();

    // 1. 初始化测试租户
    const tRes = await db.query<{ id: string }>(
      `insert into tenants (name) values ($1) returning id`,
      [`Growth Opportunity Corp ${ts}`]
    );
    tenantId = tRes.rows[0].id;

    // 2. 初始化用户 (ADMIN, SALES)
    const adminRes = await db.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash)
       values ($1, $2, '增长主管', 'ADMIN', 'ACTIVE', 'hashed') returning id`,
      [tenantId, `admin_growth_${ts}@test.com`]
    );
    const adminUserId = adminRes.rows[0].id;
    adminCtx = { tenantId, userId: adminUserId, role: "ADMIN" };

    const salesRes = await db.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash)
       values ($1, $2, '销售顾问', 'SALES', 'ACTIVE', 'hashed') returning id`,
      [tenantId, `sales_growth_${ts}@test.com`]
    );
    const salesUserId = salesRes.rows[0].id;
    salesCtx = { tenantId, userId: salesUserId, role: "SALES" };

    // 3. 初始化测试产品
    const prodRes = await db.query<{ id: string }>(
      `insert into products (tenant_id, code, name, category, pricing_model, unit_price, status)
       values ($1, $2, '企业增长AI套件', 'SOFTWARE', 'SUBSCRIPTION_YEARLY', 5000000, 'ACTIVE') returning id`,
      [tenantId, `PROD-GROWTH-${ts}`]
    );
    productId = prodRes.rows[0].id;

    await db.query(
      `insert into products (tenant_id, code, name, category, pricing_model, unit_price, status)
       values ($1, $2, '智能知识库套件', 'SOFTWARE', 'SUBSCRIPTION_YEARLY', 8800000, 'ACTIVE')`,
      [tenantId, `PROD-KB-${ts}`]
    );

    // 4. 初始化测试客户 (A: 有订单与互动, B: 沉睡无营收客户)
    const custARes = await db.query<{ id: string }>(
      `insert into customers (tenant_id, name, industry, owner_user_id, last_activity_at)
       values ($1, '飞轮动力科技有限公司', '智能制造', $2, now() - interval '90 days') returning id`,
      [tenantId, adminUserId]
    );
    customerAId = custARes.rows[0].id;

    await db.query(
      `insert into customers (tenant_id, name, industry, owner_user_id, last_activity_at)
       values ($1, '潜客零营收企业', '企业服务', $2, now())`,
      [tenantId, salesUserId]
    );

    // 5. 开源版（AGPL-3.0）：营收 / 交叉销售 / 临期合同三条证据链原本由闭源
    //    orders / contracts 插件的 plugin_facts 提供，开源版插件缺席时降级为空。
    //    此处只保留核心证据：赢单商机 + 商机产品明细（支撑 crossSellCandidates 核心 SQL）。
    await db.query(
      `insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage, expected_amount, actual_amount, actual_close_at)
       values ($1, $2, $3, $4, 'WON', 10000000, 10000000, current_date)`,
      [tenantId, '年度订阅商机', customerAId, adminUserId]
    );
    await db.query(
      `insert into opportunity_line_items (tenant_id, opportunity_id, product_id, quantity, unit_price, subtotal_amount)
       select $1, id, $2, 2, 5000000, 10000000 from opportunities
       where tenant_id = $1 and customer_id = $3 and stage = 'WON'`,
      [tenantId, productId, customerAId]
    );
  });

  afterAll(async () => {
    if (tenantId) {
      for (const tbl of [
        "notifications",
        "ai_recommendations",
        "ai_agent_traces",
        "tasks",
        "activities",
        "opportunity_line_items",
        "opportunities",
        "contacts",
        "customers",
        "products",
        "users",
      ]) {
        await db.query(`delete from ${tbl} where tenant_id = $1`, [tenantId]);
      }
      await db.query(`delete from tenants where id = $1`, [tenantId]);
    }
    await db.end();
  });

  it("1. 越权拒绝：普通销售无法运行增量变现 Agent", async () => {
    await expect(runGrowthOpportunityAgent(salesCtx)).rejects.toThrow(BusinessError);
    await expect(runGrowthOpportunityAgent(salesCtx)).rejects.toThrow(/普通销售无权触发增量与变现诊断报告/);
  });

  it("2. Mock LLM 测试：循环执行/工具调用/结构化报告产出与 Trace 落库", async () => {
    let callCount = 0;
    const spy = vi.spyOn(aiGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          isRealLlm: true,
          provider: "CUSTOM",
          modelName: "mocked-llm",
          data: null,
          rawText: "",
          tool_calls: [
            {
              id: "call_growth_1",
              type: "function",
              function: { name: "customerRevenueTiering", arguments: '{"tier":"ZERO","limit":5}' }
            },
            {
              id: "call_growth_2",
              type: "function",
              function: { name: "crossSellCandidates", arguments: '{"limit":5}' }
            },
            {
              id: "call_growth_3",
              type: "function",
              function: { name: "dormantHighValue", arguments: '{"limit":5}' }
            },
            {
              id: "call_growth_4",
              type: "function",
              function: { name: "renewalPipeline", arguments: '{"days":90,"limit":5}' }
            }
          ]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }

      const mockReport = {
        activationList: [
          { customerName: "潜客零营收企业", reason: "注册后零贡献但近期有互动", confidence: "HIGH" as const },
        ],
        crossSellList: [
          { customerName: "飞轮动力科技有限公司", recommendedProduct: "数据大屏分析套件", basis: "已购增长套件", confidence: "MEDIUM" as const },
        ],
        dormantList: [
          { customerName: "飞轮动力科技有限公司", dormantDays: 90, lastInteraction: "90天前最后互动", confidence: "HIGH" as const },
        ],
        renewalWindows: [
          { contractNo: `CTR-${ts}-01`, suggestedTiming: "剩余20天，立即启动续约触达", confidence: "HIGH" as const },
        ],
        insufficientData: false,
      };

      return {
        isRealLlm: true,
        provider: "CUSTOM",
        modelName: "mocked-llm",
        data: null,
        rawText: "```json\n" + JSON.stringify(mockReport) + "\n```",
        tool_calls: [],
        error: undefined,
      };
    });

    const res = await runGrowthOpportunityAgent(adminCtx);

    expect(res.outcome).toContain("潜客零营收企业");
    expect(res.report.activationList).toHaveLength(1);
    expect(res.report.activationList[0].customerName).toBe("潜客零营收企业");
    expect(res.report.crossSellList[0].recommendedProduct).toBe("数据大屏分析套件");
    expect(res.report.dormantList[0].dormantDays).toBe(90);
    expect(res.report.renewalWindows[0].contractNo).toBe(`CTR-${ts}-01`);
    expect(res.report.insufficientData).toBe(false);

    // 验证 ai_agent_traces 表中已由 runAgentLoop 统一记录
    await db.query(`set app.tenant_id = '${adminCtx.tenantId}'`);
    const traceCheck = await db.query(
      `select * from ai_agent_traces where tenant_id = $1 and task like '%增量与变现%' order by created_at desc limit 1`,
      [adminCtx.tenantId]
    );
    expect(traceCheck.rows.length).toBe(1);
    expect(traceCheck.rows[0].tools_used).toContain("customerRevenueTiering");
    expect(traceCheck.rows[0].tools_used).toContain("crossSellCandidates");
    expect(traceCheck.rows[0].tools_used).toContain("dormantHighValue");
    expect(traceCheck.rows[0].tools_used).toContain("renewalPipeline");

    spy.mockRestore();
  });

  it("2.1 空数据边界用例：所有挖掘工具均无可用机会时正确返回 insufficientData: true", async () => {
    let callCount = 0;
    const spy = vi.spyOn(aiGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          isRealLlm: true,
          provider: "CUSTOM",
          modelName: "mocked-llm",
          data: null,
          rawText: "",
          tool_calls: [
            {
              id: "call_empty_1",
              type: "function",
              function: { name: "customerRevenueTiering", arguments: '{"tier":"ZERO","limit":5}' }
            },
            {
              id: "call_empty_2",
              type: "function",
              function: { name: "crossSellCandidates", arguments: '{"limit":5}' }
            },
            {
              id: "call_empty_3",
              type: "function",
              function: { name: "dormantHighValue", arguments: '{"limit":5}' }
            },
            {
              id: "call_empty_4",
              type: "function",
              function: { name: "renewalPipeline", arguments: '{"days":90,"limit":5}' }
            }
          ]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }

      const emptyReport = {
        activationList: [],
        crossSellList: [],
        dormantList: [],
        renewalWindows: [],
        insufficientData: true,
      };

      return {
        isRealLlm: true,
        provider: "CUSTOM",
        modelName: "mocked-llm",
        data: null,
        rawText: "```json\n" + JSON.stringify(emptyReport) + "\n```",
        tool_calls: [],
        error: undefined,
      };
    });

    try {
      const res = await runGrowthOpportunityAgent(adminCtx);
      expect(res.report.insufficientData).toBe(true);
      expect(res.report.activationList).toHaveLength(0);
      expect(res.report.crossSellList).toHaveLength(0);
      expect(res.report.dormantList).toHaveLength(0);
      expect(res.report.renewalWindows).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("3. 增长 Tools 的核心 SQL 在插件缺席时仍可用，插件证据优雅降级为空", async () => {
    // 开源版（AGPL-3.0）：customerRevenueTiering / dormantHighValue 的营收口径
    // 来自 plugin_facts.getCustomerOrderRevenues（闭源 orders 插件），
    // 插件缺席时按 core 默认实现返回空事实 → 营收为 0，核心 SQL 段仍必须可执行。

    // 1) 营收分层 Tool (核心 SQL 可执行；插件缺席时全量为零贡献分层)
    const tieringRes = (await customerRevenueTieringTool.execute(adminCtx, { limit: 10 })) as { result: Array<Record<string, unknown>> };
    expect(tieringRes.result).toBeDefined();
    expect(Array.isArray(tieringRes.result)).toBe(true);
    expect(tieringRes.result.length).toBeGreaterThanOrEqual(1);
    const zeroTierRes = (await customerRevenueTieringTool.execute(adminCtx, { tier: "ZERO", limit: 5 })) as { result: Array<Record<string, unknown>> };
    expect(zeroTierRes.result.length).toBeGreaterThanOrEqual(1);
    expect(zeroTierRes.result[0].name).toBe("潜客零营收企业");
    const customerAItem = tieringRes.result.find((c) => c.id === customerAId);
    expect(customerAItem).toBeDefined();
    // 插件缺席 → 订单营收事实为空；综合营收退回核心口径（赢单商机金额）10000000 分 = 100000 元
    expect(customerAItem?.totalRevenue).toBe(100000);
    // 分层按「分」比较：1000 万分落在 MEDIUM 档
    expect(customerAItem?.tier).toBe("MEDIUM");

    // 2) 交叉销售候选 Tool (核心 SQL：WON 商机 + 商机明细 → 已购产品码可被识别)
    const crossRes = (await crossSellCandidatesTool.execute(adminCtx, { limit: 5 })) as { result: Array<Record<string, unknown>> };
    expect(crossRes.result).toBeDefined();
    expect(Array.isArray(crossRes.result)).toBe(true);
    expect(crossRes.result.length).toBeGreaterThanOrEqual(1);
    const crossItem = crossRes.result.find((c) => c.customerId === customerAId);
    expect(crossItem).toBeDefined();
    expect(crossItem?.boughtCodes as string[]).toContain(`PROD-GROWTH-${ts}`);

    // 2.1) 未买齐产品线时仍给出推荐（fullyCovered 只在覆盖全部产品时为 true）
    const custFullRes = await db.query<{ id: string }>(
      `insert into customers (tenant_id, name, industry, owner_user_id)
       values ($1, '未买齐客户', '智能制造', $2) returning id`,
      [tenantId, adminCtx.userId]
    );
    const custFullId = custFullRes.rows[0].id;
    await db.query(
      `insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage, expected_amount, actual_amount, actual_close_at)
       values ($1, '未买齐商机', $2, $3, 'WON', 20000000, 20000000, current_date)`,
      [tenantId, custFullId, adminCtx.userId]
    );
    await db.query(
      `insert into opportunity_line_items (tenant_id, opportunity_id, product_id, quantity, unit_price, subtotal_amount)
       select $1, id, $2, 1, 5000000, 5000000 from opportunities
       where tenant_id = $1 and customer_id = $3 and stage = 'WON'`,
      [tenantId, productId, custFullId]
    );

    const crossResFull = (await crossSellCandidatesTool.execute(adminCtx, { limit: 10 })) as { result: Array<Record<string, unknown>> };
    const fullCustomerItem = crossResFull.result.find((c) => c.customerId === custFullId);
    expect(fullCustomerItem).toBeDefined();
    expect(fullCustomerItem?.fullyCovered).toBe(false);
    expect((fullCustomerItem?.recommendation as { code: string } | null)?.code).toBe(`PROD-KB-${ts}`);

    // 3) 沉睡高价值客户 Tool (>60天无互动；插件缺席时营收为 0，核心沉睡天数口径仍生效)
    const dormantRes = (await dormantHighValueTool.execute(adminCtx, { limit: 5 })) as { result: Array<Record<string, unknown>> };
    expect(dormantRes.result).toBeDefined();
    expect(dormantRes.result.length).toBeGreaterThanOrEqual(1);
    const dormantItem = dormantRes.result.find((c) => c.id === customerAId);
    expect(dormantItem).toBeDefined();
    // 同上：营收来自赢单商机核心口径，而非订单插件事实
    expect(dormantItem?.totalRevenue).toBe(100000);
    expect(typeof dormantItem?.dormantDays).toBe("number");
    expect((dormantItem?.dormantDays as number)).toBeGreaterThanOrEqual(60);

    // 4) 临期合同 Tool：合同属闭源 contracts 插件，插件缺席时返回空集合且不报错
    const renewalRes = (await renewalPipelineTool.execute(adminCtx, { days: 30, limit: 5 })) as { result: Array<Record<string, unknown>> };
    expect(renewalRes.result).toEqual([]);
  });
});
