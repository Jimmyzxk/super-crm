import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlaybookRecommendationSection } from "@/app/(app)/opportunities/[opportunityId]/OpportunityDetailClient";
import type { SalesPlaybookRecommendation } from "@/core/playbook/types";

function recommendation(): SalesPlaybookRecommendation {
  return {
    score: 3,
    currentUserFeedback: { verdict: "NOT_HELPFUL", reason: "客户暂无预算", updatedAt: "2026-08-18T09:30:00.000Z" },
    playbook: {
      id: "11111111-1111-4111-8111-111111111111",
      familyKey: "manufacturing-discovery",
      version: 2,
      status: "PUBLISHED",
      name: "制造业初访推进",
      targetStage: "DISCOVERY",
      applicableIndustries: ["制造"],
      excludedIndustries: [],
      applicableRegions: [],
      excludedRegions: [],
      applicableCustomerSizes: ["101-500"],
      excludedCustomerSizes: [],
      checkpoints: ["确认预算"],
      recommendedCadence: ["三天内回访"],
      effectiveActions: ["确认决策链"],
      commonRisks: ["没有下一步"],
      claimEvidence: { checkpoints: ["22222222-2222-4222-8222-222222222222"], recommendedCadence: ["22222222-2222-4222-8222-222222222222"], effectiveActions: ["22222222-2222-4222-8222-222222222222"], commonRisks: ["22222222-2222-4222-8222-222222222222"] },
      sampleIds: ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
      createdByName: "主管",
      publishedByName: "主管",
      publishReason: "样本完整",
      publishedAt: "2026-08-18T09:00:00.000Z",
      createdAt: "2026-08-18T08:00:00.000Z",
      updatedAt: "2026-08-18T09:00:00.000Z",
    },
  };
}

describe("商机详情团队打法建议", () => {
  it("展示有效动作、适用边界和当前用户可更新的既有反馈", () => {
    const html = renderToStaticMarkup(createElement(PlaybookRecommendationSection, {
      opportunityId: "55555555-5555-4555-8555-555555555555",
      recommendation: recommendation(),
    }));

    expect(html).toContain("有效动作");
    expect(html).toContain("确认决策链");
    expect(html).toContain("目标阶段");
    expect(html).toContain("初步接触");
    expect(html).toContain("适用行业");
    expect(html).toContain("制造");
    expect(html).toContain("适用地区");
    expect(html).toContain("不限");
    expect(html).toContain("客户暂无预算");
    expect(html).toContain("更新反馈");
  });
});
