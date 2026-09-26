import { describe, expect, it } from "vitest";
import { dueAtError, initialDueAt, presentEvidence } from "@/app/(app)/today/presentation";
import { BUSINESS_TZ } from "@/core/shared/tz";

const now = new Date("2026-08-14T10:00:00+08:00");

// 断言必须与产品代码同一口径：业务时区固定 Asia/Shanghai，不跟随宿主时区。
// 否则在 UTC 机器（如 CI runner）上会与实现结果差 8 小时。
function localDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TZ });
}

describe("今日洞察展示", () => {
  it("只将白名单 evidence 字段展示为可核验业务事实", () => {
    expect(presentEvidence([{ activityId: "activity-1", occurredAt: "2026-08-14T09:00:00+08:00" }])).toEqual([`最近一次跟进发生于 ${localDateTime("2026-08-14T09:00:00+08:00")}`]);
    expect(presentEvidence([{ taskId: "task-1", dueAt: "2026-08-14T08:00:00+08:00" }])).toEqual([`跟进任务截止于 ${localDateTime("2026-08-14T08:00:00+08:00")}`]);
    expect(presentEvidence([{ activityId: "activity-1", occurredAt: "2026-08-14T09:00:00+08:00", outcome: "INTERESTED", taskId: "task-1", dueAt: "2026-08-15T10:00:00+08:00" }])).toEqual([`08/14 09:00 的跟进结果为有意向`, `跟进任务截止于 08/15 10:00`]);
    expect(presentEvidence([{ stage: "PROPOSAL", stageEnteredAt: "2026-07-25T00:00:00+08:00", latestProgressAt: "2026-07-30T00:00:00+08:00", slaDays: 14 }])).toEqual([`方案沟通于 ${localDateTime("2026-07-25T00:00:00+08:00")} 进入，最近有效推进为 ${localDateTime("2026-07-30T00:00:00+08:00")}，阶段 SLA 为 14 天`]);
    expect(presentEvidence([{ activityIds: ["a", "b"], bothSummariesWeak: true }])).toEqual(["最近两次跟进记录信息不足"]);
    expect(presentEvidence([{ prompt: "不要显示", chainOfThought: "不要显示" }])).toEqual(["暂无可展示的业务事实"]);
  });

  it("无效或过期建议时间回退到未来 24 小时", () => {
    expect(initialDueAt("invalid", now)).toBe("2026-08-15T10:00");
    expect(initialDueAt("2026-08-14T09:00:00+08:00", now)).toBe("2026-08-15T10:00");
    expect(initialDueAt("2026-08-14T11:00:00+08:00", now)).toBe("2026-08-14T11:00");
  });

  it("提交过去或无效时间时返回中文错误", () => {
    expect(dueAtError("invalid", now)).toBe("下次跟进时间必须晚于现在");
    expect(dueAtError("2026-08-14T10:00+08:00", now)).toBe("下次跟进时间必须晚于现在");
    expect(dueAtError("2026-08-14T10:01+08:00", now)).toBeNull();
  });
});
