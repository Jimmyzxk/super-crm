import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

describe("AI Agent Harness (Wave A)", () => {
  let ctx: import("@/core/tenant").TenantContext;
  let tenantId: string;
  let userId: string;
  let runAgentLoop: typeof import("@/core/ai-hub/agent-loop").runAgentLoop;
  let runPipelineHealthAgent: typeof import("@/core/ai-hub/agent-loop").runPipelineHealthAgent;
  let llmGateway: typeof import("@/core/ai-gateway/client");
    let listOpportunitiesTool: typeof import("@/core/ai-hub/tools").listOpportunitiesTool;

  beforeAll(async () => {
    // Dynamic imports to ensure DATABASE_URL is set first
    const mod1 = await import("@/core/ai-hub/agent-loop");
    runAgentLoop = mod1.runAgentLoop;
        listOpportunitiesTool = (await import("@/core/ai-hub/tools")).listOpportunitiesTool;
    runPipelineHealthAgent = mod1.runPipelineHealthAgent;
    llmGateway = await import("@/core/ai-gateway/client");

    await owner.connect();
    const res = await owner.query<{ id: string }>(`insert into tenants (name) values ('AI Agent Corp') returning id`);
    tenantId = res.rows[0].id;
    const rand = Math.random().toString(36).substring(7);
    const email = `ai_${rand}@test.com`;
    const userRes = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role) values ('${tenantId}', '${email}', 'hash', 'AI Admin', 'ADMIN') returning id`);
    userId = userRes.rows[0].id;
    ctx = { tenantId, userId, role: "ADMIN"};
  });

  afterAll(async () => {
    await owner.query(`delete from users where id = '${userId}'`);
    await owner.query(`delete from tenants where id = '${tenantId}'`);
    await owner.end();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should execute ReAct loop and terminate properly", async () => {
    let callCount = 0;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          rawText: "",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "listOpportunities", arguments: '{"filter":"active"}' }
          }]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      } else {
        return {
          rawText: "分析完成",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock"
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
    });

    const res = await runAgentLoop(ctx, "测试管线", [listOpportunitiesTool]);
    expect(res.rounds).toBe(2);
    expect(res.outcome).toBe("分析完成");
    expect(res.toolsUsed).toContain("listOpportunities");

    // Verify trace
    await owner.query(`set app.tenant_id = '${ctx.tenantId}'`);
    const trace = await owner.query(`select * from ai_agent_traces where tenant_id = '${ctx.tenantId}' order by created_at desc limit 1`);
    expect(trace.rows.length).toBe(1);
    expect(trace.rows[0].task).toBe("测试管线");
    expect(trace.rows[0].rounds).toBe(2);
    expect(trace.rows[0].outcome).toBe("分析完成");
  });

  it("should respect max rounds", async () => {
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      return {
        rawText: "",
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock",
        tool_calls: [{
          id: "call_x",
          type: "function",
          function: { name: "listOpportunities", arguments: '{"filter":"active"}' }
        }]
      } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
    });

    const res = await runAgentLoop(ctx, "测试循环上限", [listOpportunitiesTool], { maxRounds: 3 });
    expect(res.rounds).toBe(3);
    expect(res.outcome).toBe("达到最大轮数上限");
  });

  it("should retry on error and terminate after 2 consecutive errors", async () => {
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      return {
        rawText: "",
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock",
        error: "API Timeout"
      } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
    });

    const res = await runAgentLoop(ctx, "测试重试", [listOpportunitiesTool], { maxRounds: 5 });
    expect(res.rounds).toBe(2);
    expect(res.outcome).toBe("连续两次调用模型失败，终止");
  });
  
  it("runPipelineHealthAgent should run on demo data", async () => {
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async () => {
      return {
        rawText: "健康度良好。证据：根据 getPipelineSummary...",
        data: null,
        isRealLlm: true,
        provider: "mock",
        modelName: "mock"
      } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
    });

    const res = await runPipelineHealthAgent(ctx);
    expect(res.outcome).toContain("健康度良好");
  });

  it("护栏机制：只要提供 tools 且首轮零工具调用时，无条件追加提醒轮重试一次", async () => {
    let callCount = 0;
    let receivedReminder = false;
    vi.spyOn(llmGateway, "callLlmGatewayService").mockImplementation(async (_ctx, req) => {
      callCount++;
      const msgs = req.messages || [];
      const lastUserMsg = msgs.filter((m) => m.role === "user").pop();
      if (lastUserMsg?.content?.includes("请先调用提供的工具获取真实数据")) {
        receivedReminder = true;
      }

      if (callCount === 1) {
        // 第一轮：LLM 违规直接输出了文本，未调用工具
        return {
          rawText: "{\"activationList\":[]}",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: []
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      } else if (callCount === 2) {
        // 第二轮：收到提醒后，LLM 正确调用了工具
        return {
          rawText: "",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock",
          tool_calls: [{
            id: "call_guardrail_1",
            type: "function",
            function: { name: "listOpportunities", arguments: "{}" }
          }]
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      } else {
        // 第三轮：拿到工具结果后正常输出
        return {
          rawText: "{\"activationList\":[{\"customerName\":\"有效企业\"}]}",
          data: null,
          isRealLlm: true,
          provider: "mock",
          modelName: "mock"
        } as unknown as import("@/core/ai-gateway/client").LlmResponseResult;
      }
    });

    const res = await runAgentLoop(ctx, "必须先调用工具获取真实数据，严禁直接填写", [listOpportunitiesTool]);
    expect(receivedReminder).toBe(true);
    expect(res.rounds).toBe(3);
    expect(res.toolsUsed).toContain("listOpportunities");
    expect(res.outcome).toContain("有效企业");

    // 验证 loop 统一落库 trace
    await owner.query(`set app.tenant_id = '${ctx.tenantId}'`);
    const trace = await owner.query(`select * from ai_agent_traces where tenant_id = '${ctx.tenantId}' and task like '%必须先调用工具%' order by created_at desc limit 1`);
    expect(trace.rows.length).toBe(1);
    expect(trace.rows[0].rounds).toBe(3);
    expect(trace.rows[0].tools_used).toContain("listOpportunities");
    expect(trace.rows[0].outcome).toContain("有效企业");
  });
});
