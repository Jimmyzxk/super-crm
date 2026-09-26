import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

let aiHubService: typeof import("@/core/ai-hub/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let salesId: string;
let customerId: string;
let opportunityId: string;
let adminCtx: TenantContext;
let salesCtx: TenantContext;

describe("企业级销售 AI 智能体与质检中心 (Enterprise AI Agent Hub)", { timeout: 25000 }, () => {
  beforeAll(async () => {
    await owner.connect();
    aiHubService = await import("@/core/ai-hub/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('AI智能体中心测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const [aRes, sRes] = await Promise.all([
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '智能体管理员', 'ADMIN') returning id",
        [tenantId, `admin-agent-${ts}@example.com`],
      ),
      owner.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '一线销售小张', 'SALES') returning id",
        [tenantId, `sales-agent-${ts}@example.com`],
      ),
    ]);

    adminId = aRes.rows[0].id;
    salesId = sRes.rows[0].id;
    adminCtx = { tenantId, userId: adminId, role: "ADMIN" };
    salesCtx = { tenantId, userId: salesId, role: "SALES" };

    // 建立客户与商机基础数据
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '智云未来科技', 'ENTERPRISE', $2) returning id",
      [tenantId, salesId],
    );
    customerId = cRes.rows[0].id;

    // 增加联系人并标记关键决策人 EB
    await owner.query(
      "insert into contacts (tenant_id, customer_id, name, phone, email, is_primary, role_tag) values ($1, $2, '李CTO', '13812345678', 'li@future.com', true, 'DECISION_MAKER')",
      [tenantId, customerId],
    );

    const oRes = await owner.query<{ id: string }>(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, '数字化质检系统升级', 'PROPOSAL', 3000000) returning id",
      [tenantId, customerId, salesId],
    );
    opportunityId = oRes.rows[0].id;

    // 添加标准产品
    const pRes = await owner.query<{ id: string }>(
      "insert into products (tenant_id, code, name, category, unit_price) values ($1, 'SKU-INSPECT-01', '智能质检引擎专业版', 'SOFTWARE', 3000000) returning id",
      [tenantId],
    );
    const productId = pRes.rows[0].id;

    // 添加产品报价明细
    await owner.query(
      "insert into opportunity_line_items (tenant_id, opportunity_id, product_id, quantity, unit_price, discount_rate, subtotal_amount) values ($1, $2, $3, 1, 3000000, 100, 3000000)",
      [tenantId, opportunityId, productId],
    );

    // 记录最近跟进
    await owner.query(
      "insert into activities (tenant_id, user_id, customer_id, type, outcome, summary) values ($1, $2, $3, 'MEETING', 'CONNECTED', '与李CTO深度对齐了智能质检落地方案')",
      [tenantId, salesId, customerId],
    );
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from ai_agent_learning_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from ai_quality_inspections where tenant_id = $1", [tenantId]);
      await owner.query("delete from ai_prompt_templates where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunity_line_items where tenant_id = $1", [tenantId]);
      await owner.query("delete from products where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await owner.end();
    if (closeDb) await closeDb();
  });

  it("1. 提示词策略池初始化与版本管理 (Prompt & Policy Pool)", async () => {
    // 首次获取自动初始化默认高质量场景提示词
    const list = await aiHubService.listPromptTemplatesService(salesCtx);
    expect(list.length).toBeGreaterThanOrEqual(4);

    const meddiccPrompt = list.find((p) => p.scene === "OPPORTUNITY_DIAGNOSTIC");
    expect(meddiccPrompt).toBeDefined();
    expect(meddiccPrompt?.variables).toContain("opportunity_name");
    expect(meddiccPrompt?.variables).toContain("eb_status");

    // 管理员在线优化提示词并版本递增
    const updated = await aiHubService.upsertPromptTemplateService(adminCtx, {
      id: meddiccPrompt!.id,
      scene: "OPPORTUNITY_DIAGNOSTIC",
      name: "企业定制版 MEDDICC 诊断策略",
      systemPrompt: "请以极其严谨的态度指出商机卡点。",
      userPromptTemplate: meddiccPrompt!.userPromptTemplate,
      variables: meddiccPrompt!.variables,
    });

    expect(updated.name).toBe("企业定制版 MEDDICC 诊断策略");
    expect(updated.version).toBeGreaterThan(meddiccPrompt!.version);
  });

  it("2. 商机 4 维客观事实质检大脑执行与评分 (Deal Quality Inspector)", async () => {
    // 对具备决策人、报价明细、跟进活跃的商机执行质检
    const report = await aiHubService.executeDealInspectionService(salesCtx, opportunityId);

    expect(report.opportunityId).toBe(opportunityId);
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(["PASSED", "NEEDS_ATTENTION"]).toContain(report.verdict);
    expect(report.dimensions.decisionMakerVerified).toBe(true);
    expect(report.dimensions.pricingLineItemsConfigured).toBe(true);
    expect(report.dimensions.followupSlaHealthy).toBe(true);
    expect(report.findings.length).toBeGreaterThan(0);

    // 检查是否持久化写入质检流水
    const inspections = await aiHubService.listQualityInspectionsService(salesCtx, opportunityId);
    expect(inspections.length).toBeGreaterThanOrEqual(1);
    expect(inspections[0].score).toBe(report.score);
  });

  it("3. 智能体自学习与打法知识库沉淀 (Agent Learning Loop)", async () => {
    const learnings = await aiHubService.listAgentLearningLogsService(salesCtx);
    expect(learnings.length).toBeGreaterThanOrEqual(1);
    expect(learnings[0].topic).toBeTruthy();
    expect(learnings[0].extractedStrategy).toBeTruthy();
  });

  it("4. 智能体大盘监控与全局健康度度量 (AI Hub Overview Metrics)", async () => {
    const overview = await aiHubService.getAiHubOverviewService(salesCtx);
    expect(overview.totalInspectionsCount).toBeGreaterThanOrEqual(1);
    expect(overview.averageInspectionScore).toBeGreaterThan(0);
    expect(overview.promptTemplateCount).toBeGreaterThanOrEqual(4);
    expect(overview.learnedStrategiesCount).toBeGreaterThanOrEqual(1);
  });

  it("5. 权限与边界防御测试 (Security & Guardrail Tests)", async () => {
    // 非管理员修改提示词模板应被严格拒绝
    await expect(
      aiHubService.upsertPromptTemplateService(salesCtx, {
        scene: "OPPORTUNITY_DIAGNOSTIC",
        name: "越权修改",
        systemPrompt: "越权",
        userPromptTemplate: "越权",
      }),
    ).rejects.toThrow(/权限不足/);

    // 对不存在的商机执行质检应抛出明确异常
    await expect(
      aiHubService.executeDealInspectionService(salesCtx, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/商机不存在/);
  });

  it("6. listStalledOpportunitiesTool: stalledDays parameter filters opportunities based on stage inactivity", async () => {
    const { listStalledOpportunitiesTool } = await import("@/core/ai-hub/tools/opportunity");

    // 默认 7 天
    const res7 = await listStalledOpportunitiesTool.execute(adminCtx, { stalledDays: 7 });
    expect(res7.result).toBeDefined();

    // 999 天（无此长期停滞商机）
    const res999 = await listStalledOpportunitiesTool.execute(adminCtx, { stalledDays: 999 });
    const items999 = res999.result as Array<unknown>;
    expect(items999.length).toBe(0);
  });

  it("7. 质检越权防御与数据隔离 (Deal Inspection Permissions)", async () => {
    // 创建另一个销售员小李
    const otherSalesRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '一线销售小李', 'SALES') returning id",
      [tenantId, `sales-li-${Date.now()}@example.com`],
    );
    const otherSalesId = otherSalesRes.rows[0].id;
    const otherSalesCtx: TenantContext = { tenantId, userId: otherSalesId, role: "SALES" };

    // 小李尝试对小张负责的商机发起质检 -> 必须被拒绝
    await expect(
      aiHubService.executeDealInspectionService(otherSalesCtx, opportunityId),
    ).rejects.toThrow(/无权质检非本人负责的商机/);

    // 管理员对小张的商机发起质检 -> 正常允许
    const adminReport = await aiHubService.executeDealInspectionService(adminCtx, opportunityId);
    expect(adminReport.opportunityId).toBe(opportunityId);

    // 小李查询质检列表 -> 仅能看到自己名下商机的质检（此时为 0 条）
    const liInspections = await aiHubService.listQualityInspectionsService(otherSalesCtx);
    expect(liInspections.length).toBe(0);

    // 小张查询质检列表 -> 能看到本人商机的质检报告
    const zhangInspections = await aiHubService.listQualityInspectionsService(salesCtx);
    expect(zhangInspections.length).toBeGreaterThanOrEqual(1);
    expect(zhangInspections.every((i) => i.opportunityId === opportunityId)).toBe(true);
  });

  it("8. 商机独立 Activity (customer_id IS NULL) 质检关联完整性", async () => {
    // 创建独立商机（无 customer_id 关联活动，只有 opportunity_id 关联活动）
    const opp2Res = await owner.query<{ id: string }>(
      `insert into opportunities (tenant_id, customer_id, name, stage, expected_amount, owner_user_id)
       values ($1, $2, '独立活动测试商机', 'PROPOSAL', 500000, $3) returning id`,
      [tenantId, customerId, salesId],
    );
    const opp2Id = opp2Res.rows[0].id;

    // 插入仅绑定 opportunity_id 的活动 (customer_id 必须为 NULL 以满足 activities_single_subject 约束)
    await owner.query(
      `insert into activities (tenant_id, opportunity_id, customer_id, lead_id, user_id, type, summary)
       values ($1, $2, null, null, $3, 'NOTE', '针对该商机进行了方案评审会议')`,
      [tenantId, opp2Id, salesId],
    );

    const report = await aiHubService.executeDealInspectionService(salesCtx, opp2Id);
    expect(report.dimensions.followupSlaHealthy).toBe(true);
    expect(report.findings.some((f) => f.includes("跟进节奏迟缓"))).toBe(false);
    expect(report.findings.some((f) => f.includes("跟进时效良好"))).toBe(true);
  });

  it("9. 洞察报告 evidence 销售端脱敏旁路防御", async () => {
    // 管理员插入包含敏感内部数据的洞察报告
    const repRes = await owner.query<{ id: string }>(
      `insert into ai_insight_reports (tenant_id, kind, period, content, evidence, sample_size, confidence, created_by)
       values ($1, 'CHAMPION_ANALYSIS', '2026-W36', '全租户经营分析：业绩 1000 万', '{"confidential": true, "grossMargin": "65%", "unmaskedProfit": 6500000}', 50, 'HIGH', $2)
       returning id`,
      [tenantId, adminId],
    );
    const repId = repRes.rows[0].id;

    // SALES 角色通过 ID 读取：evidence 必须彻底置空 {}
    const salesReport = await aiHubService.getInsightReportByIdService(salesCtx, repId);
    expect(salesReport).toBeDefined();
    expect(salesReport?.evidence).toEqual({});

    // ADMIN 角色通过 ID 读取：保留原始 evidence
    const adminReport = await aiHubService.getInsightReportByIdService(adminCtx, repId);
    expect(adminReport?.evidence).toHaveProperty("confidential", true);

    // SALES 角色通过列表读取：每一项 evidence 也必须置空 {}
    const salesList = await aiHubService.listInsightReportsService(salesCtx, "CHAMPION_ANALYSIS");
    const target = salesList.find((r) => r.id === repId);
    expect(target).toBeDefined();
    expect(target?.evidence).toEqual({});
  });

  it("10. agent-loop 模型网关网络/临时错误重试机制 (非死代码验证)", async () => {
    const gateway = await import("@/core/ai-gateway/client");
    const { runAgentLoop } = await import("@/core/ai-hub/agent-loop");
    const spy = vi.spyOn(gateway, "callLlmGatewayService");
    let callCount = 0;

    spy.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // 模拟网关返回临时 502 / 超时
        return {
          isRealLlm: false,
          error: "HTTP 502: Bad Gateway",
          tool_calls: [],
          rawText: "",
          data: null,
          provider: "mock",
          modelName: "mock-llm",
        };
      }
      // 第二轮重试成功
      return {
        isRealLlm: true,
        rawText: "恢复成功并完成分析",
        tool_calls: [],
        data: null,
        provider: "mock",
        modelName: "mock-llm",
      };
    });

    const res = await runAgentLoop(salesCtx, "测试重试任务", []);
    expect(callCount).toBe(2);
    expect(res.outcome).toBe("恢复成功并完成分析");
    spy.mockRestore();
  });
});
