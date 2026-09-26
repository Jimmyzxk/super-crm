import { TenantContext } from "@/core/tenant";
import { runAgentLoop, AgentLoopResult } from "../agent-loop";
import {
  topPerformersByRevenueTool,
  winLossFactorStatsTool,
  listOpportunitiesTool,
  getPipelineSummaryTool,
} from "../tools";

export async function runChampionAnalysisAgent(ctx: TenantContext): Promise<AgentLoopResult> {
  const tools = [
    topPerformersByRevenueTool,
    winLossFactorStatsTool,
    getPipelineSummaryTool,
    listOpportunitiesTool,
  ];

  const task = `请对当前租户销售团队进行【销冠解构分析】(L2)。
请按顺序调用 topPerformersByRevenue 和 winLossFactorStats 等工具获取团队真实赢单与成单归因数据，并输出结构化 Markdown 报告。

报告必须包含以下三大模块：
1. **销冠画像与客户共性**：分析头部销售（Top 5）偏好的核心行业、企业规模以及获客来源；
2. **赢单路径与效能差异**：对比成单周期（天）、平均客单价以及关键阶段转化特点；
3. **可复制动作假设与团队赋能建议**：提炼可供团队其他成员复制的打法、话术或行业切入动作。

【严格执行规则】：
A. **数据证据链强制引用**：每条核心结论必须明确标注工具数据来源（格式规范如：“来自 topPerformersByRevenue: 销冠A 贡献总赢单金额...” 或 “来自 winLossFactorStats: 制造业赢单率达...”）；
B. **诚实边界与置信度标注**：请检查工具返回的总样本量 N。若样本量 N < 20，报告正文第一行必须强制输出标头：'> **方向性假设（低置信度，样本 N=x）**'；若样本量 >= 20，则正常输出报告。`;

  const loopRes = await runAgentLoop(ctx, task, tools);

  // 兜底检查诚实边界：检查工具返回的样本量，若 N < 20 且 LLM 未标注则自动在头部补齐
  let minSampleSize: number | null = null;
  for (const m of loopRes.messages) {
    if (m.role === "tool" && m.content) {
      try {
        const parsed = JSON.parse(m.content);
        const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalWonSamples ?? parsed?.result?.totalClosedSamples;
        if (typeof sz === "number") {
          minSampleSize = minSampleSize === null ? sz : Math.min(minSampleSize, sz);
        }
      } catch {
        // ignore parse error
      }
    }
  }

  if (minSampleSize !== null && minSampleSize < 20) {
    const banner = `> **方向性假设（低置信度，样本 N=${minSampleSize}）**`;
    if (!loopRes.outcome.includes("方向性假设") && !loopRes.outcome.includes("低置信度")) {
      loopRes.outcome = `${banner}\n\n${loopRes.outcome}`;
    }
  }

  return loopRes;
}
