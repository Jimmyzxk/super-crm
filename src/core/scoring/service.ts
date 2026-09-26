import { sql } from "drizzle-orm";
import { withTenant, type TenantContext, type TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { evaluateScore, scoreFields, scoreOperators, type ScoreFacts, type ScoreField, type ScoreOperator, type ScoreRule } from "./rules";

type LeadScoreRow = {
  companyName: string | null;
  contactEmail: string | null;
  title: string | null;
  source: string;
  createdHour: number;
  activityCount: number;
  lastActivityOutcome: string | null;
  customerSize: string | null;
  customerIndustry: string | null;
  customerRegion: string | null;
  daysSinceActivity: number;
  wonDealCount: number;
  activeDealCount: number;
};

export async function scoreLeadInTransaction(
  tx: TenantTransaction,
  ctx: TenantContext,
  leadId: string,
): Promise<{ score: number; reason: string } | null> {
  // 扩展字段（客户画像/时效/商机事实）与基础字段一并喂给规则引擎，
  // 此前 6 个扩展字段从未查询、恒为 null，管理员配置后静默失效
  const lead = await tx.execute<LeadScoreRow>(sql`
    select l.company_name as "companyName", l.contact_email as "contactEmail", l.title, l.source,
      extract(hour from l.created_at)::int as "createdHour",
      (select count(*)::int from activities a where a.tenant_id = l.tenant_id and a.lead_id = l.id) as "activityCount",
      (select a.outcome::text from activities a where a.tenant_id = l.tenant_id and a.lead_id = l.id
        order by a.occurred_at desc, a.created_at desc limit 1) as "lastActivityOutcome",
      c.size::text as "customerSize",
      c.industry as "customerIndustry",
      c.region as "customerRegion",
      extract(day from (now() - coalesce(
        (select max(a2.occurred_at) from activities a2 where a2.tenant_id = l.tenant_id and a2.lead_id = l.id),
        l.created_at)))::int as "daysSinceActivity",
      (select count(*)::int from opportunities o
        where o.tenant_id = l.tenant_id and o.customer_id = l.customer_id
          and o.stage = 'WON' and o.deleted_at is null) as "wonDealCount",
      (select count(*)::int from opportunities o
        where o.tenant_id = l.tenant_id and o.customer_id = l.customer_id
          and o.stage not in ('WON', 'LOST') and o.deleted_at is null) as "activeDealCount"
    from leads l
    left join customers c on c.tenant_id = l.tenant_id and c.id = l.customer_id
    where l.tenant_id = ${ctx.tenantId} and l.id = ${leadId} and l.deleted_at is null
  `);
  const facts = lead.rows[0];
  if (!facts) return null;
  const rules = await tx.execute<ScoreRule>(sql`
    select label, field, operator::text as operator, value, weight, enabled, sort_order as "sortOrder"
    from score_rules where tenant_id = ${ctx.tenantId} and enabled = true and deleted_at is null
    order by sort_order, id
  `);
  const evaluated = evaluateScore(rules.rows, facts as ScoreFacts);
  await tx.execute(sql`update leads set score = ${evaluated.score}, score_reason = ${evaluated.reason}, scored_at = now(), updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${leadId} and deleted_at is null`);
  return { score: evaluated.score, reason: evaluated.reason };
}

export async function scoreLeadService(ctx: TenantContext, leadId: string): Promise<{ score: number; reason: string } | null> {
  const startedAt = Date.now();
  const result = await withTenant(ctx.tenantId, (tx) => scoreLeadInTransaction(tx, ctx, leadId));
  if (Date.now() - startedAt > 100) console.warn("lead scoring exceeded 100ms", { tenantId: ctx.tenantId, leadId });
  return result;
}

export async function scoreLeadSafely(ctx: TenantContext, leadId: string): Promise<void> {
  try {
    await scoreLeadService(ctx, leadId);
  } catch (error) {
    console.error("lead scoring failed", { tenantId: ctx.tenantId, leadId, error });
  }
}

export type ScoreRuleRow = {
  id: string;
  label: string;
  field: ScoreField;
  operator: ScoreOperator;
  value: string | null;
  weight: number;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type ScoreRuleInput = {
  label: string;
  field: ScoreField;
  operator: ScoreOperator;
  value: string | null;
  weight: number;
  enabled: boolean;
};

export type ScoreFeedbackRow = {
  verdict: "ACCURATE" | "INACCURATE";
  scoreAtFeedback: number;
  updatedAt: string;
};

function requireAdmin(ctx: TenantContext): void {
  if (ctx.role !== "ADMIN") throw new BusinessError("FORBIDDEN", "只有管理员可以配置评分规则");
}

function validateRule(input: ScoreRuleInput): ScoreRuleInput {
  const label = input.label.trim();
  if (!label || label.length > 30) throw new BusinessError("VALIDATION_ERROR", "说明文案需为 1-30 个字符", "label");
  if (!scoreFields.includes(input.field)) throw new BusinessError("VALIDATION_ERROR", "判定字段不受支持", "field");
  if (!scoreOperators.includes(input.operator)) throw new BusinessError("VALIDATION_ERROR", "判定方式不受支持", "operator");
  if (!Number.isInteger(input.weight) || input.weight < -100 || input.weight > 100) {
    throw new BusinessError("VALIDATION_ERROR", "分值必须是 -100 到 100 的整数", "weight");
  }
  if (["GT", "GTE"].includes(input.operator) && !["created_hour", "activity_count", "days_since_activity", "won_deal_count", "active_deal_count"].includes(input.field)) {
    throw new BusinessError("VALIDATION_ERROR", "大于/大于等于只能用于数值字段", "operator");
  }
  if (["EXISTS", "NOT_EXISTS"].includes(input.operator)) {
    if (input.value !== null) throw new BusinessError("VALIDATION_ERROR", "此判定方式不需要比较值", "value");
  } else if (!input.value?.trim() || input.value.trim().length > 200) {
    throw new BusinessError("VALIDATION_ERROR", "此判定方式必须填写 1-200 个字符的比较值", "value");
  }
  return { ...input, label, value: input.value?.trim() || null };
}

function mapRule(row: Record<string, unknown>): ScoreRuleRow {
  return {
    id: String(row.id),
    label: String(row.label),
    field: row.field as ScoreField,
    operator: row.operator as ScoreOperator,
    value: row.value as string | null,
    weight: Number(row.weight),
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sortOrder),
    updatedAt: String(row.updatedAt),
  };
}

export async function listScoreRulesService(ctx: TenantContext): Promise<ScoreRuleRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute(sql`
      select id, label, field, operator::text as operator, value, weight, enabled,
        sort_order as "sortOrder", updated_at::text as "updatedAt"
      from score_rules where tenant_id = ${ctx.tenantId} and deleted_at is null
      order by sort_order, id
    `);
    return result.rows.map((row) => mapRule(row as Record<string, unknown>));
  });
}

export async function getScoreFeedbackStatsService(ctx: TenantContext): Promise<{ accurate: number; inaccurate: number; total: number }> {
  requireAdmin(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ accurate: number; inaccurate: number; total: number }>(sql`
      select count(*) filter (where verdict = 'ACCURATE')::int as accurate,
        count(*) filter (where verdict = 'INACCURATE')::int as inaccurate,
        count(*)::int as total
      from score_feedback
      where tenant_id = ${ctx.tenantId} and created_at >= now() - interval '30 days'
    `);
    return result.rows[0] ?? { accurate: 0, inaccurate: 0, total: 0 };
  });
}

export async function submitScoreFeedbackService(
  ctx: TenantContext,
  leadId: string,
  verdict: "ACCURATE" | "INACCURATE",
): Promise<ScoreFeedbackRow> {
  return withTenant(ctx.tenantId, async (tx) => {
    const lead = await tx.execute<{ score: number | null; ownerUserId: string | null }>(sql`
      select score, owner_user_id as "ownerUserId" from leads
      where tenant_id = ${ctx.tenantId} and id = ${leadId} and deleted_at is null
        and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})
    `);
    const row = lead.rows[0];
    if (!row) throw new BusinessError("NOT_FOUND", "线索不存在或无权查看");
    if (row.score === null) throw new BusinessError("CONFLICT", "该线索尚未完成评分，请稍后再试");
    const result = await tx.execute<ScoreFeedbackRow>(sql`
      insert into score_feedback (tenant_id, lead_id, user_id, score_at_feedback, verdict)
      values (${ctx.tenantId}, ${leadId}, ${ctx.userId}, ${row.score}, ${verdict})
      on conflict (lead_id, user_id) do update set
        score_at_feedback = excluded.score_at_feedback,
        verdict = excluded.verdict,
        updated_at = now()
      returning verdict, score_at_feedback as "scoreAtFeedback", updated_at::text as "updatedAt"
    `);
    if (!result.rows[0]) throw new BusinessError("INTERNAL_ERROR", "评分反馈保存失败");
    return result.rows[0];
  });
}

async function getRule(tx: TenantTransaction, ctx: TenantContext, ruleId: string) {
  const result = await tx.execute<{ id: string }>(sql`select id from score_rules where tenant_id = ${ctx.tenantId} and id = ${ruleId} and deleted_at is null for update`);
  if (!result.rows[0]) throw new BusinessError("NOT_FOUND", "评分规则不存在");
}

export async function createScoreRuleService(ctx: TenantContext, input: ScoreRuleInput): Promise<ScoreRuleRow> {
  requireAdmin(ctx);
  const valid = validateRule(input);
  return withTenant(ctx.tenantId, async (tx) => {
    const order = await tx.execute<{ next: number }>(sql`select coalesce(max(sort_order), 0) + 10 as next from score_rules where tenant_id = ${ctx.tenantId} and deleted_at is null`);
    const result = await tx.execute(sql`
      insert into score_rules (tenant_id, label, field, operator, value, weight, enabled, sort_order)
      values (${ctx.tenantId}, ${valid.label}, ${valid.field}, ${valid.operator}, ${valid.value}, ${valid.weight}, ${valid.enabled}, ${order.rows[0]?.next ?? 10})
      returning id, label, field, operator::text as operator, value, weight, enabled, sort_order as "sortOrder", updated_at::text as "updatedAt"
    `);
    return mapRule(result.rows[0] as Record<string, unknown>);
  });
}

export async function updateScoreRuleService(ctx: TenantContext, ruleId: string, input: ScoreRuleInput): Promise<ScoreRuleRow> {
  requireAdmin(ctx);
  const valid = validateRule(input);
  return withTenant(ctx.tenantId, async (tx) => {
    await getRule(tx, ctx, ruleId);
    const result = await tx.execute(sql`
      update score_rules set label = ${valid.label}, field = ${valid.field}, operator = ${valid.operator},
        value = ${valid.value}, weight = ${valid.weight}, enabled = ${valid.enabled}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${ruleId}
      returning id, label, field, operator::text as operator, value, weight, enabled, sort_order as "sortOrder", updated_at::text as "updatedAt"
    `);
    return mapRule(result.rows[0] as Record<string, unknown>);
  });
}

export async function deleteScoreRuleService(ctx: TenantContext, ruleId: string): Promise<{ id: string; enabled: false }> {
  requireAdmin(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    await getRule(tx, ctx, ruleId);
    await tx.execute(sql`update score_rules set enabled = false, deleted_at = now(), updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${ruleId}`);
    return { id: ruleId, enabled: false };
  });
}

export async function reorderScoreRulesService(ctx: TenantContext, ruleIds: string[]): Promise<ScoreRuleRow[]> {
  requireAdmin(ctx);
  if (new Set(ruleIds).size !== ruleIds.length) throw new BusinessError("VALIDATION_ERROR", "评分规则排序不能重复", "ruleIds");
  return withTenant(ctx.tenantId, async (tx) => {
    const current = await tx.execute<{ id: string }>(sql`select id from score_rules where tenant_id = ${ctx.tenantId} and deleted_at is null order by sort_order, id`);
    if (current.rows.length !== ruleIds.length || current.rows.some((row) => !ruleIds.includes(row.id))) {
      throw new BusinessError("CONFLICT", "评分规则已变化，请刷新后重试");
    }
    for (const [index, id] of ruleIds.entries()) {
      await tx.execute(sql`update score_rules set sort_order = ${(index + 1) * 10}, updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${id}`);
    }
    const result = await tx.execute(sql`select id, label, field, operator::text as operator, value, weight, enabled, sort_order as "sortOrder", updated_at::text as "updatedAt" from score_rules where tenant_id = ${ctx.tenantId} and deleted_at is null order by sort_order, id`);
    return result.rows.map((row) => mapRule(row as Record<string, unknown>));
  });
}
