import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ 本文件混合两类内容，已按 W12-4 逐条处置：
 *
 * 【保留为配置/架构守护（非行为断言）】—— A 组迁移/索引声明、C 组查询形状声明、以及
 * 「金额存分」这类本质上是声明式配置的检查。静态扫描源码无法证明运行期正确性，
 * 因此风险关闭的行为证据在：
 *  · 索引/查询下推的运行时效果：tests/integration/analytics-bi-matrix.test.ts、
 *    tests/integration/bi-matrix-and-ai-agent.test.ts（真 DB 跑聚合查询并断言数值）
 *  · 金额存分守恒：tests/integration/v1-closed-loop.test.ts、
 *    tests/integration/commercial-closed-loop-breakpoints.test.ts（真订单金额流转）
 *  · agent 归因落 opportunity_id：tests/integration/ai-agent-harness.test.ts、
 *    tests/integration/enterprise-ai-agent-hub.test.ts（真 agent 循环 + 归因查询）
 *  · 多租户隔离：tests/integration/stage-zero.test.ts（跨租户读不到数据）
 *
 * 【已替换为行为测试】—— 原 B 组的「vi.mock 计数」是伪断言（测试文件里自己算
 * 500/200，完全没有调用被测实现），已删除并替换为真实导入行为测试：
 *  tests/integration/csv-lead-import.test.ts
 *    · 「500 行一次性导入全部落库（跨越多个 200 行批次，计数与库内实际行数一致）」
 *    · 「SALES 角色无权执行批量导入」
 *    · 「单次超过 1000 行被拒（保护上限真实生效）」
 *  同批去重（F11）同样在该文件覆盖。
 *
 * 【已删除】—— 「所有机会/线索查询均包含 tenant_id 过滤」用
 * `(svc.match(/tenant_id/g) || []).length > 20` 统计字符串出现次数，既不校验语义也无
 * 阈值依据，属于无意义断言。真正的隔离行为由 tests/integration/stage-zero.test.ts
 * （跨租户读写隔离）与 PostgreSQL FORCE ROW LEVEL SECURITY 覆盖。
 */

function readSrc(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("效能修复批回归（配置/架构守护 + 行为测试指针）", () => {
  describe("A 索引与迁移（架构守护，非行为断言）", () => {
    it("0090 迁移存在且包含 opportunity_id 列与 tenant/created 与 tenant/opportunity 索引", () => {
      const p = "src/db/migrations/0090_ai_agent_traces_performance.sql";
      expect(existsSync(join(process.cwd(), p))).toBe(true);
      const content = readSrc(p);
      expect(content).toContain("opportunity_id");
      expect(content).toContain("ai_agent_traces_tenant_created_idx");
      expect(content).toContain("ai_agent_traces_tenant_opportunity_idx");
      expect(content).toContain("tenant_id, created_at desc");
      expect(content).toContain("tenant_id, opportunity_id");
    });

    it("0091 迁移存在且包含所有要求索引", () => {
      const p = "src/db/migrations/0091_core_performance_indexes.sql";
      expect(existsSync(join(process.cwd(), p))).toBe(true);
      const c = readSrc(p);
      expect(c).toContain("activities_tenant_occurred_idx");
      expect(c).toContain("activities_tenant_user_occurred_idx");
      // 开源版（AGPL-3.0）：plugin_orders_tenant_contract_idx 随订单插件（闭源）移除，
      // 其部分索引条件 where deleted_at is null 亦随之消失，仅剩 opportunities 的
      // where from_lead_id is not null 部分索引。
      expect(c).not.toContain("plugin_orders_tenant_contract_idx");
      expect(c).toContain("where from_lead_id is not null");
      expect(c).not.toContain("where deleted_at is null");
      expect(c).toContain("opportunities_tenant_stage_idx");
      expect(c).toContain("lead_conversions_tenant_opportunity_idx");
      expect(c).toContain("opportunities_from_lead_idx");
    });

    it("schema 中 ai_agent_traces 包含 opportunityId", () => {
      const schema = readSrc("src/db/schema/index.ts");
      expect(schema).toMatch(/aiAgentTraces[\s\S]*opportunityId/);
      expect(schema).toContain("opportunity_id");
    });

    it("service.ts 的归因查询已改为 opportunity_id 等值查询（过渡期保留回退）", () => {
      const svc = readSrc("src/core/ai-hub/service.ts");
      expect(svc).toContain("opportunity_id =");
      // 过渡期回退：opportunity_id is null and task like '%'||X||'%'
      expect(svc).toContain("opportunity_id is null and task like");
    });

    it("agent-loop 写入时落 opportunity_id 列", () => {
      const loop = readSrc("src/core/ai-hub/agent-loop.ts");
      expect(loop).toContain("opportunityId");
      expect(loop).toContain("traceOpportunityId");
    });
  });

  describe("C 查询下推与字段瘦身（架构守护，非行为断言）", () => {
    it("opportunity tools 已下推 owner/stage/minAmount/stalledDays 到 service SQL 且无 JS 内存过滤", () => {
      const tool = readSrc("src/core/ai-hub/tools/opportunity.ts");
      expect(tool).toContain("minAmountCents");
      expect(tool).toContain("ownerUserId");
      expect(tool).toContain("stalledDaysMin");
      expect(tool).not.toContain(".filter(i => i.ownerUserId");
      expect(tool).not.toContain(".filter(i => i.stage");
      // service 侧应包含对应 SQL 过滤
      const oppService = readSrc("src/core/opportunity/service.ts");
      expect(oppService).toContain("ownerUserId");
      expect(oppService).toContain("minAmountCents");
      expect(oppService).toContain("stalledDaysMin");
      expect(oppService).toContain("ownerFilterSql");
    });

    it("analytics: getSalesRadar/getExecutiveForecast 改为 SQL 聚合，无全量拉行循环", () => {
      const svc = readSrc("src/core/analytics/service.ts");
      expect(svc).toContain("pipelineAmount");
      expect(svc).toContain("weightedAmount");
      expect(svc).toContain("count(*) filter");
      const salesRadarSection = svc.slice(svc.indexOf("getSalesRadarService"), svc.indexOf("getTeamEfficiencyService"));
      expect(salesRadarSection).not.toContain("for (const opp of activeOppsRes.rows)");
    });

    it("analytics: 团队成员矩阵已合并为 GROUP BY 单条（with won_agg 等 CTE）", () => {
      const svc = readSrc("src/core/analytics/service.ts");
      expect(svc).toContain("won_agg");
      expect(svc).toContain("lead_agg");
      expect(svc).toContain("opp_agg");
      expect(svc).toContain("act_agg");
      expect(svc).toContain("task_agg");
    });

    it("attribution: getPeerWinPatterns 已改为 join 聚合且加 limit", () => {
      const attr = readSrc("src/core/ai-hub/tools/attribution.ts");
      expect(attr).toContain("left join (select");
      expect(attr).toContain("limit 200");
      expect(attr).not.toContain("(select count(*)::int from activities a where a.tenant_id = o.tenant_id and a.opportunity_id = o.id) as \"activityCount\"");
    });

    it("attribution: getOpportunityFullHistory 活动段已加 limit 100", () => {
      const attr = readSrc("src/core/ai-hub/tools/attribution.ts");
      expect(attr).toMatch(/activities[\s\S]*limit 100/);
    });

    it("ai-hub/actions: 四个 agent action 精简返回，不含 messages 全量", () => {
      const actions = readSrc("src/core/ai-hub/actions.ts");
      expect(actions).toContain("outcome: data.outcome");
      expect(actions).toContain("rounds: data.rounds");
      expect(actions).toContain("toolsUsed: data.toolsUsed");
      expect(actions).toContain("reportId");
      expect(actions).toContain("tokenUsage");
      const championSection = actions.slice(actions.indexOf("runChampionAnalysisAction"), actions.indexOf("runCompanyProfileAction"));
      expect(championSection).not.toMatch(/return \{ ok: true as const, data \};/);
    });

    it("listInsightReportsService 列表截断 500 字符", () => {
      const svc = readSrc("src/core/ai-hub/service.ts");
      expect(svc).toContain("500");
      expect(svc).toContain("已截断");
    });

    it("searchLeadsTool 字段瘦身，去除明文手机/note/utm", () => {
      const tool = readSrc("src/core/ai-hub/tools/leads.ts");
      expect(tool).toContain("hasPhone");
      expect(tool).not.toContain("return { result: list.items }");
      expect(tool).toContain("contactPhone");
      expect(tool).toContain("note");
      expect(tool).toContain("utmSource");
    });
  });

  describe("金额存分（架构守护，非行为断言）", () => {
    it("amounts remain in cents (no yuan leakage) – code uses *100 or /100 consistently", () => {
      const oppTool = readSrc("src/core/ai-hub/tools/opportunity.ts");
      expect(oppTool).toContain("* 100");
      expect(oppTool).toContain("/ 100");
      const svc = readSrc("src/core/opportunity/service.ts");
      expect(svc).toContain("expected_amount");
    });
  });
});
