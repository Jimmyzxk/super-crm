import { describe, expect, it } from "vitest";
import { evaluateScore, ruleMatches, type ScoreFacts, type ScoreRule } from "@/core/scoring/rules";

const facts: ScoreFacts = {
  companyName: "星海智能有限公司",
  contactEmail: "sales@example.com",
  title: "采购总监",
  source: "form:website",
  createdHour: 9,
  activityCount: 2,
  lastActivityOutcome: "INTERESTED",
};

function rule(operator: ScoreRule["operator"], field: ScoreRule["field"], value: string | null, weight = 1, sortOrder = 0): ScoreRule {
  return { label: `${operator}-${field}`, operator, field, value, weight, enabled: true, sortOrder };
}

describe("线索评分规则", () => {
  it("覆盖所有 V1 操作符", () => {
    expect(ruleMatches(rule("EXISTS", "company_name", null), facts)).toBe(true);
    expect(ruleMatches(rule("NOT_EXISTS", "title", null), { ...facts, title: null })).toBe(true);
    expect(ruleMatches(rule("EQUALS", "last_activity_outcome", "INTERESTED"), facts)).toBe(true);
    expect(ruleMatches(rule("CONTAINS", "company_name", "智能"), facts)).toBe(true);
    expect(ruleMatches(rule("STARTS_WITH", "source", "form:"), facts)).toBe(true);
    expect(ruleMatches(rule("GT", "activity_count", "1"), facts)).toBe(true);
    expect(ruleMatches(rule("GTE", "created_hour", "9"), facts)).toBe(true);
    expect(ruleMatches(rule("IN", "last_activity_outcome", "REFUSED, INTERESTED"), facts)).toBe(true);
  });

  it("按 sort_order 生成人话理由并将分数限制在 0 到 100", () => {
    const result = evaluateScore([
      { ...rule("EXISTS", "company_name", null, 80, 20), label: "公司完整" },
      { ...rule("EXISTS", "contact_email", null, 50, 10), label: "邮箱完整" },
      { ...rule("EQUALS", "last_activity_outcome", "INTERESTED", -200, 30), label: "负向调整" },
    ], facts);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("邮箱完整 +50，公司完整 +80，负向调整 -200");
  });

  it("在完整规则边界截断理由，无命中显示明确的零分说明", () => {
    const longRules = Array.from({ length: 30 }, (_, index) => ({
      ...rule("EXISTS", "company_name", null, 1, index),
      label: `规则${String(index).padStart(2, "0")}${"说明".repeat(12)}`,
    }));
    const truncated = evaluateScore(longRules, facts);
    expect(truncated.reason.length).toBeLessThanOrEqual(500);
    expect(truncated.reason.endsWith("等")).toBe(true);
    expect(truncated.reason).not.toContain("规则29");
    expect(evaluateScore([rule("EQUALS", "source", "api:missing")], facts)).toEqual({ score: 0, reason: "暂无加分项", matchedRules: [] });
  });

  it("理由恰好占满 500 字符时仍为省略标记预留空间", () => {
    const boundary = evaluateScore([
      { ...rule("EXISTS", "company_name", null, 1, 0), label: "甲".repeat(496) },
      { ...rule("EXISTS", "company_name", null, 1, 1), label: "后续规则" },
    ], facts);
    expect(boundary.reason).toHaveLength(500);
    expect(boundary.reason.endsWith("等")).toBe(true);
    expect(boundary.reason).not.toContain("后续规则");
  });

  it("支持客户企业画像、活跃度时效与交易资产等扩展字段的判定", () => {
    const extendedFacts: ScoreFacts = {
      ...facts,
      customerSize: "101-500",
      customerIndustry: "人工智能/SaaS",
      customerRegion: "广东省深圳市",
      daysSinceActivity: 5,
      wonDealCount: 2,
      activeDealCount: 1,
    };
    expect(ruleMatches(rule("EQUALS", "customer_size", "101-500"), extendedFacts)).toBe(true);
    expect(ruleMatches(rule("CONTAINS", "customer_industry", "SaaS"), extendedFacts)).toBe(true);
    expect(ruleMatches(rule("CONTAINS", "customer_region", "深圳"), extendedFacts)).toBe(true);
    expect(ruleMatches(rule("GT", "days_since_activity", "3"), extendedFacts)).toBe(true);
    expect(ruleMatches(rule("GTE", "won_deal_count", "2"), extendedFacts)).toBe(true);
    expect(ruleMatches(rule("GT", "active_deal_count", "0"), extendedFacts)).toBe(true);
  });
});
