import { dateInputValue } from "@/core/shared/date";

type EvidenceRecord = Record<string, unknown>;

const stageLabels: Record<string, string> = {
  DISCOVERY: "需求探索",
  PROPOSAL: "方案沟通",
  NEGOTIATION: "商务谈判",
};

const outcomeLabels: Record<string, string> = {
  CONNECTED: "已接通",
  NO_ANSWER: "未接通",
  REFUSED: "明确拒绝",
  INTERESTED: "有意向",
};

function record(value: unknown): EvidenceRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as EvidenceRecord : null;
}

function dateText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function presentEvidence(evidence: unknown[]): string[] {
  const facts = evidence.flatMap((value) => {
    const item = record(value);
    if (!item) return [];

    const displayed: string[] = [];
    const taskDueAt = dateText(item.dueAt);
    const activityAt = dateText(item.occurredAt);
    if (activityAt && typeof item.activityId === "string") {
      const outcome = typeof item.outcome === "string" ? outcomeLabels[item.outcome] : null;
      displayed.push(outcome ? `${activityAt} 的跟进结果为${outcome}` : `最近一次跟进发生于 ${activityAt}`);
    }
    if (taskDueAt && typeof item.taskId === "string") displayed.push(`跟进任务截止于 ${taskDueAt}`);
    if (displayed.length > 0) return displayed;

    if (Array.isArray(item.activityIds) && item.activityIds.length === 2 && item.activityIds.every((id) => typeof id === "string") && item.bothSummariesWeak === true) {
      return ["最近两次跟进记录信息不足"];
    }

    const enteredAt = dateText(item.stageEnteredAt);
    const progressedAt = dateText(item.latestProgressAt);
    if (typeof item.stage === "string" && stageLabels[item.stage] && enteredAt && progressedAt && typeof item.slaDays === "number" && Number.isFinite(item.slaDays)) {
      return [`${stageLabels[item.stage]}于 ${enteredAt} 进入，最近有效推进为 ${progressedAt}，阶段 SLA 为 ${item.slaDays} 天`];
    }

    return [];
  });
  return facts.length > 0 ? facts : ["暂无可展示的业务事实"];
}

export function initialDueAt(value: string | null, now = new Date()): string {
  const suggested = value ? new Date(value) : null;
  const dueAt = suggested && !Number.isNaN(suggested.getTime()) && suggested > now
    ? suggested
    : new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return dateInputValue(dueAt);
}

export function dueAtError(value: string, now = new Date()): string | null {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime()) || dueAt <= now) return "下次跟进时间必须晚于现在";
  return null;
}
