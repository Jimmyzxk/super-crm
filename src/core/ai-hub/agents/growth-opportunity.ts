import { TenantContext } from "@/core/tenant";
import { runAgentLoop } from "../agent-loop";
import { AgentTool } from "../tools/types";
import { 
  customerRevenueTieringTool, 
  crossSellCandidatesTool, 
  dormantHighValueTool, 
  renewalPipelineTool 
} from "../tools/growth";
import { BusinessError } from "@/core/shared/result";

export interface GrowthOpportunityReport {
  activationList: Array<{
    customerName: string;
    reason: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  crossSellList: Array<{
    customerName: string;
    recommendedProduct: string;
    basis: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  dormantList: Array<{
    customerName: string;
    dormantDays: number;
    lastInteraction: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  renewalWindows: Array<{
    contractNo: string;
    suggestedTiming: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  insufficientData?: boolean;
}

export async function runGrowthOpportunityAgent(ctx: TenantContext) {
  if (ctx.role === "SALES") {
    throw new BusinessError("FORBIDDEN", "普通销售无权触发增量与变现诊断报告");
  }

  const prompt = `你是一个高级营收增长智能体（Growth Opportunity Agent）。
你的任务是挖掘“增量与变现”落地机会，并输出合法的结构化 JSON 报告。

【执行流程要求 - 必须先调用工具获取数据】：
你必须先依次调用 customerRevenueTiering/crossSellCandidates/dormantHighValue/renewalPipeline 四个工具获取真实数据，基于工具返回填写 JSON，禁止凭空填写列表！

1. 存量激活清单 (activationList)：必须先调用 customerRevenueTiering({ tier: "ZERO", limit: 5 }) 获取零贡献存量客户；
2. 交叉销售机会 (crossSellList)：必须先调用 crossSellCandidates({ limit: 5 }) 交叉比对已购产品与未购目录，获取推荐产品；
3. 沉睡唤醒名单 (dormantList)：必须先调用 dormantHighValue({ limit: 5 }) 找出超 60 天未互动的沉睡高价值客户；
4. 续约窗口 (renewalPipeline)：必须先调用 renewalPipeline({ days: 90, limit: 5 }) 获取临期合同。

【数据真实性与输出规范】：
在获得工具返回的数据后，请将提取到的有效业务机会汇总为符合以下 Schema 的 JSON 内容：
{
  "activationList": [ { "customerName": "...", "reason": "...", "confidence": "HIGH" | "MEDIUM" | "LOW" } ],
  "crossSellList": [ { "customerName": "...", "recommendedProduct": "...", "basis": "...", "confidence": "HIGH" | "MEDIUM" | "LOW" } ],
  "dormantList": [ { "customerName": "...", "dormantDays": 0, "lastInteraction": "...", "confidence": "HIGH" | "MEDIUM" | "LOW" } ],
  "renewalWindows": [ { "contractNo": "...", "suggestedTiming": "...", "confidence": "HIGH" | "MEDIUM" | "LOW" } ],
  "insufficientData": false
}
- 只要从工具中检索到了任何有效数据项，insufficientData 必须为 false；仅在所有工具均返回完全无可用数据时才设为 true。
- 请输出该 JSON 内容。`;

  const tools: AgentTool[] = [
    customerRevenueTieringTool,
    crossSellCandidatesTool,
    dormantHighValueTool,
    renewalPipelineTool
  ];

  const llmRes = await runAgentLoop(ctx, prompt, tools);

  try {
    let jsonStr = llmRes.outcome.trim();
    // 剔除 markdown 标记
    if (jsonStr.includes("```")) {
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        jsonStr = match[1].trim();
      }
    }
    // 查找首个 { 和最后一个 }
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const report = JSON.parse(jsonStr) as GrowthOpportunityReport;
    return {
      ...llmRes,
      outcome: JSON.stringify(report, null, 2),
      report
    };
  } catch {
    throw new BusinessError("INTERNAL_ERROR", "LLM 输出格式错误，无法解析为 JSON: " + llmRes.outcome);
  }
}
