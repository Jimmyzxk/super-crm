import { TenantContext } from "@/core/tenant";
import { runAgentLoop, AgentLoopResult } from "../agent-loop";
import {
  getOpportunityFullHistoryTool,
  getLostReasonDistributionTool,
  getPeerWinPatternsTool,
  getOpportunityDetailTool,
  winLossFactorStatsTool,
} from "../tools";

export interface DealAttributionResult extends AgentLoopResult {
  opportunityId: string;
  direction: "WON" | "LOST" | "UNKNOWN";
  evidenceCount: number;
}

export async function runDealAttributionAgent(
  ctx: TenantContext,
  opportunityId: string,
  direction?: "WON" | "LOST"
): Promise<DealAttributionResult> {
  const tools = [
    getOpportunityFullHistoryTool,
    getPeerWinPatternsTool,
    getLostReasonDistributionTool,
    getOpportunityDetailTool,
    winLossFactorStatsTool,
  ];

  const directionLabel = direction === "WON" ? "赢单归因 (WON)" : (direction === "LOST" ? "输单归因 (LOST)" : "已关闭商机归因");

  const task = `请对指定商机（ID: ${opportunityId}）进行【商机因果归因深度分析】(L1 Deal Attribution)。
当前归因方向：【${directionLabel}】。

【执行步骤】：
1. 首先调用 getOpportunityFullHistory 工具获取商机 ${opportunityId} 的全量历史（全阶段停留天数、全部跟进记录、战情室主管介入指导、报价与合同偏差）；
2. 若为赢单商机，调用 getPeerWinPatterns 工具获取同类/同行业赢单基准对比；若为输单商机，调用 getLostReasonDistribution 工具获取租户级输单原因分布对比；
3. 输出结构化 Markdown 因果归因报告。

报告必须包含以下四大模块：
## 1. 商机生命周期与关键转折时间线
- 梳理从建单到结单的关键节点，识别推动阶段跃迁或导致停滞的转折事件（如关键决策人拜访、战情室特批、方案汇报等）；
- 对比各阶段停留天数与同行中位数差异。

## 2. 五维因果归因评估
从以下 5 个维度逐一展开归因评估，每项必须明确标注【证据】与【置信度：高/中/低】：
- **决策链与客情覆盖**
- **价格/折扣与商务策略**
- **跟进质量与互动深度**
- **流转效率与响应敏捷度**
- **竞对态势与外部因素**
*（注意：若某个维度在历史记录中缺乏数据支撑，必须如实输出：“**[证据不足，无法归因]**”，严禁凭空臆造因果。）*

## 3. 经验沉淀与打法提炼
${direction === "LOST" ? "- 提炼 2-3 条【可避免动作】（风险预警信号、失误点规避指南）；" : "- 提炼 2-3 条【可复制动作】（标杆打法、赢单关键动作）；"}

## 4. 归因结论与改进建议
- 综合因果定性与后续团队赋能启示。

【章程红线】：
A. **事实证据链强制引用**：所有关键结论必须显式注明工具数据来源（例如：“来自 getOpportunityFullHistory: 方案报价阶段停留仅 3 天...”，“来自 getPeerWinPatterns: 行业平均介入率 60%...”）；
B. **严守诚实边界**：缺乏证据时坦承不足，样本量小时注明方向性假设。`;

  const loopRes = await runAgentLoop(ctx, task, tools, { opportunityId });

  // 统计工具调用的证据使用情况
  let evidenceCount = 0;
  for (const m of loopRes.messages) {
    if (m.role === "tool" && m.content && !m.content.includes("error")) {
      evidenceCount++;
    }
  }

  // 确保证据缺失时的归因诚实度
  if (evidenceCount === 0 && !loopRes.outcome.includes("证据不足")) {
    loopRes.outcome = `> **提示：未获取到足够商机生命周期证据，无法进行深度因果归因。**\n\n${loopRes.outcome}`;
  }

  return {
    ...loopRes,
    opportunityId,
    direction: direction || "UNKNOWN",
    evidenceCount,
  };
}
