import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

describe("AI Agent Morning Copilot (晨会副驾驶 v1 & 采纳闭环)", () => {
  let tenantId: string;
  let adminUserId: string;
  let salesAId: string;
  let salesBId: string;
  let salesACtx: import("@/core/tenant").TenantContext;
  let salesBCtx: import("@/core/tenant").TenantContext;
  let adminCtx: import("@/core/tenant").TenantContext;

  let runMorningCopilotAgent: typeof import("@/core/ai-hub/agents/morning-copilot").runMorningCopilotAgent;
  let getTodayMorningRecommendationsService: typeof import("@/core/ai-hub/morning-copilot-service").getTodayMorningRecommendationsService;
  let applyMorningRecommendationService: typeof import("@/core/ai-hub/morning-copilot-service").applyMorningRecommendationService;
  let dismissMorningRecommendationService: typeof import("@/core/ai-hub/morning-copilot-service").dismissMorningRecommendationService;
  let getAdoptionStatsService: typeof import("@/core/ai-hub/morning-copilot-service").getAdoptionStatsService;
  let runDailyAiInspectionService: typeof import("@/core/insight/daily-inspection").runDailyAiInspectionService;
  let llmGateway: typeof import("@/core/ai-gateway/client");

  beforeAll(async () => {
    const copilotMod = await import("@/core/ai-hub/agents/morning-copilot");
    const serviceMod = await import("@/core/ai-hub/morning-copilot-service");
    const dailyMod = await import("@/core/insight/daily-inspection");
    runMorningCopilotAgent = copilotMod.runMorningCopilotAgent;
    getTodayMorningRecommendationsService = serviceMod.getTodayMorningRecommendationsService;
    applyMorningRecommendationService = serviceMod.applyMorningRecommendationService;
    dismissMorningRecommendationService = serviceMod.dismissMorningRecommendationService;
    getAdoptionStatsService = serviceMod.getAdoptionStatsService;
    runDailyAiInspectionService = dailyMod.runDailyAiInspectionService;
    llmGateway = await import("@/core/ai-gateway/client");

    await owner.connect();
    const tRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('Morning Copilot Test Tenant') returning id`);
    tenantId = tRes.rows[0].id;

    const rand = Math.random().toString(36).substring(7);
    const adminRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', 'admin_${rand}@test.com', 'hash', 'Test Admin', 'ADMIN')
      returning id
    `);
    adminUserId = adminRes.rows[0].id;

    const salesARes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', 'sales_a_${rand}@test.com', 'hash', 'Sales Rep A', 'SALES')
      returning id
    `);
    salesAId = salesARes.rows[0].id;

    const salesBRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', 'sales_b_${rand}@test.com', 'hash', 'Sales Rep B', 'SALES')
      returning id
    `);
    salesBId = salesBRes.rows[0].id;

    adminCtx = { tenantId, userId: adminUserId, role: "ADMIN" };
    salesACtx = { tenantId, userId: salesAId, role: "SALES" };
    salesBCtx = { tenantId, userId: salesBId, role: "SALES" };

    // 插入测试客户、商机与待办
    const custRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, industry, customer_type, size, owner_user_id)
      values ('${tenantId}', '智联未来物联网', '智能制造', 'ENTERPRISE', '101-500', '${salesAId}')
      returning id
    `);
    const custId = custRes.rows[0].id;

    const oppRes = await owner.query<{ id: string }>(`
      insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount, updated_at)
      values ('${tenantId}', '${custId}', '${salesAId}', '工业云网关部署', 'PROPOSAL', 250000, now() - interval '9 days')
      returning id
    `);
    const oppId = oppRes.rows[0].id;

    await owner.query(`
      insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at, status)
      values ('${tenantId}', '${oppId}', '${salesAId}', 'FOLLOW_UP', now() + interval '2 hours', 'OPEN')
    `);

    const leadRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, company_name, contact_phone, owner_user_id, status)
      values ('${tenantId}', '张总', '前沿智造', '13800000001', '${salesAId}', 'CONTACTED')
      returning id
    `);
    const leadId = leadRes.rows[0].id;

    await owner.query(`
      insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at, status)
      values ('${tenantId}', '${leadId}', '${salesAId}', 'FIRST_RESPONSE', now() + interval '4 hours', 'OPEN')
    `);

    await owner.query(`
      insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at, status, completed_at)
      values ('${tenantId}', '${custId}', '${salesAId}', 'STAGE_PUSH', now() - interval '1 day', 'DONE', now() - interval '1 day')
    `);
  });

  afterAll(async () => {
    await owner.query(`delete from notifications where tenant_id = '${tenantId}'`);
    await owner.query(`delete from ai_agent_learning_logs where tenant_id = '${tenantId}'`);
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}'`);
    await owner.query(`delete from ai_agent_traces where tenant_id = '${tenantId}'`);
    await owner.query(`delete from audit_logs where tenant_id = '${tenantId}'`);
    await owner.query(`delete from tasks where tenant_id = '${tenantId}'`);
    await owner.query(`delete from opportunities where tenant_id = '${tenantId}'`);
    await owner.query(`delete from customers where tenant_id = '${tenantId}'`);
    await owner.query(`delete from leads where tenant_id = '${tenantId}'`);
    await owner.query(`delete from users where tenant_id = '${tenantId}'`);
    await owner.query(`delete from tenants where id = '${tenantId}'`);
    await owner.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. runMorningCopilotAgent: parses structured JSON recommendations, validates evidence citations and saves to DB & notifications", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "正在调取待办与停滞商机...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock-llm",
          tool_calls: [
            {
              id: "call_copilot_tasks",
              type: "function",
              function: { name: "listMyDueTasks", arguments: '{"status":"OPEN"}' },
            },
            {
              id: "call_copilot_stalled",
              type: "function",
              function: { name: "listStalledOpportunities", arguments: "{}" },
            },
          ],
        };
      }
      return {
        rawText: JSON.stringify([
          {
            title: "攻坚推进停滞商机【工业云网关部署】",
            reason: "来自 listStalledOpportunities: 商机处于方案报价阶段且已停滞 9 天无跟进记录；来自 listMyDueTasks: 今日存在待办跟进任务",
            suggestedAction: "CREATE_FOLLOW_UP",
            actionPayload: {
              targetName: "工业云网关部署",
              defaultNote: "致电客户确认方案评审进度",
            },
            priority: "HIGH",
            confidenceScore: 92,
          },
          {
            title: "今日需完成客户续约待办汇报",
            reason: "来自 listMyDueTasks: 存在 1 项今日到期的跟进待办，需按时闭环。",
            suggestedAction: "CREATE_TASK",
            actionPayload: {
              targetName: "智联未来物联网",
              defaultNote: "提交本周进展备忘",
            },
            priority: "MEDIUM",
            confidenceScore: 85,
          },
        ]),
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock-llm",
      };
    });

    const res = await runMorningCopilotAgent(salesACtx, salesAId);
    expect(res.rounds).toBe(2);
    expect(res.toolsUsed).toContain("listMyDueTasks");
    expect(res.toolsUsed).toContain("listStalledOpportunities");
    expect(res.recommendations).toHaveLength(2);
    expect(res.recommendations[0].title).toBe("攻坚推进停滞商机【工业云网关部署】");
    expect(res.recommendations[0].id).toBeDefined();

    // 验证写入数据库
    const dbRecs = await getTodayMorningRecommendationsService(salesACtx, salesAId);
    expect(dbRecs.length).toBeGreaterThanOrEqual(2);
    expect(dbRecs[0].isApplied).toBe(false);

    // 验证通知落库
    const notifRes = await owner.query<{ id: string; type: string; title: string }>(
      `select id, type, title from notifications where tenant_id = '${tenantId}' and user_id = '${salesAId}' and type = 'MORNING_COPILOT'`,
    );
    expect(notifRes.rows.length).toBeGreaterThanOrEqual(1);
    expect(notifRes.rows[0].title).toContain("晨会副驾驶");
  });

  it("2. runMorningCopilotAgent: rejects recommendations that lack tool evidence citations", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "调取商机数据...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock-llm",
          tool_calls: [
            {
              id: "call_copilot_opp",
              type: "function",
              function: { name: "listOpportunities", arguments: "{}" },
            },
          ],
        };
      }
      return {
        rawText: JSON.stringify([
          {
            title: "合规建议（有证据）",
            reason: "来自 listOpportunities: 发现处于初期阶段的商机",
            suggestedAction: "VIEW_DETAIL",
            actionPayload: {},
            priority: "MEDIUM",
            confidenceScore: 80,
          },
          {
            title: "违规编造建议（无证据）",
            reason: "我觉得这个客户很有潜力，应该去拜访一下（未引用任何工具数据）",
            suggestedAction: "CREATE_TASK",
            actionPayload: {},
            priority: "HIGH",
            confidenceScore: 99,
          },
        ]),
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock-llm",
      };
    });

    const res = await runMorningCopilotAgent(salesACtx, salesAId);
    // 缺失证据的建议被过滤剔除，仅保留有证据的 1 条
    expect(res.recommendations).toHaveLength(1);
    expect(res.recommendations[0].title).toBe("合规建议（有证据）");
  });

  it("3. SALES Isolation: Sales B cannot view, apply, or dismiss Sales A recommendations", async () => {
    const aRecs = await getTodayMorningRecommendationsService(salesACtx, salesAId);
    expect(aRecs.length).toBeGreaterThanOrEqual(1);
    const aRecId = aRecs[0].id;

    // Sales B 尝试查看 Sales A 的建议列表 -> FORBIDDEN
    await expect(getTodayMorningRecommendationsService(salesBCtx, salesAId)).rejects.toThrow(/无权查看其他销售/);

    // Sales B 尝试采纳 Sales A 的建议 -> FORBIDDEN
    await expect(applyMorningRecommendationService(salesBCtx, aRecId)).rejects.toThrow(/无权操作其他销售/);

    // Sales B 尝试忽略 Sales A 的建议 -> FORBIDDEN
    await expect(dismissMorningRecommendationService(salesBCtx, aRecId)).rejects.toThrow(/无权操作其他销售/);
  });

  it("4. Adoption & Dismissal feedback loop: properly updates recommendations and feeds ai_agent_learning_logs", async () => {
    const aRecs = await getTodayMorningRecommendationsService(salesACtx, salesAId);
    expect(aRecs.length).toBeGreaterThanOrEqual(2);

    const recToApply = aRecs[0];
    const recToDismiss = aRecs[1];

    // 采纳建议
    const applyRes = await applyMorningRecommendationService(salesACtx, recToApply.id, "已电话联系客户并预约演示");
    expect(applyRes.success).toBe(true);

    // 忽略建议
    const dismissRes = await dismissMorningRecommendationService(salesACtx, recToDismiss.id, "客户暂不需要再次汇报");
    expect(dismissRes.success).toBe(true);

    // 检查 recommendation 状态
    const updatedRecs = await getTodayMorningRecommendationsService(salesACtx, salesAId);
    const applied = updatedRecs.find((r) => r.id === recToApply.id);
    const dismissed = updatedRecs.find((r) => r.id === recToDismiss.id);

    expect(applied?.isApplied).toBe(true);
    expect(applied?.feedbackVerdict).toBe("HELPFUL");
    expect(dismissed?.isApplied).toBe(false);
    expect(dismissed?.feedbackVerdict).toBe("NOT_APPLICABLE");
    const auditRows = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      `select action, actor_user_id, subject_id
       from audit_logs
       where tenant_id = $1 and subject_id in ($2, $3)
         and action in ('ai_recommendation.applied', 'ai_recommendation.feedback')
       order by created_at asc`,
      [tenantId, recToApply.id, recToDismiss.id],
    );
    expect(auditRows.rows).toEqual([
      expect.objectContaining({ action: "ai_recommendation.applied", actor_user_id: salesAId, subject_id: recToApply.id }),
      expect.objectContaining({ action: "ai_recommendation.feedback", actor_user_id: salesAId, subject_id: recToDismiss.id }),
    ]);

    // 检查学习飞轮 ai_agent_learning_logs
    const logsRes = await owner.query<{
      source_type: string;
      source_id: string;
      topic: string;
      extracted_strategy: string;
      effectiveness_score: string;
      is_promoted_to_pool: boolean;
    }>(
      `select source_type, source_id, topic, extracted_strategy, effectiveness_score, is_promoted_to_pool
       from ai_agent_learning_logs
       where tenant_id = '${tenantId}' and source_type = 'MORNING_COPILOT'
       order by created_at desc limit 2`,
    );
    expect(logsRes.rows.length).toBe(2);

    // 检查采纳率统计
    const stats = await getAdoptionStatsService(adminCtx, 7);
    expect(stats.totalGenerated).toBeGreaterThanOrEqual(2);
    expect(stats.appliedCount).toBeGreaterThanOrEqual(1);
    expect(stats.dismissedCount).toBeGreaterThanOrEqual(1);
    expect(stats.adoptionRate).toBeGreaterThan(0);
  });

  it("5. Daily inspection cron orchestration: scans active sales reps with single-user error isolation and failure resilience", async () => {
    // 清理可能遗留的推荐与通知，确保测试环境干净
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}'`);
    await owner.query(`delete from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`);

    // 1. 模拟 LLM 网关正常返回，验证完整编排逐销售扫描
    const llmSpy = vi.spyOn(llmGateway, "callLlmGatewayService").mockResolvedValue({
      rawText: "[]",
      data: null,
      isRealLlm: true,
      provider: "mock",
      modelName: "mock-llm",
    });

    const result = await runDailyAiInspectionService(new Date());
    expect(result.scannedTenants).toBeGreaterThan(0);
    expect(result.totalMorningCopilotRuns).toBeGreaterThanOrEqual(2); // salesA & salesB in this tenant

    // 清理记录以验证子步骤2（单人异常容错）
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}'`);
    await owner.query(`delete from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`);

    // 2. 逐人隔离与单人异常容错验证：通过 deps 注入模拟特定销售抛出异常，断言整个巡检批次不崩溃且其他销售正常完成
    let hasSalesAFailed = false;
    const resilientResult = await runDailyAiInspectionService(new Date(), {
      runMorningCopilotAgent: async (ctx, targetUserId) => {
        if (targetUserId === salesAId && !hasSalesAFailed) {
          hasSalesAFailed = true;
          throw new Error("Simulated transient LLM or DB error for sales rep A");
        }
        return {
          outcome: "mock-resilience",
          rounds: 1,
          toolsUsed: [],
          messages: [],
          recommendations: [],
        };
      },
    });
    expect(resilientResult.scannedTenants).toBeGreaterThan(0);
    expect(resilientResult.totalMorningCopilotRuns).toBeGreaterThanOrEqual(1);
    expect(hasSalesAFailed).toBe(true);

    llmSpy.mockRestore();
  }, 30000);

  it("6. listMyDueTasks tool direct execution: runs in OPEN and ALL status without error and returns complete structure", async () => {
    const { listMyDueTasksTool } = await import("@/core/ai-hub/tools/tasks");

    // 1. OPEN status
    const openRes = await listMyDueTasksTool.execute(salesACtx, { status: "OPEN" });
    const openData = openRes.result as {
      totalTasks: number;
      tasks: Array<{
        id: string;
        type: string;
        targetType: string;
        targetName: string;
        status: string;
        dueAt: string;
      }>;
    };
    expect(openData.totalTasks).toBeGreaterThanOrEqual(2);
    expect(openData.tasks.every((t) => t.status === "OPEN")).toBe(true);
    expect(openData.tasks.some((t) => t.targetType === "lead" && t.targetName === "张总")).toBe(true);
    expect(openData.tasks.some((t) => t.targetType === "opportunity" && t.targetName === "工业云网关部署")).toBe(true);

    // 2. ALL status
    const allRes = await listMyDueTasksTool.execute(salesACtx, { status: "ALL" });
    const allData = allRes.result as {
      totalTasks: number;
      tasks: Array<{
        id: string;
        type: string;
        targetType: string;
        targetName: string;
        status: string;
        dueAt: string;
      }>;
    };
    expect(allData.totalTasks).toBeGreaterThanOrEqual(3);
    expect(allData.tasks.some((t) => t.status === "DONE")).toBe(true);
    expect(allData.tasks.some((t) => t.targetType === "customer" && t.targetName === "智联未来物联网")).toBe(true);

    // 3. Default (no args)
    const defaultRes = await listMyDueTasksTool.execute(salesACtx, {});
    const defaultData = defaultRes.result as {
      totalTasks: number;
      tasks: Array<{ id: string; status: string }>;
    };
    expect(defaultData.totalTasks).toBeGreaterThanOrEqual(2);
    expect(defaultData.tasks.every((t) => t.status === "OPEN")).toBe(true);
  });

  it("7. Idempotency Gate: same-day repeated invocations trigger 0 LLM calls and 0 new records; cross-day invocations execute normally", async () => {
    // 1. 清理当前测试租户的历史推荐与通知
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}'`);
    await owner.query(`delete from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`);

    let tenantLlmCallCount = 0;
    const llmSpy = vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async (tenant) => {
      if (tenant.tenantId === tenantId) {
        tenantLlmCallCount++;
      }
      return {
        rawText: JSON.stringify([
          {
            title: `今日重点攻坚商机 (调用序号 #${tenantLlmCallCount})`,
            reason: "来自 listOpportunities: 发现处于初期阶段的商机",
            suggestedAction: "VIEW_DETAIL",
            actionPayload: {},
            priority: "HIGH",
            confidenceScore: 92,
          },
        ]),
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock-llm",
      };
    });

    const day1 = new Date("2026-09-02T08:30:00.000Z");

    // --- 第一轮运行（Day 1 首次巡检）---
    const firstRunResult = await runDailyAiInspectionService(day1);
    const tenantDetail1 = firstRunResult.details.find((d) => d.tenantId === tenantId);
    expect(tenantDetail1).toBeDefined();
    expect(tenantDetail1?.morningCopilotRuns).toBe(2); // Sales A + Sales B
    expect(tenantLlmCallCount).toBe(4); // 2 sales * 2 agent loop rounds

    const recCountAfterFirst = await owner.query<{ count: string }>(
      `select count(*)::text as count from ai_recommendations where tenant_id = '${tenantId}' and recommendation_type = 'MORNING_COPILOT'`,
    );
    const notifCountAfterFirst = await owner.query<{ count: string }>(
      `select count(*)::text as count from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`,
    );
    expect(Number(recCountAfterFirst.rows[0].count)).toBe(2);
    expect(Number(notifCountAfterFirst.rows[0].count)).toBe(2);

    // --- 第二轮运行（Day 1 5分钟后再次触发 cron：08:35）---
    const day1FiveMinLater = new Date("2026-09-02T08:35:00.000Z");
    const secondRunResult = await runDailyAiInspectionService(day1FiveMinLater);
    const tenantDetail2 = secondRunResult.details.find((d) => d.tenantId === tenantId);
    expect(tenantDetail2).toBeDefined();
    // 关键断言：幂等闸门拦截，该租户下今日晨会执行次数为 0，LLM 计数器保持不变！
    expect(tenantDetail2?.morningCopilotRuns).toBe(0);
    expect(tenantLlmCallCount).toBe(4); // 零新增 LLM 调用（保持 4）

    // 数据库无新增记录
    const recCountAfterSecond = await owner.query<{ count: string }>(
      `select count(*)::text as count from ai_recommendations where tenant_id = '${tenantId}' and recommendation_type = 'MORNING_COPILOT'`,
    );
    const notifCountAfterSecond = await owner.query<{ count: string }>(
      `select count(*)::text as count from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`,
    );
    expect(Number(recCountAfterSecond.rows[0].count)).toBe(2);
    expect(Number(notifCountAfterSecond.rows[0].count)).toBe(2);

    // --- 第三轮运行（跨天场景：Day 2 08:30）---
    const day2 = new Date("2026-09-03T08:30:00.000Z");
    const thirdRunResult = await runDailyAiInspectionService(day2);
    const tenantDetail3 = thirdRunResult.details.find((d) => d.tenantId === tenantId);
    expect(tenantDetail3).toBeDefined();
    // 关键断言：跨天后幂等闸门放行，重新为销售生成新的一天建议
    expect(tenantDetail3?.morningCopilotRuns).toBe(2);
    expect(tenantLlmCallCount).toBe(8); // 跨天再次调用（4 -> 8）

    // 数据库产生新一天的数据
    const recCountAfterThird = await owner.query<{ count: string }>(
      `select count(*)::text as count from ai_recommendations where tenant_id = '${tenantId}' and recommendation_type = 'MORNING_COPILOT'`,
    );
    const notifCountAfterThird = await owner.query<{ count: string }>(
      `select count(*)::text as count from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`,
    );
    expect(Number(recCountAfterThird.rows[0].count)).toBe(4);
    expect(Number(notifCountAfterThird.rows[0].count)).toBe(4);

    llmSpy.mockRestore();
  }, 30000);

  it("8. Monthly Insight Reports Idempotency Gate: Day 1 of month runs once, repeated invocations pre-check and skip LLM agent calls", async () => {
    // 1. 清理当前测试租户的 2026-09 月度报告
    await owner.query(`delete from ai_insight_reports where tenant_id = '${tenantId}' and period = '2026-09'`);
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}'`);
    await owner.query(`delete from notifications where tenant_id = '${tenantId}' and type = 'MORNING_COPILOT'`);

    let monthlyLlmCalls = 0;
    const llmSpy = vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async (tenant) => {
      if (tenant.tenantId === tenantId) {
        monthlyLlmCalls++;
      }
      return {
        rawText: "[]",
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock-llm",
      };
    });

    // 1.5 门槛测试：模拟 1 日 00:30（UTC 时间 2026-09-30 16:30），因未到 08:30 门槛，月报被拦截不抢跑
    const monthDay1Midnight = new Date("2026-09-30T16:30:00.000Z");
    await runDailyAiInspectionService(monthDay1Midnight);
    const reportsMidnight = await owner.query<{ count: string }>(
      `select count(*)::text as count from ai_insight_reports where tenant_id = '${tenantId}' and period = '2026-09'`,
    );
    expect(Number(reportsMidnight.rows[0].count)).toBe(0);

    // 2. 模拟每月 1 日 08:30 (Shanghai time: 2026-10-01 08:30:00 = 2026-10-01T00:30:00.000Z)
    const monthDay1 = new Date("2026-10-01T00:30:00.000Z");
    await runDailyAiInspectionService(monthDay1);

    const reportsAfterRun1 = await owner.query<{ kind: string; period: string }>(
      `select kind, period from ai_insight_reports where tenant_id = '${tenantId}' and period = '2026-09' order by kind asc`,
    );
    expect(reportsAfterRun1.rows.length).toBe(2);
    expect(reportsAfterRun1.rows.map((r) => r.kind)).toEqual(["CHAMPION_ANALYSIS", "COMPANY_PROFILE"]);

    const callsAfterRun1 = monthlyLlmCalls;
    expect(callsAfterRun1).toBeGreaterThan(0);

    // 3. 模拟 5 分钟后再次触发定时任务 (2026-10-01 08:35)
    const monthDay1FiveMinLater = new Date("2026-10-01T00:35:00.000Z");
    await runDailyAiInspectionService(monthDay1FiveMinLater);

    // 关键断言：预检查重闸门生效，报告不重复生成且 LLM 计数器保持不变！
    expect(monthlyLlmCalls).toBe(callsAfterRun1); // 零新增 LLM 调用

    const reportsAfterRun2 = await owner.query<{ kind: string; period: string }>(
      `select kind, period from ai_insight_reports where tenant_id = '${tenantId}' and period = '2026-09' order by kind asc`,
    );
    expect(reportsAfterRun2.rows.length).toBe(2);

    llmSpy.mockRestore();
  }, 30000);

  it("10. Token Usage Metering & Observability: Trace correctly records real aggregated usage from LLM response", async () => {
    const { runAgentLoop } = await import("@/core/ai-hub/agent-loop");

    const llmSpy = vi.spyOn(llmGateway, "callLlmGatewayService").mockResolvedValue({
      rawText: "经分析，当前管线健康度良好，建议按期跟进。",
      data: null,
      isRealLlm: true,
      provider: "mock-deepseek",
      modelName: "deepseek-chat",
      usage: {
        promptTokens: 320,
        completionTokens: 85,
        totalTokens: 405,
        promptCacheHitTokens: 120,
      },
    });

    const loopRes = await runAgentLoop(adminCtx, "测试真实 Token 计量与 Trace 持久化", []);
    expect(loopRes.tokenUsage).toBeDefined();
    expect(loopRes.tokenUsage?.promptTokens).toBe(320);
    expect(loopRes.tokenUsage?.completionTokens).toBe(85);
    expect(loopRes.tokenUsage?.totalTokens).toBe(405);
    expect(loopRes.tokenUsage?.promptCacheHitTokens).toBe(120);

    // 查询数据库验证 ai_agent_traces 表中真实写入的 JSON 数据
    const traceRow = await owner.query<{ token_usage: unknown }>(
      `select token_usage from ai_agent_traces where tenant_id = '${tenantId}' and task like '%测试真实 Token 计量%' order by created_at desc limit 1`
    );
    expect(traceRow.rows.length).toBe(1);
    const savedUsage = traceRow.rows[0].token_usage as Record<string, number>;
    expect(savedUsage.promptTokens).toBe(320);
    expect(savedUsage.completionTokens).toBe(85);
    expect(savedUsage.totalTokens).toBe(405);
    expect(savedUsage.promptCacheHitTokens).toBe(120);

    llmSpy.mockRestore();
  }, 30000);

  it("12. Morning Copilot UUID Injection Prevention: handles placeholder/invalid UUID strings gracefully without throwing 22P02", async () => {
    // 清理可能遗留的推荐
    await owner.query(`delete from ai_recommendations where tenant_id = '${tenantId}' and user_id = '${salesAId}'`);

    const mockLlmResponse = JSON.stringify([
      {
        title: "推进【智造先锋】方案报价",
        reason: "来自 listStalledOpportunities: 商机已停滞8天，需尽快跟进",
        suggestedAction: "CREATE_FOLLOW_UP",
        actionPayload: {
          opportunityId: "uuid（如有）",
          customerId: "非法UUID文本",
          leadId: "",
          targetName: "智造先锋",
          defaultNote: "沟通二期方案",
        },
        priority: "HIGH",
        confidenceScore: 90,
      },
    ]);

    const llmSpy = vi.spyOn(llmGateway, "callLlmGatewayService").mockResolvedValue({
      rawText: `\`\`\`json\n${mockLlmResponse}\n\`\`\``,
      data: null,
      isRealLlm: true,
      provider: "mock",
      modelName: "mock-llm",
    });

    const agentRes = await runMorningCopilotAgent(salesACtx, salesAId, new Date());
    expect(agentRes.recommendations.length).toBe(1);

    // 查询数据库验证入库结果：事务不回滚，且非法 UUID 字段存入 null
    const recRow = await owner.query<{
      opportunity_id: string | null;
      customer_id: string | null;
      lead_id: string | null;
      title: string;
    }>(
      `select opportunity_id, customer_id, lead_id, title from ai_recommendations
       where tenant_id = '${tenantId}' and user_id = '${salesAId}' and title = '推进【智造先锋】方案报价'`
    );
    expect(recRow.rows.length).toBe(1);
    expect(recRow.rows[0].opportunity_id).toBeNull();
    expect(recRow.rows[0].customer_id).toBeNull();
    expect(recRow.rows[0].lead_id).toBeNull();

    llmSpy.mockRestore();
  }, 30000);

  it("13. Cartesian Product Prevention in Source Analytics: coalesces dual from_lead_id without duplicating metrics", async () => {
    const { winLossFactorStatsTool } = await import("@/core/ai-hub/tools/champion");
    const { revenueBySegmentTool } = await import("@/core/ai-hub/tools/company-profile");

    // 构造双 from_lead_id 场景：客户有 lead1，商机有 lead2
    const lead1Res = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, source, channel, status)
      values ('${tenantId}', '${adminUserId}', '笛卡尔积测试线索1', '13800000001', 'manual', '百度搜索', 'CONVERTED')
      returning id
    `);
    const lead1Id = lead1Res.rows[0].id;

    const lead2Res = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, source, channel, status)
      values ('${tenantId}', '${adminUserId}', '笛卡尔积测试线索2', '13800000002', 'manual', '自然搜索', 'CONVERTED')
      returning id
    `);
    const lead2Id = lead2Res.rows[0].id;

    const custRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, owner_user_id, from_lead_id, customer_type)
      values ('${tenantId}', '笛卡尔积测试客户', '${adminUserId}', '${lead1Id}', 'ENTERPRISE')
      returning id
    `);
    const testCustId = custRes.rows[0].id;

    const oppRes = await owner.query<{ id: string }>(`
      insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, actual_amount, expected_amount, from_lead_id, actual_close_at)
      values ('${tenantId}', '${testCustId}', '${adminUserId}', '笛卡尔积测试商机', 'WON', 100000, 100000, '${lead2Id}', now())
      returning id
    `);
    const testOppId = oppRes.rows[0].id;

    // 1. 调用 winLossFactorStatsTool (champion)
    const champRes = await winLossFactorStatsTool.execute(adminCtx, { dimension: "source" });
    const champResult = champRes as { result: { factors: Array<{ dimension: string; segment: string; wonCount: number; wonAmountYuan: number; totalCount: number }> } };
    const naturalSearchItem = champResult.result.factors.find((r) => r.segment === "自然搜索");
    expect(naturalSearchItem).toBeDefined();
    // 关键断言：商机优先匹配 lead2（自然搜索），且仅计 1 次，绝对不翻倍！
    expect(naturalSearchItem?.wonCount).toBe(1);
    expect(naturalSearchItem?.totalCount).toBe(1);
    expect(naturalSearchItem?.wonAmountYuan).toBe(1000);

    // 2. 调用 revenueBySegmentTool (company-profile)
    const compRes = await revenueBySegmentTool.execute(adminCtx, { dimension: "source" });
    const compResult = compRes as { result: { revenueSegments: Array<{ dimension: string; segment: string; wonCount: number; wonAmountYuan: number; totalDeals: number }> } };
    const compSearchItem = compResult.result.revenueSegments.find((r) => r.segment === "自然搜索");
    expect(compSearchItem).toBeDefined();
    expect(compSearchItem?.wonCount).toBe(1);
    expect(compSearchItem?.totalDeals).toBe(1);
    expect(compSearchItem?.wonAmountYuan).toBe(1000);

    // 清理夹具
    await owner.query(`delete from opportunities where id = '${testOppId}'`);
    await owner.query(`delete from customers where id = '${testCustId}'`);
    await owner.query(`delete from leads where id in ('${lead1Id}', '${lead2Id}')`);
  }, 30000);

});

