import { TenantContext, withTenant } from "@/core/tenant";
import { sql } from "drizzle-orm";
import { runAgentLoop, AgentLoopResult } from "../agent-loop";
import {
  listOpportunitiesTool,
  listStalledOpportunitiesTool,
  getOpportunityDetailTool,
  searchLeadsTool,
  listMyDueTasksTool,
  listCustomerContactsTool,
} from "../tools";
import { createNotificationInTransaction } from "@/core/notification/service";

export interface MorningCopilotItem {
  id?: string;
  title: string;
  reason: string;
  suggestedAction: "CREATE_FOLLOW_UP" | "CREATE_TASK" | "VIEW_DETAIL";
  actionPayload: {
    opportunityId?: string;
    customerId?: string;
    leadId?: string;
    targetName?: string;
    defaultNote?: string;
  };
  priority: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number;
}

export interface MorningCopilotResult extends AgentLoopResult {
  recommendations: MorningCopilotItem[];
}

const VALID_TOOLS = [
  "listOpportunities",
  "listStalledOpportunities",
  "getOpportunityDetail",
  "searchLeads",
  "listMyDueTasks",
  "listCustomerContacts",
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeUuid(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

export async function runMorningCopilotAgent(
  ctx: TenantContext,
  salesUserId: string,
  now: Date = new Date(),
): Promise<MorningCopilotResult> {
  // 构建当前销售专属的 TenantContext，确保工具在 RLS 下执行
  const salesCtx: TenantContext = {
    tenantId: ctx.tenantId,
    userId: salesUserId,
    role: "SALES",
  };

  const tools = [
    listMyDueTasksTool,
    listStalledOpportunitiesTool,
    listOpportunitiesTool,
    searchLeadsTool,
    getOpportunityDetailTool,
    listCustomerContactsTool,
  ];

  const task = `请对销售人员（本人 ID: ${salesUserId}）的名下业务资产进行晨会巡检，提炼今日最高优先级的【今日三件事】。
请按需调用 listMyDueTasks、listStalledOpportunities、listOpportunities、searchLeads 等工具获取该销售名下待办任务、停滞商机与高意向线索。

【输出格式严格要求】：
请在最终回复中输出且仅输出一个合法的 JSON 数组（若包含在 markdown 中，请放入 \`\`\`json 代码块）：
[
  {
    "title": "简明行动建议标题（如：推进【XX智能】方案报价）",
    "reason": "证据理由（必须包含调用的工具名称与关键业务事实，如：来自 listStalledOpportunities: 商机已停滞8天；来自 listMyDueTasks: 今日存在到期方案演示待办）",
    "suggestedAction": "CREATE_FOLLOW_UP" | "CREATE_TASK" | "VIEW_DETAIL",
    "actionPayload": {
      "opportunityId": "uuid（如有）",
      "customerId": "uuid（如有）",
      "leadId": "uuid（如有）",
      "targetName": "商机或客户或线索名称",
      "defaultNote": "建议执行的动作要点"
    },
    "priority": "HIGH" | "MEDIUM" | "LOW",
    "confidenceScore": 90
  }
]

【业务红线规则】：
1. 数量限制：至多返回 3 条建议；若该销售名下无紧急停滞商机或待办，诚实返回空数组 [] 或少于 3 条，严禁编造任何虚假商机或联系人！
2. 证据链红线：每条建议的 reason 中必须明确引用工具名称（如 '来自 listMyDueTasks:' 或 '来自 listStalledOpportunities:'），缺失证据的建议将被系统拒绝；
3. 置信度标注：若因商机数据量较少导致判断存在不确定性，请将 confidenceScore 设为 60 并在 reason 中注明方向性假设。`;

  const loopRes = await runAgentLoop(salesCtx, task, tools);

  // 解析并清洗建议列表
  const rawItems = parseRecommendationsFromOutcome(loopRes.outcome);

  // 严格实施证据链校验：缺失工具名证据的建议一律拒绝
  const validItems: MorningCopilotItem[] = [];
  for (const item of rawItems) {
    if (!item.title || !item.reason) continue;
    const hasEvidence = VALID_TOOLS.some((t) => item.reason.includes(t));
    if (!hasEvidence) {
      console.warn(`[Morning Copilot] Rejected recommendation without tool evidence citation: ${item.title}`);
      continue;
    }
    const priority = item.priority === "HIGH" || item.priority === "LOW" ? item.priority : "MEDIUM";
    const suggestedAction =
      item.suggestedAction === "CREATE_FOLLOW_UP" ||
      item.suggestedAction === "CREATE_TASK" ||
      item.suggestedAction === "VIEW_DETAIL"
        ? item.suggestedAction
        : "VIEW_DETAIL";

    validItems.push({
      title: item.title.slice(0, 100),
      reason: item.reason.slice(0, 500),
      suggestedAction,
      actionPayload: item.actionPayload || {},
      priority,
      confidenceScore: typeof item.confidenceScore === "number" ? item.confidenceScore : 90,
    });

    if (validItems.length >= 3) break;
  }

  // 写入 ai_recommendations 表并生成通知
  await withTenant(ctx.tenantId, async (tx) => {
    for (const item of validItems) {
      const oppId = sanitizeUuid(item.actionPayload.opportunityId);
      const leadId = sanitizeUuid(item.actionPayload.leadId);
      const custId = sanitizeUuid(item.actionPayload.customerId);

      const insRes = await tx.execute<{ id: string }>(sql`
        insert into ai_recommendations (
          tenant_id,
          user_id,
          opportunity_id,
          lead_id,
          customer_id,
          recommendation_type,
          title,
          content,
          suggested_action,
          confidence_score,
          is_applied,
          created_at,
          updated_at
        ) values (
          ${ctx.tenantId}::uuid,
          ${salesUserId}::uuid,
          ${oppId ? sql`${oppId}::uuid` : sql`null`},
          ${leadId ? sql`${leadId}::uuid` : sql`null`},
          ${custId ? sql`${custId}::uuid` : sql`null`},
          'MORNING_COPILOT',
          ${item.title},
          ${item.reason},
          ${JSON.stringify({
            type: item.suggestedAction,
            payload: item.actionPayload,
            priority: item.priority,
          })}::jsonb,
          ${item.confidenceScore},
          false,
          ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz
        )
        returning id
      `);

      if (insRes.rows[0]?.id) {
        item.id = insRes.rows[0].id;
      }
    }

    // 站内通知推送
    const notifTitle = "【晨会副驾驶】今日三件事建议已就绪";
    const notifBody =
      validItems.length > 0
        ? `AI 已为你生成 ${validItems.length} 条今日重点攻坚建议，点击前往工作台处理。`
        : "今日名下业务资产运转良好，暂无紧急卡点待办。";

    await createNotificationInTransaction(tx, {
      tenantId: ctx.tenantId,
      userId: salesUserId,
      type: "MORNING_COPILOT",
      title: notifTitle,
      body: notifBody,
      link: "/today?from=morning_copilot",
      createdAt: now,
    });
  });

  return {
    ...loopRes,
    recommendations: validItems,
  };
}

function parseRecommendationsFromOutcome(outcome: string): MorningCopilotItem[] {
  if (!outcome || !outcome.trim()) return [];

  // 1. 尝试匹配 ```json 代码块
  const jsonBlockMatch = outcome.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (Array.isArray(parsed)) return parsed as MorningCopilotItem[];
      if (parsed && Array.isArray(parsed.recommendations)) return parsed.recommendations as MorningCopilotItem[];
    } catch {
      // ignore
    }
  }

  // 2. 尝试全局查找 [ ... ]
  const arrayMatch = outcome.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed as MorningCopilotItem[];
    } catch {
      // ignore
    }
  }

  // 3. 尝试直接整段 JSON.parse
  try {
    const parsed = JSON.parse(outcome.trim());
    if (Array.isArray(parsed)) return parsed as MorningCopilotItem[];
    if (parsed && Array.isArray(parsed.recommendations)) return parsed.recommendations as MorningCopilotItem[];
  } catch {
    // ignore
  }

  return [];
}
