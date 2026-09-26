import { TenantContext } from "@/core/tenant";
import { runAgentLoop, AgentLoopResult } from "../agent-loop";
import {
  customerPortfolioStructureTool,
  revenueBySegmentTool,
  getPipelineSummaryTool,
  listOpportunitiesTool,
} from "../tools";

export async function runCompanyProfileAgent(ctx: TenantContext): Promise<AgentLoopResult> {
  const tools = [
    customerPortfolioStructureTool,
    revenueBySegmentTool,
    getPipelineSummaryTool,
    listOpportunitiesTool,
  ];

  const task = `请对当前企业进行【企业画像与客盘结构诊断】(L3)。
请按顺序调用 customerPortfolioStructure 和 revenueBySegment 等工具获取企业客户全景与营收分布数据，并输出结构化 Markdown 报告。

报告必须包含以下三大模块：
1. **客户结构诊断**：剖析企业核心客盘的基本构成（按行业、企业规模与类型分布），明确主要营收贡献来源于哪类客群；
2. **结构性风险透视**：评估客户集中度风险、单一行业依赖风险以及获客渠道依赖度；
3. **增长机会假设**：基于在途商机分布与各分层转化特征，提出具有业务潜力的增量客群切入方向。

【严格执行规则】：
A. **数据证据链强制引用**：每条核心结论必须明确标注工具数据来源（格式规范如：“来自 customerPortfolioStructure: 制造业客户占总营收...” 或 “来自 revenueBySegment: 来自自拓渠道的在途商机金额为...”）；
B. **诚实边界与置信度标注**：请检查工具返回的总样本量 N（如总客户数或总商机数）。若样本量 N < 20，报告正文第一行必须强制输出标头：'> **方向性假设（低置信度，样本 N=x）**'；若样本量 >= 20，则正常输出报告。`;

  const loopRes = await runAgentLoop(ctx, task, tools);

  // 兜底检查诚实边界：检查工具返回的样本量，若 N < 20 且 LLM 未标注则自动在头部补齐
  let minSampleSize: number | null = null;
  for (const m of loopRes.messages) {
    if (m.role === "tool" && m.content) {
      try {
        const parsed = JSON.parse(m.content);
        const sz = parsed?.result?.sampleSize ?? parsed?.result?.totalCustomers ?? parsed?.result?.totalSampleCount;
        if (typeof sz === "number") {
          minSampleSize = minSampleSize === null ? sz : Math.max(minSampleSize, sz);
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
