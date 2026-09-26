export const scoreFields = [
  "company_name",
  "contact_email",
  "title",
  "source",
  "created_hour",
  "activity_count",
  "last_activity_outcome",
  "customer_size",
  "customer_industry",
  "customer_region",
  "days_since_activity",
  "won_deal_count",
  "active_deal_count",
] as const;
export const scoreOperators = ["EXISTS", "NOT_EXISTS", "EQUALS", "CONTAINS", "STARTS_WITH", "GT", "GTE", "IN"] as const;

export type ScoreField = typeof scoreFields[number];
export type ScoreOperator = typeof scoreOperators[number];
export type ScoreRule = {
  label: string;
  field: ScoreField;
  operator: ScoreOperator;
  value: string | null;
  weight: number;
  enabled: boolean;
  sortOrder: number;
};
export type ScoreFacts = {
  companyName: string | null;
  contactEmail: string | null;
  title: string | null;
  source: string;
  createdHour: number;
  activityCount: number;
  lastActivityOutcome: string | null;
  customerSize?: string | null;
  customerIndustry?: string | null;
  customerRegion?: string | null;
  daysSinceActivity?: number | null;
  wonDealCount?: number | null;
  activeDealCount?: number | null;
};
export type ScoreEvaluation = { score: number; reason: string; matchedRules: ScoreRule[] };

function valueFor(facts: ScoreFacts, field: ScoreField): string | number | null {
  if (field === "company_name") return facts.companyName;
  if (field === "contact_email") return facts.contactEmail;
  if (field === "title") return facts.title;
  if (field === "source") return facts.source;
  if (field === "created_hour") return facts.createdHour;
  if (field === "activity_count") return facts.activityCount;
  if (field === "last_activity_outcome") return facts.lastActivityOutcome;
  if (field === "customer_size") return facts.customerSize ?? null;
  if (field === "customer_industry") return facts.customerIndustry ?? null;
  if (field === "customer_region") return facts.customerRegion ?? null;
  if (field === "days_since_activity") return facts.daysSinceActivity ?? null;
  if (field === "won_deal_count") return facts.wonDealCount ?? null;
  if (field === "active_deal_count") return facts.activeDealCount ?? null;
  return null;
}

function exists(value: string | number | null): boolean {
  return value !== null && (typeof value !== "string" || value.trim().length > 0);
}

export function ruleMatches(rule: ScoreRule, facts: ScoreFacts): boolean {
  const actual = valueFor(facts, rule.field);
  if (rule.operator === "EXISTS") return exists(actual);
  if (rule.operator === "NOT_EXISTS") return !exists(actual);
  if (!exists(actual) || rule.value === null) return false;
  const text = String(actual);
  if (rule.operator === "EQUALS") return text === rule.value;
  if (rule.operator === "CONTAINS") return text.includes(rule.value);
  if (rule.operator === "STARTS_WITH") return text.startsWith(rule.value);
  if (rule.operator === "IN") return rule.value.split(",").map((value) => value.trim()).filter(Boolean).includes(text);
  const expected = Number(rule.value);
  const numeric = typeof actual === "number" ? actual : Number(actual);
  if (!Number.isFinite(numeric) || !Number.isFinite(expected)) return false;
  return rule.operator === "GT" ? numeric > expected : numeric >= expected;
}

function reasonFor(rules: ScoreRule[]): string {
  if (rules.length === 0) return "暂无加分项";
  let reason = "";
  for (const [index, rule] of rules.entries()) {
    const part = `${rule.label} ${rule.weight >= 0 ? "+" : ""}${rule.weight}`;
    const candidate = reason ? `${reason}，${part}` : part;
    const mustReserveEllipsis = index < rules.length - 1;
    if (candidate.length <= (mustReserveEllipsis ? 499 : 500)) {
      reason = candidate;
      continue;
    }
    return reason ? `${reason}等` : "等";
  }
  return reason;
}

export function evaluateScore(rules: ScoreRule[], facts: ScoreFacts): ScoreEvaluation {
  const matchedRules = rules
    .filter((rule) => rule.enabled && ruleMatches(rule, facts))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const total = matchedRules.reduce((sum, rule) => sum + rule.weight, 0);
  return { score: Math.max(0, Math.min(100, total)), reason: reasonFor(matchedRules), matchedRules };
}
