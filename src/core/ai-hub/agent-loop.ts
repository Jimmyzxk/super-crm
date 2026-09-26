import { zodToJsonSchema } from "./zod-to-json-schema";
import { TenantContext, withTenant } from "@/core/tenant";
import { callLlmGatewayService, LlmMessage, LlmTool, LlmTokenUsage } from "@/core/ai-gateway/client";
import { AgentTool } from "./tools/types";
import { aiAgentTraces } from "@/db/schema";

export interface AgentLoopResult {
  outcome: string;
  rounds: number;
  toolsUsed: string[];
  messages: LlmMessage[];
  tokenUsage?: LlmTokenUsage;
}

export async function runAgentLoop(
  ctx: TenantContext,
  task: string,
  tools: AgentTool[],
  opts?: { maxRounds?: number; opportunityId?: string }
): Promise<AgentLoopResult> {
  const maxRounds = opts?.maxRounds || 8;
  let rounds = 0;
  const messages: LlmMessage[] = [
    { role: "system", content: "你是专业的 B2B CRM 分析智能体。通过思考和调用工具解决问题。" },
    { role: "user", content: task },
  ];
  
  const formattedTools: LlmTool[] = tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: zodToJsonSchema(t.parameters)
    }
  }));

  const toolsUsedSet = new Set<string>();
  let consecutiveErrors = 0;
  let outcome = "";
  let hasSentToolReminder = false;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalCacheHitTokens = 0;
  let hasUsage = false;

  while (rounds < maxRounds) {
    rounds++;
    const res = await callLlmGatewayService(ctx, {
      scene: "AGENT_HARNESS",
      messages,
      tools: formattedTools.length > 0 ? formattedTools : undefined,
    });

    if (res.usage) {
      hasUsage = true;
      if (typeof res.usage.promptTokens === "number") totalPromptTokens += res.usage.promptTokens;
      if (typeof res.usage.completionTokens === "number") totalCompletionTokens += res.usage.completionTokens;
      if (typeof res.usage.totalTokens === "number") {
        totalTokens += res.usage.totalTokens;
      } else {
        totalTokens += (res.usage.promptTokens || 0) + (res.usage.completionTokens || 0);
      }
      if (typeof res.usage.promptCacheHitTokens === "number") {
        totalCacheHitTokens += res.usage.promptCacheHitTokens;
      }
    }

    if (res.error) {
      consecutiveErrors++;
      if (consecutiveErrors >= 2) {
        outcome = "连续两次调用模型失败，终止";
        break;
      }
      messages.push({
        role: "user",
        content: `调用模型出错: ${res.error}，请重试或给出结论`
      });
      continue;
    }

    if (!res.isRealLlm) {
      outcome = "LLM 不可用或未配置";
      break;
    }

    consecutiveErrors = 0;

    // Add assistant message back
    messages.push({
      role: "assistant",
      content: res.rawText || "",
      tool_calls: res.tool_calls
    });
    
    // 护栏：只要 tools 非空且第一轮零 tool_calls，无条件追加一轮提醒消息重试一次（结构保证，不依赖 prompt 措辞）
    if ((!res.tool_calls || res.tool_calls.length === 0) && toolsUsedSet.size === 0 && tools.length > 0 && !hasSentToolReminder) {
      hasSentToolReminder = true;
      messages.push({
        role: "user",
        content: "你尚未调用任何工具获取业务事实。请先调用提供的工具获取真实数据，然后再给出客观分析与结论。"
      });
      continue;
    }

    // If no tool calls, this is the final answer
    if (!res.tool_calls || res.tool_calls.length === 0) {
      outcome = res.rawText || "";
      break;
    }

    consecutiveErrors = 0;

    // Execute tool calls
    for (const tc of res.tool_calls) {
      toolsUsedSet.add(tc.function.name);
      const targetTool = tools.find(t => t.name === tc.function.name);
      
      if (!targetTool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `未找到工具: ${tc.function.name}` })
        });
        continue;
      }
      
      try {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }
        
        const toolRes = await targetTool.execute(ctx, parsedArgs);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(toolRes)
        });
      } catch (err: unknown) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        });
      }
    }
  }

  if (rounds >= maxRounds && !outcome) {
    outcome = "达到最大轮数上限";
  }

  const aggregatedUsage: LlmTokenUsage | undefined = hasUsage ? {
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens: totalTokens,
    promptCacheHitTokens: totalCacheHitTokens > 0 ? totalCacheHitTokens : undefined,
  } : undefined;

  // 统一持久化 Agent 运行 Trace（不阻断业务执行）
  // 尝试从 task 文本中提取 opportunityId（uuid），供索引化等值查询使用
  let traceOpportunityId: string | null = null;
  if (opts && typeof (opts as Record<string, unknown>).opportunityId === "string") {
    traceOpportunityId = (opts as Record<string, unknown>).opportunityId as string;
  } else {
    const uuidMatch = task.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) traceOpportunityId = uuidMatch[0];
  }
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await tx.insert(aiAgentTraces).values({
        tenantId: ctx.tenantId,
        task,
        toolsUsed: Array.from(toolsUsedSet),
        rounds,
        tokenUsage: (aggregatedUsage as Record<string, unknown>) || {},
        outcome,
        ...(traceOpportunityId ? { opportunityId: traceOpportunityId } : {}),
      } as unknown as typeof aiAgentTraces.$inferInsert);
    });
  } catch (err) {
    console.warn("[Agent Loop] Failed to write trace log:", err);
  }

  return {
    outcome,
    rounds,
    toolsUsed: Array.from(toolsUsedSet),
    messages,
    tokenUsage: aggregatedUsage,
  };
}

import {
  getPipelineSummaryTool,
  listStalledOpportunitiesTool,
  listOpportunitiesTool,
  getOpportunityDetailTool,
  listCustomerContactsTool,
  searchLeadsTool
} from "./tools";

export async function runPipelineHealthAgent(ctx: TenantContext) {
  const tools = [
    getPipelineSummaryTool,
    listStalledOpportunitiesTool,
    listOpportunitiesTool,
    getOpportunityDetailTool,
    listCustomerContactsTool,
    searchLeadsTool
  ];
  
  const task = "当前管线整体健康度如何，哪些商机需要关注？请输出结构化结论，每条结论必须明确引用工具证据（格式如：根据 getPipelineSummary 工具返回...）";
  
  return runAgentLoop(ctx, task, tools);
}
