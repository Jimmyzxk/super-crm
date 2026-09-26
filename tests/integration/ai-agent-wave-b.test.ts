import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

describe("AI Agent Cognitive Layer (Wave B)", () => {
  let ctx: import("@/core/tenant").TenantContext;
  let tenantId: string;
  let adminUserId: string;
  let salesUserId: string;
  let runChampionAnalysisAgent: typeof import("@/core/ai-hub/agents/champion-analysis").runChampionAnalysisAgent;
  let runCompanyProfileAgent: typeof import("@/core/ai-hub/agents/company-profile").runCompanyProfileAgent;
  let runChampionAnalysisAction: typeof import("@/core/ai-hub/actions").runChampionAnalysisAction;
  let runCompanyProfileAction: typeof import("@/core/ai-hub/actions").runCompanyProfileAction;
  let llmGateway: typeof import("@/core/ai-gateway/client");
  let authSession: typeof import("@/core/auth/session");

  beforeAll(async () => {
    // Dynamic imports
    const champMod = await import("@/core/ai-hub/agents/champion-analysis");
    const compMod = await import("@/core/ai-hub/agents/company-profile");
    const actionsMod = await import("@/core/ai-hub/actions");
    runChampionAnalysisAgent = champMod.runChampionAnalysisAgent;
    runCompanyProfileAgent = compMod.runCompanyProfileAgent;
    runChampionAnalysisAction = actionsMod.runChampionAnalysisAction;
    runCompanyProfileAction = actionsMod.runCompanyProfileAction;
    llmGateway = await import("@/core/ai-gateway/client");
    authSession = await import("@/core/auth/session");

    await owner.connect();
    const res = await owner.query<{ id: string }>(`insert into tenants (name) values ('Cognitive Layer Corp') returning id`);
    tenantId = res.rows[0].id;

    const rand = Math.random().toString(36).substring(7);
    const adminEmail = `admin_${rand}@test.com`;
    const salesEmail = `sales_${rand}@test.com`;

    const adminRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', '${adminEmail}', 'hash', 'Test Admin', 'ADMIN')
      returning id
    `);
    adminUserId = adminRes.rows[0].id;

    const salesRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', '${salesEmail}', 'hash', 'Test Sales', 'SALES')
      returning id
    `);
    salesUserId = salesRes.rows[0].id;

    ctx = { tenantId, userId: adminUserId, role: "ADMIN" };

    // 插入测试商机与客户数据 (共 3 笔商机，样本量 N < 20)
    const custRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, industry, customer_type, size)
      values ('${tenantId}', '智造先锋科技', '智能制造', 'ENTERPRISE', '101-500')
      returning id
    `);
    const custId = custRes.rows[0].id;

    await owner.query(`
      insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, actual_amount, expected_amount, actual_close_at, lost_reason)
      values
        ('${tenantId}', '${custId}', '${adminUserId}', '智能工厂一期项目', 'WON', 500000, 500000, current_date, null),
        ('${tenantId}', '${custId}', '${adminUserId}', '云原生中台升级', 'WON', 300000, 300000, current_date, null),
        ('${tenantId}', '${custId}', '${salesUserId}', '数字化转型咨询', 'LOST', null, 150000, null, 'COMPETITOR')
    `);
  });

  afterAll(async () => {
    await owner.query(`delete from notifications where tenant_id = '${tenantId}'`);
    await owner.query(`delete from ai_insight_reports where tenant_id = '${tenantId}'`);
    await owner.query(`delete from lead_conversions where tenant_id = '${tenantId}'`);
    await owner.query(`delete from opportunities where tenant_id = '${tenantId}'`);
    await owner.query(`delete from leads where tenant_id = '${tenantId}'`);
    await owner.query(`delete from customers where tenant_id = '${tenantId}'`);
    await owner.query(`delete from users where tenant_id = '${tenantId}'`);
    await owner.query(`delete from tenants where id = '${tenantId}'`);
    await owner.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runChampionAnalysisAgent: executes ReAct loop, calls champion tools, enforces evidence citation and low confidence annotation (N < 20)", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // 第一轮：LLM 决定调用 topPerformersByRevenue 与 winLossFactorStats
        return {
          rawText: "开始分析团队销冠画像与归因数据...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: [
            {
              id: "call_top",
              type: "function",
              function: { name: "topPerformersByRevenue", arguments: '{"limit":5}' }
            },
            {
              id: "call_winloss",
              type: "function",
              function: { name: "winLossFactorStats", arguments: '{"dimension":"all"}' }
            }
          ]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      } else {
        // 第二轮：LLM 输出综合结论，带有证据引用
        return {
          rawText: "## 销冠解构分析报告\n\n1. **客户共性**：来自 topPerformersByRevenue: 销冠贡献总金额为 ¥8,000.00；\n2. **胜率归因**：来自 winLossFactorStats: 智能制造行业赢单率达到 100%。\n3. **可复制动作**：建议聚焦智能制造大客户。",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock"
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
    });

    const res = await runChampionAnalysisAgent(ctx);
    expect(res.rounds).toBe(2);
    expect(res.toolsUsed).toContain("topPerformersByRevenue");
    expect(res.toolsUsed).toContain("winLossFactorStats");

    // 验证证据引用存在
    expect(res.outcome).toContain("来自 topPerformersByRevenue");
    expect(res.outcome).toContain("来自 winLossFactorStats");

    // 验证由于样本 N=2 (WON) 或 N=3 (Closed) < 20，触发置信度边界
    expect(res.outcome).toMatch(/方向性假设（低置信度，样本 N=\d+）/);

    // 验证 0083 trace 落库
    await owner.query(`set app.tenant_id = '${ctx.tenantId}'`);
    const trace = await owner.query(`select * from ai_agent_traces where tenant_id = '${ctx.tenantId}' and task like '%销冠解构%' order by created_at desc limit 1`);
    expect(trace.rows.length).toBe(1);
    expect(trace.rows[0].rounds).toBe(2);
    expect(trace.rows[0].outcome).toContain("销冠解构");
  });

  it("runCompanyProfileAgent: executes ReAct loop, calls company profile tools, outputs structural diagnosis and risk analysis", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "正在诊断企业客户盘子与营收结构...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: [
            {
              id: "call_port",
              type: "function",
              function: { name: "customerPortfolioStructure", arguments: '{}' }
            },
            {
              id: "call_rev",
              type: "function",
              function: { name: "revenueBySegment", arguments: '{"dimension":"all"}' }
            }
          ]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      } else {
        return {
          rawText: "## 企业画像与客盘诊断报告\n\n1. **客户结构**：来自 customerPortfolioStructure: 智能制造行业贡献了 100% 的已实现营收；\n2. **结构性风险**：来自 revenueBySegment: 客户单一行业依赖度过高（100% 依赖智能制造）。\n3. **增长机会**：可向其他行业拓展。",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock"
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
    });

    const res = await runCompanyProfileAgent(ctx);
    expect(res.rounds).toBe(2);
    expect(res.toolsUsed).toContain("customerPortfolioStructure");
    expect(res.toolsUsed).toContain("revenueBySegment");

    // 验证证据引用存在
    expect(res.outcome).toContain("来自 customerPortfolioStructure");
    expect(res.outcome).toContain("来自 revenueBySegment");

    // 验证样本量 < 20 时诚实边界标注
    expect(res.outcome).toMatch(/方向性假设（低置信度，样本 N=\d+）/);

    // 验证 0083 trace 落库
    await owner.query(`set app.tenant_id = '${ctx.tenantId}'`);
    const trace = await owner.query(`select * from ai_agent_traces where tenant_id = '${ctx.tenantId}' and task like '%企业画像%' order by created_at desc limit 1`);
    expect(trace.rows.length).toBe(1);
  });

  it("Permission enforcement: SALES role is blocked from running management agents", async () => {
    // 模拟 SALES 身份调用 Server Action
    vi.spyOn(authSession, "requireSession").mockResolvedValue({
      tenantId,
      userId: salesUserId,
      role: "SALES",
    } as unknown as import("@/core/tenant").TenantContext);

    const champRes = await runChampionAnalysisAction();
    expect(champRes.ok).toBe(false);
    expect(champRes.message).toContain("权限不足");

    const compRes = await runCompanyProfileAction();
    expect(compRes.ok).toBe(false);
    expect(compRes.message).toContain("权限不足");
  });

  it("Permission enforcement: ADMIN / MANAGER role can successfully run management agent actions", async () => {
    vi.spyOn(authSession, "requireSession").mockResolvedValue({
      tenantId,
      userId: adminUserId,
      role: "ADMIN",
    } as unknown as import("@/core/tenant").TenantContext);

    vi.spyOn(llmGateway, "callLlmGatewayService").mockResolvedValue({
      rawText: "## 报告\n来自 topPerformersByRevenue: 表现优异",
      data: null,
      isRealLlm: true,
      provider: "mock",
      modelName: "mock"
    } as unknown as import("@/core/ai-gateway/client").LlmResponseResult);

    const champRes = await runChampionAnalysisAction();
    expect(champRes.ok).toBe(true);
    if (champRes.ok) {
      expect(champRes.data.outcome).toContain("表现优异");
    }
  });

  it("AI Hub tools output amounts converted to Yuan (cents / 100) with explicit Yuan field names", async () => {
    const champTools = await import("@/core/ai-hub/tools/champion");
    const compTools = await import("@/core/ai-hub/tools/company-profile");
    const oppTools = await import("@/core/ai-hub/tools/opportunity");
    const anaTools = await import("@/core/ai-hub/tools/analytics");

    // 1. topPerformersByRevenue
    const topRes = await champTools.topPerformersByRevenueTool.execute(ctx, { limit: 5 });
    const topData = topRes.result as { topPerformers: import("@/core/ai-hub/tools/champion").TopPerformerItem[] };
    expect(topData.topPerformers.length).toBeGreaterThan(0);
    expect(topData.topPerformers[0].wonAmountYuan).toBe(8000);
    expect(topData.topPerformers[0].avgDealSizeYuan).toBe(4000);

    // 2. winLossFactorStats
    const factorRes = await champTools.winLossFactorStatsTool.execute(ctx, { dimension: "all" });
    const factorData = factorRes.result as { factors: import("@/core/ai-hub/tools/champion").FactorComparisonItem[] };
    const indFactor = factorData.factors.find(f => f.segment === "智能制造");
    expect(indFactor?.wonAmountYuan).toBe(8000);
    expect(indFactor?.lostAmountYuan).toBe(1500);

    // 3. customerPortfolioStructure
    const portRes = await compTools.customerPortfolioStructureTool.execute(ctx, {});
    const portData = portRes.result as { totalRevenueYuan: number; portfolio: import("@/core/ai-hub/tools/company-profile").PortfolioSegmentItem[] };
    expect(portData.totalRevenueYuan).toBe(8000);
    expect(portData.portfolio[0].revenueAmountYuan).toBe(8000);

    // 4. revenueBySegment
    const revRes = await compTools.revenueBySegmentTool.execute(ctx, { dimension: "all" });
    const revData = revRes.result as { revenueSegments: import("@/core/ai-hub/tools/company-profile").RevenueSegmentItem[] };
    const indRev = revData.revenueSegments.find(r => r.segment === "智能制造");
    expect(indRev?.wonAmountYuan).toBe(8000);

    // 5. getPipelineSummary & listOpportunities
    const pipeRes = await anaTools.getPipelineSummaryTool.execute(ctx, {});
    expect(pipeRes.result).toBeDefined();

    const listOppRes = await oppTools.listOpportunitiesTool.execute(ctx, { filter: "active" });
    expect(Array.isArray(listOppRes.result)).toBe(true);
  });

  it("runChampionAnalysisAgent: correctly uses Math.min to detect low-confidence sample size bottleneck", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "分析中...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: [
            {
              id: "call_top",
              type: "function",
              function: { name: "topPerformersByRevenue", arguments: '{"limit":5}' },
            },
            {
              id: "call_winloss",
              type: "function",
              function: { name: "winLossFactorStats", arguments: '{"dimension":"all"}' },
            },
          ],
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
      return {
        rawText: "## 结论分析\n来自 topPerformersByRevenue: 团队头部业绩良好。\n来自 winLossFactorStats: 胜率符合预期。",
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock",
      } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
    });

    const res = await runChampionAnalysisAgent(ctx);
    // 数据库中只有 3 个 closed 商机，即使其他维度较大，Math.min 也能准确捕获 N=3 并加上方向性假设标头
    expect(res.outcome).toMatch(/> \*\*方向性假设（低置信度，样本 N=\d+）\*\*/);
  });

  it("Group A: getPipelineSummaryTool native SQL aggregation & lead_conversions attribution priority", async () => {
    const anaTools = await import("@/core/ai-hub/tools/analytics");
    const compTools = await import("@/core/ai-hub/tools/company-profile");
    const champTools = await import("@/core/ai-hub/tools/champion");

    // 1. 插入一条在途商机 (DISCOVERY 阶段，金额 250,000 分 = 2500 元)
    const custRes = await owner.query<{ id: string }>(`select id from customers where tenant_id = '${tenantId}' limit 1`);
    const custId = custRes.rows[0].id;

    const oppRes = await owner.query<{ id: string }>(`
      insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount)
      values ('${tenantId}', '${custId}', '${adminUserId}', '在途管线测试商机', 'DISCOVERY', 250000)
      returning id
    `);
    const oppId = oppRes.rows[0].id;

    // 验证 getPipelineSummaryTool 全量原生聚合（金额分转元）
    const summaryRes = await anaTools.getPipelineSummaryTool.execute(ctx, {});
    const summary = summaryRes.result as Record<string, { count: number; amountYuan: number }>;
    expect(summary["DISCOVERY"]).toBeDefined();
    expect(summary["DISCOVERY"].count).toBeGreaterThanOrEqual(1);
    expect(summary["DISCOVERY"].amountYuan).toBeGreaterThanOrEqual(2500);

    // 2. 验证渠道归因优先读取 lead_conversions
    const leadRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, contact_phone, channel, source, status)
      values ('${tenantId}', '归因优先测试', '13811112233', '线上推广-抖音', 'manual', 'CONVERTED')
      returning id
    `);
    const leadId = leadRes.rows[0].id;

    // 写入 lead_conversions 关联
    await owner.query(`
      insert into lead_conversions (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values ('${tenantId}', '${leadId}', '${custId}', '${oppId}', '${adminUserId}')
    `);

    // 将该商机推进为 WON
    await owner.query(`
      update opportunities set stage = 'WON', actual_amount = 250000, actual_close_at = current_date where id = '${oppId}'
    `);

    // 调用 revenueBySegmentTool 验证渠道归因准确识别 '线上推广-抖音'
    const revRes = await compTools.revenueBySegmentTool.execute(ctx, { dimension: "source" });
    const revData = revRes.result as { revenueSegments: import("@/core/ai-hub/tools/company-profile").RevenueSegmentItem[] };
    const douyinSeg = revData.revenueSegments.find(s => s.segment === "线上推广-抖音");
    expect(douyinSeg).toBeDefined();
    expect(douyinSeg?.wonAmountYuan).toBe(2500);

    // 调用 winLossFactorStatsTool 验证胜率因子归因
    const factorRes = await champTools.winLossFactorStatsTool.execute(ctx, { dimension: "source" });
    const factorData = factorRes.result as { factors: import("@/core/ai-hub/tools/champion").FactorComparisonItem[] };
    const factorDouyin = factorData.factors.find(f => f.segment === "线上推广-抖音");
    expect(factorDouyin).toBeDefined();
    expect(factorDouyin?.wonAmountYuan).toBe(2500);

    // 清理创建的测试数据
    await owner.query(`delete from lead_conversions where opportunity_id = '${oppId}'`);
    await owner.query(`delete from opportunities where id = '${oppId}'`);
    await owner.query(`delete from leads where id = '${leadId}'`);
  });
});


