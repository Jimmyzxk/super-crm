export type InsightCode =
  | "NO_NEXT_STEP"
  | "FOLLOWUP_OVERDUE"
  | "STAGE_STALLED"
  | "WEAK_FOLLOWUP"
  | "POSITIVE_SIGNAL";

export type InsightSeverity = "INFO" | "ATTENTION" | "HIGH_RISK";
export type ActivityOutcome = "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED";
export type ActivityType = "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
export type OpportunityStage = "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";

export interface InsightActivity {
  id?: string;
  type: ActivityType;
  occurredAt: Date | string;
  summary: string;
  outcome?: ActivityOutcome | null;
}

export interface InsightTask {
  id?: string;
  type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH";
  status: "OPEN" | "DONE" | "CANCELLED";
  dueAt: Date | string;
}

export interface InsightFacts {
  activities?: InsightActivity[];
  openTask?: InsightTask | null;
  active?: boolean;
  stage?: OpportunityStage;
  stageEnteredAt?: Date | string;
  latestValidProgressAt?: Date | string;
  stageSlaDays?: number;
  now?: Date | string;
}

export interface SalesInsight {
  code: InsightCode;
  severity: InsightSeverity;
  title: string;
  summary: string;
  suggestedAction: string;
  suggestedDueAt?: Date;
  evidence: unknown[];
}

const STAGE_SLA_DAYS: Record<Exclude<OpportunityStage, "WON" | "LOST">, number> = {
  DISCOVERY: 7,
  PROPOSAL: 14,
  NEGOTIATION: 14,
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function latestActivity(facts: InsightFacts): InsightActivity | null {
  return [...(facts.activities ?? [])]
    .filter((activity) => isCustomerInteraction(activity) && asDate(activity.occurredAt))
    .sort((a, b) => asDate(b.occurredAt)!.getTime() - asDate(a.occurredAt)!.getTime())[0] ?? null;
}

function isCustomerInteraction(activity: InsightActivity): boolean {
  return activity.type !== "NOTE";
}

function openFollowUpTask(facts: InsightFacts): InsightTask | null {
  const task = facts.openTask;
  return task?.type === "FOLLOW_UP" && task.status === "OPEN" && asDate(task.dueAt) ? task : null;
}

function insight(code: InsightCode, severity: InsightSeverity, title: string, summary: string, suggestedAction: string, evidence: unknown[], suggestedDueAt?: Date): SalesInsight {
  return { code, severity, title, summary, suggestedAction, evidence, ...(suggestedDueAt ? { suggestedDueAt } : {}) };
}

function isActiveSubject(facts: InsightFacts): boolean {
  return facts.active !== false && facts.stage !== "WON" && facts.stage !== "LOST";
}

export function noNextStep(facts: InsightFacts): SalesInsight | null {
  const activity = latestActivity(facts);
  const task = openFollowUpTask(facts);
  if (!isActiveSubject(facts) || !activity || task) return null;
  return insight("NO_NEXT_STEP", "ATTENTION", "最近跟进没有下一步", "最近一次跟进没有记录下一步时间。", "与客户确认下一动作并设置提醒。", [{ activityId: activity.id, occurredAt: asDate(activity.occurredAt)!.toISOString() }]);
}

export function followupOverdue(facts: InsightFacts): SalesInsight | null {
  const now = asDate(facts.now) ?? new Date();
  const task = openFollowUpTask(facts);
  const dueAt = asDate(task?.dueAt);
  if (!isActiveSubject(facts) || !task || task.status !== "OPEN" || !dueAt || dueAt >= now) return null;
  return insight("FOLLOWUP_OVERDUE", "HIGH_RISK", "跟进任务已超时", `跟进任务已于 ${dueAt.toISOString()} 到期。`, "今天优先联系客户并更新跟进结果。", [{ taskId: task.id, dueAt: dueAt.toISOString() }], now);
}

export function stageStalled(facts: InsightFacts): SalesInsight | null {
  if (!facts.stage || facts.stage === "WON" || facts.stage === "LOST") return null;
  const enteredAt = asDate(facts.stageEnteredAt);
  const now = asDate(facts.now) ?? new Date();
  const slaDays = facts.stageSlaDays ?? STAGE_SLA_DAYS[facts.stage];
  if (!enteredAt || !Number.isFinite(slaDays) || now.getTime() <= enteredAt.getTime() + slaDays * 86400000) return null;
  const latestActivityProgressAt = (facts.activities ?? []).reduce((latest, activity) => {
    const occurredAt = asDate(activity.occurredAt);
    if (!isCustomerInteraction(activity) || !occurredAt || occurredAt <= enteredAt || isWeakSummary(activity.summary)) return latest;
    return !latest || occurredAt > latest ? occurredAt : latest;
  }, null as Date | null);
  const suppliedProgressAt = asDate(facts.latestValidProgressAt);
  const latestValidFollowupAt = suppliedProgressAt && (!latestActivityProgressAt || suppliedProgressAt > latestActivityProgressAt)
    ? suppliedProgressAt
    : latestActivityProgressAt;
  const latestProgressAt = latestValidFollowupAt && latestValidFollowupAt > enteredAt ? latestValidFollowupAt : enteredAt;
  if (now.getTime() <= latestProgressAt.getTime() + slaDays * 86400000) return null;
  return insight("STAGE_STALLED", "HIGH_RISK", "商机阶段已停滞", `当前阶段 ${facts.stage} 已超过 ${slaDays} 天且没有有效推进记录。`, "复核阻塞点，推进或降级/丢单。", [{ stage: facts.stage, stageEnteredAt: enteredAt.toISOString(), latestProgressAt: latestProgressAt.toISOString(), slaDays }], now);
}

function isWeakSummary(summary: string): boolean {
  const normalized = summary.trim().replace(/[，。！？、,.!?\s]/g, "");
  return normalized.length <= 10 || ["已联系", "联系了", "跟进", "已跟进", "沟通", "已沟通", "无", "暂无"].includes(normalized);
}

export function weakFollowup(facts: InsightFacts): SalesInsight | null {
  const activities = [...(facts.activities ?? [])]
    .filter((activity) => isCustomerInteraction(activity) && asDate(activity.occurredAt))
    .sort((a, b) => asDate(b.occurredAt)!.getTime() - asDate(a.occurredAt)!.getTime());
  if (!isActiveSubject(facts) || activities.length < 2 || !isWeakSummary(activities[0].summary) || !isWeakSummary(activities[1].summary)) return null;
  return insight("WEAK_FOLLOWUP", "ATTENTION", "连续跟进信息不足", "最近两次跟进摘要过短或缺少有效信息。", "补记客户反馈、异议和下一步。", [{ activityIds: activities.slice(0, 2).map((activity) => activity.id), bothSummariesWeak: true }]);
}

export function positiveSignal(facts: InsightFacts): SalesInsight | null {
  const activity = latestActivity(facts);
  const task = openFollowUpTask(facts);
  const dueAt = asDate(task?.dueAt);
  const now = asDate(facts.now) ?? new Date();
  if (!isActiveSubject(facts) || !activity || activity.outcome !== "INTERESTED" || !task || !dueAt || dueAt <= now) return null;
  return insight("POSITIVE_SIGNAL", "INFO", "客户表现出积极信号", "最近一次跟进结果为有意向，且下一步已明确。", "按约定时间推进，不提前打扰客户。", [{ activityId: activity.id, outcome: activity.outcome, taskId: task.id, dueAt: dueAt.toISOString() }], dueAt);
}

export function evaluateInsightRules(facts: InsightFacts): SalesInsight[] {
  return [noNextStep(facts), followupOverdue(facts), stageStalled(facts), weakFollowup(facts), positiveSignal(facts)].filter((result): result is SalesInsight => result !== null);
}
