import { describe, expect, it } from "vitest";
import { evaluateInsightRules, followupOverdue, noNextStep, positiveSignal, stageStalled, weakFollowup } from "@/core/insight/rules";

const now = new Date("2026-08-14T10:00:00.000Z");
const activity = (overrides: Record<string, unknown> = {}) => ({ type: "CALL" as const, occurredAt: "2026-08-14T09:00:00.000Z", summary: "客户确认了试用范围和内部评估安排", ...overrides });
const followUp = (overrides: Record<string, unknown> = {}) => ({ type: "FOLLOW_UP" as const, status: "OPEN" as const, dueAt: "2026-08-15T09:00:00Z", id: "task-follow-up", ...overrides });

describe("销售质检规则", () => {
  it("没有活动或已有下一步时不命中 NO_NEXT_STEP", () => {
    expect(noNextStep({ now })).toBeNull();
    expect(noNextStep({ now, activities: [activity()] })?.code).toBe("NO_NEXT_STEP");
    expect(noNextStep({ now, activities: [activity()], openTask: followUp() }) ).toBeNull();
    expect(noNextStep({ now, activities: [activity()], openTask: followUp({ dueAt: "2026-08-14T09:00:00Z" }) })).toBeNull();
    expect(noNextStep({ now, activities: [activity()], openTask: followUp({ dueAt: "2026-08-13T09:00:00Z" }) })).toBeNull();
    expect(noNextStep({ now, activities: [activity()], openTask: { ...followUp(), type: "STAGE_PUSH" } })).toMatchObject({ code: "NO_NEXT_STEP" });
    expect(noNextStep({ now, activities: [activity({ type: "NOTE", summary: "内部备注" })] })).toBeNull();
  });

  it("只将严格早于当前时间的 OPEN 任务判为超时", () => {
    expect(followupOverdue({ now, openTask: followUp({ dueAt: now }) })).toBeNull();
    expect(followupOverdue({ now, openTask: followUp({ status: "DONE", dueAt: "2026-08-13T09:00:00Z" }) })).toBeNull();
    expect(followupOverdue({ now, openTask: followUp({ dueAt: "2026-08-13T09:00:00Z" }) })?.severity).toBe("HIGH_RISK");
    expect(followupOverdue({ now, openTask: { ...followUp({ dueAt: "2026-08-13T09:00:00Z" }), type: "STAGE_PUSH" } })).toBeNull();
    expect(followupOverdue({ now, stage: "WON", openTask: followUp({ dueAt: "2026-08-13T09:00:00Z" }) })).toBeNull();
  });

  it("阶段刚好到 SLA 不算停滞，终态永不命中", () => {
    const enteredAt = "2026-08-07T10:00:00Z";
    expect(stageStalled({ now, stage: "DISCOVERY", stageEnteredAt: enteredAt })).toBeNull();
    expect(stageStalled({ now: new Date("2026-08-14T10:00:01Z"), stage: "DISCOVERY", stageEnteredAt: enteredAt })?.code).toBe("STAGE_STALLED");
    expect(stageStalled({ now, stage: "WON", stageEnteredAt: "2026-01-01T00:00:00Z" })).toBeNull();
    expect(stageStalled({ now, stage: "PROPOSAL", stageEnteredAt: "2026-07-25T00:00:00Z", activities: [activity({ occurredAt: "2026-07-30T00:00:00Z" })] })?.code).toBe("STAGE_STALLED");
    expect(stageStalled({ now, stage: "PROPOSAL", stageEnteredAt: "2026-07-25T00:00:00Z", activities: [activity({ occurredAt: "2026-08-11T00:00:00Z" })] })).toBeNull();
  });

  it("连续两次短摘要才命中 WEAK_FOLLOWUP，忽略标点和空白边界", () => {
    expect(weakFollowup({ now, activities: [activity({ summary: "已联系" }), activity({ summary: "跟进。。。" })] })?.code).toBe("WEAK_FOLLOWUP");
    expect(weakFollowup({ now, activities: [activity({ summary: "已联系" }), activity({ summary: "客户明确要求下周提供技术方案" })] })).toBeNull();
    expect(weakFollowup({ now, activities: [activity({ summary: "已联系" })] })).toBeNull();
    expect(weakFollowup({ now, stage: "LOST", activities: [activity({ summary: "已联系" }), activity({ summary: "跟进。。。" })] })).toBeNull();
    expect(weakFollowup({ now, activities: [activity({ type: "NOTE", summary: "已联系" }), activity({ type: "NOTE", summary: "跟进。。。", occurredAt: "2026-08-14T10:00:00Z" })] })).toBeNull();
  });

  it("积极信号要求最近一次有意向且下一步在未来", () => {
    expect(positiveSignal({ now, activities: [activity({ outcome: "INTERESTED" })], openTask: followUp() })?.code).toBe("POSITIVE_SIGNAL");
    expect(positiveSignal({ now, activities: [activity({ outcome: "INTERESTED" })], openTask: followUp({ dueAt: now }) })).toBeNull();
    expect(positiveSignal({ now, activities: [activity({ outcome: "CONNECTED" })], openTask: followUp() })).toBeNull();
    expect(positiveSignal({ now, stage: "WON", activities: [activity({ outcome: "INTERESTED" })], openTask: followUp() })).toBeNull();
    expect(positiveSignal({ now, activities: [activity({ outcome: "INTERESTED" }), activity({ type: "NOTE", summary: "内部备注", occurredAt: "2026-08-14T10:00:00Z" })], openTask: followUp() })?.code).toBe("POSITIVE_SIGNAL");
    expect(positiveSignal({ now, activities: [activity({ outcome: "INTERESTED" })], openTask: { ...followUp(), type: "STAGE_PUSH" } })).toBeNull();
  });

  it("组合评估只返回命中的规则，并且不从 demand_note 生成结论", () => {
    const results = evaluateInsightRules({ now, activities: [activity({ outcome: "INTERESTED", summary: "已联系" }), activity({ summary: "跟进" })], openTask: followUp(), stage: "DISCOVERY", stageEnteredAt: "2026-08-01T00:00:00Z" });
    expect(results.map((result) => result.code)).toEqual(["STAGE_STALLED", "WEAK_FOLLOWUP", "POSITIVE_SIGNAL"]);
    expect(JSON.stringify(results)).not.toContain("budget");
    expect(JSON.stringify(results)).not.toContain("decision");
    expect(JSON.stringify(results)).not.toContain("timeline");
    expect(results.every((result) => Array.isArray(result.evidence))).toBe(true);
  });

  it("终态对象的所有活动和任务规则都不命中", () => {
    const facts = { now, stage: "LOST" as const, activities: [activity({ summary: "已联系", outcome: "INTERESTED" }), activity({ summary: "跟进" })], openTask: followUp({ dueAt: "2026-08-13T09:00:00Z" }) };
    expect(evaluateInsightRules(facts)).toEqual([]);
  });

  it("过期 FOLLOW_UP 只命中 FOLLOWUP_OVERDUE，不重复命中 NO_NEXT_STEP", () => {
    const results = evaluateInsightRules({ now, activities: [activity()], openTask: followUp({ dueAt: "2026-08-13T09:00:00Z" }) });
    expect(results.map((result) => result.code)).toEqual(["FOLLOWUP_OVERDUE"]);
  });

  it("NOTE 不会重置阶段 SLA", () => {
    expect(stageStalled({ now, stage: "PROPOSAL", stageEnteredAt: "2026-07-25T00:00:00Z", activities: [activity({ type: "NOTE", summary: "内部备注", occurredAt: "2026-08-13T00:00:00Z" })] })?.code).toBe("STAGE_STALLED");
  });
});
