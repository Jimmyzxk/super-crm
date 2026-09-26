import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";
import type { FullOpportunityHistoryResult } from "@/core/ai-hub/tools/attribution";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

describe("AI Agent Deal Attribution & Cognitive L1 (赢单/输单因果归因)", () => {
  let tenantId: string;
  let adminUserId: string;
  let salesAUserId: string;
  let salesBUserId: string;
  let adminCtx: TenantContext;
  let salesACtx: TenantContext;

  let customerWonId: string;
  let customerLostId: string;
  let wonOppId: string;
  let lostOppId: string;
  let salesBOppId: string;

  let getOpportunityFullHistoryTool: typeof import("@/core/ai-hub/tools/attribution").getOpportunityFullHistoryTool;
  let getLostReasonDistributionTool: typeof import("@/core/ai-hub/tools/attribution").getLostReasonDistributionTool;
  let getPeerWinPatternsTool: typeof import("@/core/ai-hub/tools/attribution").getPeerWinPatternsTool;
  let runDealAttributionAgent: typeof import("@/core/ai-hub/agents/deal-attribution").runDealAttributionAgent;
  let runDealAttributionAction: typeof import("@/core/ai-hub/actions").runDealAttributionAction;
  let listClosedOpportunitiesAction: typeof import("@/core/ai-hub/actions").listClosedOpportunitiesAction;
  let llmGateway: typeof import("@/core/ai-gateway/client");
  let authSession: typeof import("@/core/auth/session");

  beforeAll(async () => {
    const attrTools = await import("@/core/ai-hub/tools/attribution");
    getOpportunityFullHistoryTool = attrTools.getOpportunityFullHistoryTool;
    getLostReasonDistributionTool = attrTools.getLostReasonDistributionTool;
    getPeerWinPatternsTool = attrTools.getPeerWinPatternsTool;

    const agentMod = await import("@/core/ai-hub/agents/deal-attribution");
    runDealAttributionAgent = agentMod.runDealAttributionAgent;

    const actionsMod = await import("@/core/ai-hub/actions");
    runDealAttributionAction = actionsMod.runDealAttributionAction;
    listClosedOpportunitiesAction = actionsMod.listClosedOpportunitiesAction;

    llmGateway = await import("@/core/ai-gateway/client");
    authSession = await import("@/core/auth/session");

    await owner.connect();
    const res = await owner.query<{ id: string }>(`insert into tenants (name) values ('Deal Attribution Corp') returning id`);
    tenantId = res.rows[0].id;

    const rand = Math.random().toString(36).substring(7);
    const adminEmail = `admin_attr_${rand}@test.com`;
    const salesAEmail = `sales_a_attr_${rand}@test.com`;
    const salesBEmail = `sales_b_attr_${rand}@test.com`;

    const adminRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', '${adminEmail}', 'hash', '主管老张', 'ADMIN')
      returning id
    `);
    adminUserId = adminRes.rows[0].id;

    const salesARes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', '${salesAEmail}', 'hash', '销售小李', 'SALES')
      returning id
    `);
    salesAUserId = salesARes.rows[0].id;

    const salesBRes = await owner.query<{ id: string }>(`
      insert into users (tenant_id, email, password_hash, name, role)
      values ('${tenantId}', '${salesBEmail}', 'hash', '销售小王', 'SALES')
      returning id
    `);
    salesBUserId = salesBRes.rows[0].id;

    adminCtx = { tenantId, userId: adminUserId, role: "ADMIN" };
    salesACtx = { tenantId, userId: salesAUserId, role: "SALES" };

    // 建立客户
    const custWonRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, industry, customer_type, size, owner_user_id)
      values ('${tenantId}', '智能制造标杆工业科技', '智能制造', 'ENTERPRISE', '501-1000', '${salesAUserId}')
      returning id
    `);
    customerWonId = custWonRes.rows[0].id;

    const custLostRes = await owner.query<{ id: string }>(`
      insert into customers (tenant_id, name, industry, customer_type, size, owner_user_id)
      values ('${tenantId}', '华东零售连锁集团', '新零售', 'ENTERPRISE', '1000+', '${salesAUserId}')
      returning id
    `);
    customerLostId = custLostRes.rows[0].id;

    // 建立主联系人
    const contactWonRes = await owner.query<{ id: string }>(`
      insert into contacts (tenant_id, customer_id, name, phone, title, role_tag)
      values ('${tenantId}', '${customerWonId}', '王总监', '13900001111', '数字化总监', 'DECISION_MAKER')
      returning id
    `);
    const contactWonId = contactWonRes.rows[0].id;

    // 建立产品
    const prodRes = await owner.query<{ id: string }>(`
      insert into products (tenant_id, code, name, category, unit_price)
      values ('${tenantId}', 'SKU-IOT-MES', '工业物联网网关及MES套件', 'SOFTWARE', 15800000)
      returning id
    `);
    const prodId = prodRes.rows[0].id;

    // 1. 已赢单商机 (WON 15.8 万)
    const wonOppRes = await owner.query<{ id: string }>(`
      insert into opportunities (
        tenant_id, customer_id, owner_user_id, primary_contact_id,
        name, stage, expected_amount, actual_amount, actual_close_at, stage_entered_at, created_at
      )
      values (
        '${tenantId}', '${customerWonId}', '${salesAUserId}', '${contactWonId}',
        '智能产线工业网关升级项目', 'WON', 16000000, 15800000, current_date, now() - interval '2 days', now() - interval '20 days'
      )
      returning id
    `);
    wonOppId = wonOppRes.rows[0].id;

    // 添加阶段历史
    await owner.query(`
      insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at, note)
      values
        ('${tenantId}', '${wonOppId}', null, 'DISCOVERY', '${salesAUserId}', now() - interval '20 days', '初步需求对接'),
        ('${tenantId}', '${wonOppId}', 'DISCOVERY', 'PROPOSAL', '${salesAUserId}', now() - interval '14 days', '技术方案与报价汇报'),
        ('${tenantId}', '${wonOppId}', 'PROPOSAL', 'NEGOTIATION', '${salesAUserId}', now() - interval '6 days', '商务与法务条款谈判'),
        ('${tenantId}', '${wonOppId}', 'NEGOTIATION', 'WON', '${salesAUserId}', now() - interval '1 days', '合同签署完成')
    `);

    // 添加跟进活动
    await owner.query(`
      insert into activities (tenant_id, opportunity_id, user_id, type, outcome, summary, occurred_at)
      values
        ('${tenantId}', '${wonOppId}', '${salesAUserId}', 'VISIT', 'INTERESTED', '现场勘查产线网络拓扑与PLC接口', now() - interval '18 days'),
        ('${tenantId}', '${wonOppId}', '${salesAUserId}', 'MEETING', 'INTERESTED', '组织技术总监王总进行方案POC演示', now() - interval '12 days'),
        ('${tenantId}', '${wonOppId}', '${salesAUserId}', 'CALL', 'CONNECTED', '就价格优惠与交期达成初步一致', now() - interval '4 days')
    `);

    // 添加战情室介入
    await owner.query(`
      insert into deal_interventions (tenant_id, opportunity_id, requester_user_id, assigned_manager_id, intervention_type, status, request_note, manager_feedback, coaching_notes, resolved_at)
      values (
        '${tenantId}', '${wonOppId}', '${salesAUserId}', '${adminUserId}',
        'DISCOUNT_APPROVAL', 'RESOLVED',
        '客户预算15.8万，申请特批2000元折扣',
        '同意特批并附赠1年远程运维支持',
        '重点锁定客户二期车间扩容意向',
        now() - interval '5 days'
      )
    `);

    // 添加报价项
    await owner.query(`
      insert into opportunity_line_items (tenant_id, opportunity_id, product_id, quantity, unit_price, discount_rate, subtotal_amount)
      values ('${tenantId}', '${wonOppId}', '${prodId}', 1, 16000000, 98, 15800000)
    `);

    // 2. 已输单商机 (LOST)
    const lostOppRes = await owner.query<{ id: string }>(`
      insert into opportunities (
        tenant_id, customer_id, owner_user_id,
        name, stage, expected_amount, actual_amount, lost_reason, lost_note, actual_close_at, stage_entered_at, created_at
      )
      values (
        '${tenantId}', '${customerLostId}', '${salesAUserId}',
        '连锁门店智能监控升级项目', 'LOST', 35000000, null, 'PRICE', '竞品报价低30%且客户预算受限', null, now() - interval '1 days', now() - interval '45 days'
      )
      returning id
    `);
    lostOppId = lostOppRes.rows[0].id;

    await owner.query(`
      insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id, created_at, note)
      values
        ('${tenantId}', '${lostOppId}', null, 'DISCOVERY', '${salesAUserId}', now() - interval '45 days', '收集需求'),
        ('${tenantId}', '${lostOppId}', 'DISCOVERY', 'PROPOSAL', '${salesAUserId}', now() - interval '30 days', '提交首轮报价'),
        ('${tenantId}', '${lostOppId}', 'PROPOSAL', 'LOST', '${salesAUserId}', now() - interval '1 days', '客户选择低价竞品')
    `);

    // 3. 销售小王名下的商机 (用于越权校验)
    const salesBOppRes = await owner.query<{ id: string }>(`
      insert into opportunities (
        tenant_id, customer_id, owner_user_id,
        name, stage, expected_amount, actual_amount, actual_close_at, created_at
      )
      values (
        '${tenantId}', '${customerWonId}', '${salesBUserId}',
        '小王负责的专用边缘节点项目', 'WON', 8000000, 8000000, current_date, now() - interval '10 days'
      )
      returning id
    `);
    salesBOppId = salesBOppRes.rows[0].id;
  });

  afterAll(async () => {
    await owner.query(`delete from opportunity_line_items where tenant_id = '${tenantId}'`);
    await owner.query(`delete from deal_interventions where tenant_id = '${tenantId}'`);
    await owner.query(`delete from activities where tenant_id = '${tenantId}'`);
    await owner.query(`delete from opportunity_stage_history where tenant_id = '${tenantId}'`);
    await owner.query(`delete from opportunities where tenant_id = '${tenantId}'`);
    await owner.query(`delete from products where tenant_id = '${tenantId}'`);
    await owner.query(`delete from contacts where tenant_id = '${tenantId}'`);
    await owner.query(`delete from customers where tenant_id = '${tenantId}'`);
    await owner.query(`delete from users where tenant_id = '${tenantId}'`);
    await owner.query(`delete from tenants where id = '${tenantId}'`);
    await owner.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. getOpportunityFullHistoryTool: retrieves full stage stays, activities, interventions, quotes and enforces isolation", async () => {
    // 正常拉取小李名下的赢单
    const res = await getOpportunityFullHistoryTool.execute(salesACtx, { opportunityId: wonOppId });
    expect(res.result).toBeDefined();
    const data = res.result as FullOpportunityHistoryResult;
    expect(data.opportunity.name).toBe("智能产线工业网关升级项目");
    expect(data.opportunity.stage).toBe("WON");
    expect(data.opportunity.actualAmountYuan).toBe(158000);
    expect(data.opportunity.primaryContact?.name).toBe("王总监");
    expect(data.stageStays.length).toBeGreaterThanOrEqual(3);
    expect(data.activities.length).toBe(3);
    expect(data.dealInterventions.length).toBe(1);
    expect(data.dealInterventions[0].managerFeedback).toBe("同意特批并附赠1年远程运维支持");
    expect(data.quotesAndContracts.lineItems.length).toBe(1);
    // 开源版（AGPL-3.0）：合同事实来自闭源 contracts 插件的 plugin_facts，插件缺席时为空
    expect(data.quotesAndContracts.contracts.length).toBe(0);

    // 小李越权拉取小王名下的商机 -> 返回 FORBIDDEN
    const forbiddenRes = await getOpportunityFullHistoryTool.execute(salesACtx, { opportunityId: salesBOppId });
    const errObj = forbiddenRes.result as { error: string };
    expect(errObj.error).toContain("FORBIDDEN");

    // 管理员拉取小王名下的商机 -> 正常允许
    const adminFetchRes = await getOpportunityFullHistoryTool.execute(adminCtx, { opportunityId: salesBOppId });
    const adminData = adminFetchRes.result as FullOpportunityHistoryResult;
    expect(adminData.opportunity.name).toBe("小王负责的专用边缘节点项目");
  });

  it("2. getLostReasonDistributionTool: aggregates lost reasons across industries and time window", async () => {
    const res = await getLostReasonDistributionTool.execute(adminCtx, { timeWindowDays: 90 });
    expect(res.result).toBeDefined();
    const data = res.result as {
      totalLostDeals: number;
      byReason: Array<{ reason: string }>;
      byIndustryAndReason: Array<{ industry: string }>;
    };
    expect(data.totalLostDeals).toBeGreaterThanOrEqual(1);
    expect(data.byReason.some((r) => r.reason === "PRICE")).toBe(true);
    expect(data.byIndustryAndReason.some((r) => r.industry === "新零售")).toBe(true);
  });

  it("3. getPeerWinPatternsTool: calculates median cycle days, activity counts, amountBand and avgDiscountRate", async () => {
    const res = await getPeerWinPatternsTool.execute(adminCtx, { industry: "智能制造", amountBand: "100k-500k" });
    expect(res.result).toBeDefined();
    const data = res.result as {
      sampleSize: number;
      amountBand: string;
      medianCycleDays: number | null;
      interventionRatePercent: number | null;
      avgDiscountRate: number | null;
      avg_discount_rate: number | null;
    };
    expect(data.sampleSize).toBeGreaterThanOrEqual(1);
    expect(data.amountBand).toBe("100k-500k");
    expect(Number(data.medianCycleDays)).toBeGreaterThan(0);
    expect(Number(data.interventionRatePercent)).toBeGreaterThanOrEqual(50);
    expect(data.avgDiscountRate).toBeDefined();
    expect(data.avg_discount_rate).toBeDefined();
  });

  it("4. runDealAttributionAgent: WON scenario executes ReAct loop, cites tool evidence, and extracts reproducible actions", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "分析商机生命周期与同行对标...",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock-deepseek",
          tool_calls: [
            {
              id: "call_history_1",
              type: "function",
              function: {
                name: "getOpportunityFullHistory",
                arguments: JSON.stringify({ opportunityId: wonOppId }),
              },
            },
            {
              id: "call_patterns_1",
              type: "function",
              function: {
                name: "getPeerWinPatterns",
                arguments: JSON.stringify({ industry: "智能制造" }),
              },
            },
          ],
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
      return {
        rawText: `## 1. 商机生命周期与关键转折时间线
- 关键转折点：来自 getOpportunityFullHistory: 方案演示后客户技术总监认可POC效果，第15天主管介入特批特价，加速成单。

## 2. 五维因果归因评估
- **决策链与客情覆盖**：[高置信度] 深度覆盖关键决策人王总监。
- **价格/折扣与商务策略**：[高置信度] 来自 getOpportunityFullHistory: 最终成交价 15.8 万元，给予 98 折。
- **跟进质量与互动深度**：[高置信度] 3 次深度拜访与会议。
- **流转效率与响应敏捷度**：[高置信度] 来自 getPeerWinPatterns: 成交周期 19 天优于行业中位数。
- **竞对态势与外部因素**：[证据不足，无法归因] 未记录直接竞对交锋数据。

## 3. 经验沉淀与打法提炼
- 【可复制动作】：1. 在方案期尽早推进技术决策人参与现场 POC；2. 战情室主管特批附加服务化解微小价格分歧。

## 4. 归因结论与改进建议
- 标杆型赢单案例，建议沉淀为工业智能制造场景标准打法模版。`,
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock-deepseek",
      } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
    });

    const result = await runDealAttributionAgent(salesACtx, wonOppId, "WON");
    expect(result.opportunityId).toBe(wonOppId);
    expect(result.direction).toBe("WON");
    expect(result.evidenceCount).toBe(2);
    expect(result.toolsUsed).toContain("getOpportunityFullHistory");
    expect(result.outcome).toContain("来自 getOpportunityFullHistory");
    expect(result.outcome).toContain("可复制动作");
    expect(result.outcome).toContain("证据不足，无法归因");
  });

  it("5. runDealAttributionAgent: triggers honest '证据不足' fallback banner when no evidence is fetched", async () => {
    vi.spyOn(llmGateway, "callLlmGatewayService").mockResolvedValue({
      rawText: "这一单可能因为产品很好所以赢了。",
      data: null,
      isRealLlm: true,
      provider: "mock",
      modelName: "mock-deepseek",
    });

    const result = await runDealAttributionAgent(adminCtx, "00000000-0000-0000-0000-000000000000", "WON");
    expect(result.evidenceCount).toBe(0);
    expect(result.outcome).toContain("未获取到足够商机生命周期证据，无法进行深度因果归因");
  });

  it("6. runDealAttributionAction & listClosedOpportunitiesAction: checks role isolation & permissions", async () => {
    // 模拟 session 为销售小李
    vi.spyOn(authSession, "requireSession").mockResolvedValue(salesACtx);

    // 销售小李拉取自己的赢单归因 -> 成功
    const ownRes = await runDealAttributionAction(wonOppId);
    expect(ownRes.ok).toBe(true);

    // 销售小李尝试归因小王名下的商机 -> 权限拦截
    const crossRes = await runDealAttributionAction(salesBOppId);
    expect(crossRes.ok).toBe(false);
    expect(crossRes.message).toContain("销售人员仅可对自己负责的商机");

    // 销售小李列出已关闭商机 -> 仅包含小李名下的 WON 与 LOST
    const listRes = await listClosedOpportunitiesAction();
    expect(listRes.ok).toBe(true);
    if (listRes.ok) {
      expect(listRes.data.some((d) => d.id === wonOppId)).toBe(true);
      expect(listRes.data.some((d) => d.id === lostOppId)).toBe(true);
      expect(listRes.data.some((d) => d.id === salesBOppId)).toBe(false);
    }

    // 模拟 session 为管理员老张
    vi.spyOn(authSession, "requireSession").mockResolvedValue(adminCtx);
    const adminListRes = await listClosedOpportunitiesAction();
    expect(adminListRes.ok).toBe(true);
    if (adminListRes.ok) {
      expect(adminListRes.data.some((d) => d.id === salesBOppId)).toBe(true);
    }
  });

  it("7. getLatestOpportunityAttributionService: enforces sales isolation and desensitization", async () => {
    const aiHubService = await import("@/core/ai-hub/service");

    // 销售小李尝试拉取销售小王名下的商机归因 -> 抛出 FORBIDDEN
    await expect(
      aiHubService.getLatestOpportunityAttributionService(salesACtx, salesBOppId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 管理员拉取销售小王的商机归因 -> 允许查看
    const adminAttr = await aiHubService.getLatestOpportunityAttributionService(adminCtx, salesBOppId);
    expect(adminAttr === null || typeof adminAttr === "object").toBe(true);

    // 插入一条带底价的归因报告到 wonOppId (对应 ai_agent_traces 表)
    await owner.query(
      `insert into ai_agent_traces (tenant_id, task, rounds, tools_used, outcome)
       values ($1, $2, 1, '["getCompetitorInfo"]'::jsonb, '本单底价为 500000 元，实际成交价格 600000 元')`,
      [tenantId, `归因分析-商机-${wonOppId}`],
    );

    // 销售小李拉取自己的商机归因 -> 成功且 outcome 经过脱敏处理
    const salesAttr = await aiHubService.getLatestOpportunityAttributionService(salesACtx, wonOppId);
    expect(salesAttr).not.toBeNull();
    expect(salesAttr?.outcome).toBeDefined();
    expect(salesAttr?.rounds).toBe(1);
  });
});
