import { describe, expect, it } from "vitest";
import { presentOpportunityTimeline } from "@/app/(app)/opportunities/[opportunityId]/timeline-presentation";

function stages(count: number) { return Array.from({ length: count }, (_, index) => ({ id: `stage-${index}`, fromStage: null, toStage: "DISCOVERY" as const, note: null, operatorName: "销售", createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z` })); }
function activities(count: number) { return Array.from({ length: count }, (_, index) => ({ id: `activity-${index}`, type: "CALL", outcome: "CONNECTED", summary: "已跟进", occurredAt: `2026-09-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`, userName: "销售" })); }

describe("商机统一经营时间线", () => {
  it("15 条阶段和 15 条跟进合并后继续分页，不丢后 10 条", () => {
    const result = presentOpportunityTimeline(stages(15), activities(15), 20, null);
    expect(result.entries).toHaveLength(20);
    expect(result.nextLimit).toBe(40);
  });

  it("只有一类 21 条时生成下一页", () => {
    const result = presentOpportunityTimeline(stages(0), activities(21), 20, null);
    expect(result.entries).toHaveLength(20);
    expect(result.nextLimit).toBe(40);
  });

  it("合并总数不超过当前页时不显示加载更多", () => {
    const result = presentOpportunityTimeline(stages(10), activities(10), 20, null);
    expect(result.entries).toHaveLength(20);
    expect(result.nextLimit).toBeNull();
  });

  it("100 条已达上限时不再生成下一页", () => {
    const result = presentOpportunityTimeline(stages(100), activities(100), 100, null);
    expect(result.entries).toHaveLength(100);
    expect(result.nextLimit).toBeNull();
  });
});
