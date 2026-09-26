import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { listActiveTenantIdsWithoutTenant, withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { evaluateInsightRules, type InsightFacts, type InsightActivity, type InsightTask, type SalesInsight } from "./rules";
import type { InsightDismissReason, InsightFactsRow, InsightListItem, InsightSubjectType, InsightTaskFact } from "./types";

type Subject = { type: InsightSubjectType; id: string };
type InsightRow = InsightListItem;
type ScanCandidate = Subject & { userId: string };

export type InsightScanResult = {
  tenantsScanned: number;
  candidates: number;
  succeeded: number;
  failed: number;
  tenantFailures: number;
  elapsedMs: number;
};
const dismissReasons = new Set<InsightDismissReason>(["NOT_APPLICABLE", "ALREADY_HANDLED", "WRONG_INFORMATION", "OTHER"]);
function shouldMarkRefreshFailure(error: unknown): boolean {
  if (error instanceof BusinessError) return false;
  return !(error instanceof Error && error.message === "UNAUTHENTICATED");
}

function subjectColumn(subject: Subject): "lead_id" | "opportunity_id" {
  return subject.type === "lead" ? "lead_id" : "opportunity_id";
}

function subjectPredicate(subject: Subject) {
  return subject.type === "lead" ? sql`lead_id = ${subject.id}` : sql`opportunity_id = ${subject.id}`;
}

function activitySubjectPredicate(subject: Subject, tenantId: string) {
  return subject.type === "lead"
    ? sql`a.lead_id = ${subject.id}`
    : sql`(a.opportunity_id = ${subject.id} or a.customer_id = (
        select o.customer_id from opportunities o where o.tenant_id = ${tenantId} and o.id = ${subject.id}
      ))`;
}

function toFacts(row: InsightFactsRow, now = new Date()): InsightFacts {
  const activities: InsightActivity[] = row.activities.map((activity) => ({
    id: activity.id,
    type: activity.type,
    outcome: activity.outcome,
    summary: activity.summary,
    occurredAt: activity.occurredAt,
  }));
  const openTask: InsightTask | null = row.openTask ? {
    id: row.openTask.id,
    type: row.openTask.type,
    status: row.openTask.status,
    dueAt: row.openTask.dueAt,
  } : null;
  return { activities, openTask, active: row.active, stage: row.stage, stageEnteredAt: row.stageEnteredAt, latestValidProgressAt: row.latestValidProgressAt, now };
}

async function readFacts(tx: TenantTransaction, ctx: TenantContext, subject: Subject): Promise<InsightFactsRow> {
  let leadActive: boolean | undefined;
  if (subject.type === "lead") {
    const visible = await tx.execute<{ id: string; status: string }>(sql`select id, status from leads where tenant_id = ${ctx.tenantId} and id = ${subject.id} and deleted_at is null and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})`);
    if (!visible.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    leadActive = visible.rows[0].status !== "CONVERTED" && visible.rows[0].status !== "DISCARDED";
  } else {
    const visible = await tx.execute<{ id: string }>(sql`select id from opportunities where tenant_id = ${ctx.tenantId} and id = ${subject.id} and deleted_at is null and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})`);
    if (!visible.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  }

  const activityResult = await tx.execute<InsightFactsRow["activities"][number]>(sql`select a.id, a.type, a.outcome, a.summary, a.occurred_at::text as "occurredAt"
    from activities a where a.tenant_id = ${ctx.tenantId} and ${activitySubjectPredicate(subject, ctx.tenantId)}
    order by a.occurred_at desc, a.created_at desc limit 20`);
  const taskResult = subject.type === "lead"
    ? await tx.execute<InsightTaskFact>(sql`select id, type, status, due_at::text as "dueAt"
        from tasks where tenant_id = ${ctx.tenantId} and lead_id = ${subject.id} and status = 'OPEN' limit 1`)
    : await tx.execute<InsightTaskFact>(sql`select t.id, t.type, t.status, t.due_at::text as "dueAt"
        from tasks t where t.tenant_id = ${ctx.tenantId} and t.status = 'OPEN' and (
          t.opportunity_id = ${subject.id} or t.customer_id = (
            select o.customer_id from opportunities o where o.tenant_id = ${ctx.tenantId} and o.id = ${subject.id}
          )
        )
        order by (t.type = 'FOLLOW_UP') desc, (t.opportunity_id is not null) desc, t.due_at, t.id limit 1`);
  if (subject.type === "lead") return { activities: activityResult.rows, openTask: taskResult.rows[0] ?? null, active: leadActive };
  const opportunity = await tx.execute<{ stage: InsightFactsRow["stage"]; stageEnteredAt: string; latestValidProgressAt: string | null }>(sql`
    select o.stage, o.stage_entered_at::text as "stageEnteredAt", latest.occurred_at::text as "latestValidProgressAt"
    from opportunities o
    left join lateral (
      select a.occurred_at
      from activities a
      where a.tenant_id = o.tenant_id and (a.opportunity_id = o.id or a.customer_id = o.customer_id)
        and a.type <> 'NOTE' and a.occurred_at > o.stage_entered_at and ${weakSummarySql("a.summary")}
      order by a.occurred_at desc, a.created_at desc
      limit 1
    ) latest on true
    where o.tenant_id = ${ctx.tenantId} and o.id = ${subject.id}`);
  return {
    activities: activityResult.rows,
    openTask: taskResult.rows[0] ?? null,
    stage: opportunity.rows[0]?.stage,
    stageEnteredAt: opportunity.rows[0]?.stageEnteredAt,
    latestValidProgressAt: opportunity.rows[0]?.latestValidProgressAt ?? undefined,
  };
}

function insightValues(rule: SalesInsight) {
  return {
    code: rule.code,
    severity: rule.severity,
    title: rule.title,
    summary: rule.summary,
    suggestedAction: rule.suggestedAction,
    suggestedDueAt: rule.suggestedDueAt ?? null,
    evidence: JSON.stringify(rule.evidence),
  };
}

async function reconcile(tx: TenantTransaction, ctx: TenantContext, subject: Subject, rules: SalesInsight[]) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${ctx.tenantId}:${subject.type}:${subject.id}`}, 0))`);
  const existing = await tx.execute<{ id: string; code: string }>(sql`select id, code from sales_insights where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)} and status = 'OPEN' for update`);
  const openByCode = new Map(existing.rows.map((row) => [row.code, row]));
  const currentCodes = new Set<string>(rules.map((rule) => rule.code));
  const column = subjectColumn(subject);

  for (const row of existing.rows) {
    if (!currentCodes.has(row.code)) {
      await tx.execute(sql`update sales_insights set status = 'EXPIRED', expires_at = now(), updated_at = now()
        where id = ${row.id} and status = 'OPEN'`);
    }
  }

  for (const rule of rules) {
    const values = insightValues(rule);
    if (openByCode.has(values.code)) {
      await tx.execute(sql`update sales_insights set severity = ${values.severity}::insight_severity, title = ${values.title}, summary = ${values.summary}, suggested_action = ${values.suggestedAction}, suggested_due_at = ${values.suggestedDueAt}, evidence = ${values.evidence}::jsonb, source_type = 'RULE'::insight_source, source_version = 'rules-v1', updated_at = now()
        where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)} and code = ${values.code} and status = 'OPEN'`);
      continue;
    }

    const terminal = await tx.execute<{ same_evidence: boolean }>(sql`select evidence = ${values.evidence}::jsonb as same_evidence
      from sales_insights where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)} and code = ${values.code}
        and status in ('ACCEPTED', 'DISMISSED')
      order by updated_at desc, created_at desc limit 1`);
    if (terminal.rows[0]?.same_evidence) continue;

    await tx.execute(sql`insert into sales_insights
      (tenant_id, ${sql.raw(column)}, code, severity, status, title, summary, suggested_action, suggested_due_at, evidence, source_type, source_version)
      values (${ctx.tenantId}, ${subject.id}, ${values.code}, ${values.severity}::insight_severity, 'OPEN', ${values.title}, ${values.summary}, ${values.suggestedAction}, ${values.suggestedDueAt}, ${values.evidence}::jsonb, 'RULE'::insight_source, 'rules-v1')`);
  }
}

export async function refreshInsightsService(ctx: TenantContext, subject: Subject, now = new Date()): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    const row = await readFacts(tx, ctx, subject);
    await reconcile(tx, ctx, subject, evaluateInsightRules(toFacts(row, now)));
    await tx.execute(sql`update sales_insights set refresh_failed_at = null
      where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)}`);
  });
}

export async function refreshInsightsSafely(ctx: TenantContext, subject: Subject, now = new Date()): Promise<boolean> {
  try {
    await refreshInsightsService(ctx, subject, now);
    return true;
  } catch (error) {
    console.error("sales insight refresh failed", { tenantId: ctx.tenantId, subjectType: subject.type, subjectId: subject.id, error });
    if (!shouldMarkRefreshFailure(error)) return false;
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx.execute(sql`update sales_insights set refresh_failed_at = now(), updated_at = now()
          where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)}`);
      });
    } catch (markError) {
      console.error("sales insight refresh failure marking failed", { tenantId: ctx.tenantId, subjectType: subject.type, subjectId: subject.id, error: markError });
    }
    return false;
  }
}

function weakSummarySql(column: string) {
  const normalized = sql`regexp_replace(${sql.raw(column)}, '[，。！？、,.!?[:space:]]', '', 'g')`;
  return sql`char_length(${normalized}) > 10 and ${normalized} not in ('已联系', '联系了', '跟进', '已跟进', '沟通', '已沟通', '无', '暂无')`;
}

function isoUtcSql(column: string) {
  return sql`to_char(${sql.raw(column)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

async function scanTenantCandidates(tenantId: string, now: Date): Promise<ScanCandidate[]> {
  return withTenant(tenantId, async (tx) => {
    const taskCandidates = await tx.execute<{ id: string; type: InsightSubjectType; userId: string }>(sql`
      with overdue_tasks as (
        select t.lead_id as subject_id, 'lead'::text as subject_type, t.assignee_user_id as user_id,
          t.due_at, t.id as task_id
        from tasks t
        where t.tenant_id = ${tenantId} and t.status = 'OPEN' and t.type = 'FOLLOW_UP'
          and t.due_at < ${now}::timestamptz and t.lead_id is not null
          and not exists (
            select 1 from sales_insights si
            where si.tenant_id = ${tenantId} and si.lead_id = t.lead_id
              and si.code = 'FOLLOWUP_OVERDUE' and si.refresh_failed_at is null
              and si.evidence = jsonb_build_array(jsonb_build_object(
                'taskId', t.id, 'dueAt', ${isoUtcSql("t.due_at")}))
          )
        union all
        select o.id as subject_id, 'opportunity'::text as subject_type, t.assignee_user_id as user_id,
          t.due_at, t.id as task_id
        from tasks t
        join opportunities o on o.tenant_id = t.tenant_id and o.customer_id = t.customer_id
          and o.deleted_at is null and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
        where t.tenant_id = ${tenantId} and t.status = 'OPEN' and t.type = 'FOLLOW_UP'
          and t.due_at < ${now}::timestamptz and t.customer_id is not null
          and not exists (
            select 1 from sales_insights si
            where si.tenant_id = ${tenantId} and si.opportunity_id = o.id
              and si.code = 'FOLLOWUP_OVERDUE' and si.refresh_failed_at is null
              and si.evidence = jsonb_build_array(jsonb_build_object(
                'taskId', t.id, 'dueAt', ${isoUtcSql("t.due_at")}))
          )
        union all
        select t.opportunity_id as subject_id, 'opportunity'::text as subject_type, t.assignee_user_id as user_id,
          t.due_at, t.id as task_id
        from tasks t
        where t.tenant_id = ${tenantId} and t.status = 'OPEN' and t.type = 'FOLLOW_UP'
          and t.due_at < ${now}::timestamptz and t.opportunity_id is not null
          and not exists (
            select 1 from sales_insights si
            where si.tenant_id = ${tenantId} and si.opportunity_id = t.opportunity_id
              and si.code = 'FOLLOWUP_OVERDUE' and si.refresh_failed_at is null
              and si.evidence = jsonb_build_array(jsonb_build_object(
                'taskId', t.id, 'dueAt', ${isoUtcSql("t.due_at")}))
          )
      ), ranked as (
        select subject_id, subject_type, user_id, due_at, task_id,
          row_number() over (partition by subject_type, subject_id order by due_at, task_id) as subject_rank
        from overdue_tasks
      )
      select subject_id as id, subject_type as type, user_id as "userId"
      from ranked where subject_rank = 1
      order by due_at, task_id
      limit 500`);

    const stageCandidates = await tx.execute<{ id: string; userId: string }>(sql`
      with stage_facts as (
        select o.id, o.owner_user_id, o.stage, o.stage_entered_at,
          case o.stage when 'DISCOVERY' then 7 when 'PROPOSAL' then 14 when 'NEGOTIATION' then 14 end as sla_days,
          coalesce(latest.occurred_at, o.stage_entered_at) as latest_progress_at
        from opportunities o
        left join lateral (
          select a.occurred_at
          from activities a
          where a.tenant_id = o.tenant_id and (a.opportunity_id = o.id or a.customer_id = o.customer_id)
            and a.type <> 'NOTE' and a.occurred_at > o.stage_entered_at and ${weakSummarySql("a.summary")}
          order by a.occurred_at desc, a.created_at desc
          limit 1
        ) latest on true
        where o.tenant_id = ${tenantId} and o.deleted_at is null
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.stage_entered_at < ${now}::timestamptz - case o.stage
            when 'DISCOVERY' then interval '7 days'
            else interval '14 days'
          end
      )
      select sf.id, sf.owner_user_id as "userId"
      from stage_facts sf
      where ${now}::timestamptz > sf.latest_progress_at + (sf.sla_days::text || ' days')::interval
        and not exists (
          select 1 from sales_insights si
          where si.tenant_id = ${tenantId} and si.opportunity_id = sf.id
            and si.code = 'STAGE_STALLED' and si.refresh_failed_at is null
            and si.evidence = jsonb_build_array(jsonb_build_object(
              'stage', sf.stage,
              'stageEnteredAt', ${isoUtcSql("sf.stage_entered_at")},
              'latestProgressAt', ${isoUtcSql("sf.latest_progress_at")},
              'slaDays', sf.sla_days))
        )
      order by sf.latest_progress_at, sf.id
      limit 500`);

    const candidates = [
      ...taskCandidates.rows.map((row) => ({ type: row.type, id: row.id, userId: row.userId })),
      ...stageCandidates.rows.map((row) => ({ type: "opportunity" as const, id: row.id, userId: row.userId })),
    ];
    return [...new Map(candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate])).values()].slice(0, 1000);
  });
}

export async function scanSalesInsightsService(now = new Date()): Promise<InsightScanResult> {
  const startedAt = Date.now();
  const tenantIds = await listActiveTenantIdsWithoutTenant();
  let candidates = 0;
  let succeeded = 0;
  let failed = 0;
  let tenantFailures = 0;

  for (const tenantId of tenantIds) {
    let tenantCandidates: ScanCandidate[];
    try {
      tenantCandidates = await scanTenantCandidates(tenantId, now);
    } catch (error) {
      tenantFailures += 1;
      console.error("sales insight candidate scan failed", {
        tenantId,
        error: error instanceof Error ? error.message : "unknown",
        cause: error instanceof Error && "cause" in error ? error.cause : undefined,
      });
      continue;
    }
    candidates += tenantCandidates.length;
    for (const subject of tenantCandidates) {
      const systemContext: TenantContext = { tenantId, userId: subject.userId, role: "ADMIN" };
      if (await refreshInsightsSafely(systemContext, { type: subject.type, id: subject.id }, now)) succeeded += 1;
      else failed += 1;
    }
  }

  return { tenantsScanned: tenantIds.length, candidates, succeeded, failed, tenantFailures, elapsedMs: Date.now() - startedAt };
}

export async function refreshCustomerOpportunityInsightsSafely(ctx: TenantContext, customerId: string): Promise<void> {
  const opportunities = await withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ id: string; ownerId: string }>(sql`select id, owner_user_id as "ownerId"
      from opportunities where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}
        and deleted_at is null and stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
        and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})
      order by updated_at desc, id desc limit 51`);
    return result.rows;
  });
  if (opportunities.length > 50) {
    console.warn("customer insight refresh limited to 50 active opportunities", { tenantId: ctx.tenantId, customerId });
  }
  for (const opportunity of opportunities.slice(0, 50)) {
    await refreshInsightsSafely(
      { tenantId: ctx.tenantId, userId: opportunity.ownerId, role: ctx.role },
      { type: "opportunity", id: opportunity.id },
    );
  }
}

export async function getSalesInsightsService(ctx: TenantContext, subject: Subject): Promise<InsightListItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    await readFacts(tx, ctx, subject);
    const rows = await tx.execute<InsightRow>(sql`select id, code, severity, status, title, summary, suggested_action as "suggestedAction", suggested_due_at::text as "suggestedDueAt", evidence, source_type as "sourceType", source_version as "sourceVersion", accepted_task_id as "acceptedTaskId", refresh_failed_at::text as "refreshFailedAt", created_at::text as "createdAt", updated_at::text as "updatedAt"
      from sales_insights where tenant_id = ${ctx.tenantId} and ${subjectPredicate(subject)} and status = 'OPEN'
      order by case severity when 'HIGH_RISK' then 0 when 'ATTENTION' then 1 else 2 end, suggested_due_at nulls last, created_at desc`);
    return rows.rows;
  });
}

async function lockInsight(tx: TenantTransaction, ctx: TenantContext, insightId: string) {
  const result = await tx.execute<{ id: string; lead_id: string | null; opportunity_id: string | null; status: string }>(sql`select id, lead_id, opportunity_id, status from sales_insights where tenant_id = ${ctx.tenantId} and id = ${insightId} for update`);
  const row = result.rows[0];
  if (!row) throw new BusinessError("NOT_FOUND", "建议不存在");
  if (row.status !== "OPEN") throw new BusinessError("CONFLICT", "建议已被处理");
  return row;
}

async function assertSubjectOwner(tx: TenantTransaction, ctx: TenantContext, subject: Subject): Promise<{ ownerId: string | null }> {
  const result = subject.type === "lead"
    ? await tx.execute<{ ownerId: string | null }>(sql`select owner_user_id as "ownerId" from leads where tenant_id = ${ctx.tenantId} and id = ${subject.id} and deleted_at is null for update`)
    : await tx.execute<{ ownerId: string }>(sql`select owner_user_id as "ownerId" from opportunities where tenant_id = ${ctx.tenantId} and id = ${subject.id} and deleted_at is null for update`);
  const row = result.rows[0];
  if (!row) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  if (ctx.role === "SALES" && (!row.ownerId || row.ownerId !== ctx.userId)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  return { ownerId: row.ownerId };
}

export async function acceptSalesInsightService(ctx: TenantContext, insightId: string, dueAt: Date) {
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime()) || dueAt <= new Date()) {
    throw new BusinessError("VALIDATION_ERROR", "建议时间必须在未来", "dueAt");
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const insight = await lockInsight(tx, ctx, insightId);
    const subject: Subject = insight.lead_id ? { type: "lead", id: insight.lead_id } : { type: "opportunity", id: insight.opportunity_id! };
    const { ownerId } = await assertSubjectOwner(tx, ctx, subject);
    if (!ownerId) throw new BusinessError("INVALID_TRANSITION", "未分配负责人，不能接受建议");
    const column = subjectColumn(subject);
    const openTask = await tx.execute<{ id: string }>(sql`select id from tasks where tenant_id = ${ctx.tenantId} and ${sql.raw(column)} = ${subject.id} and status = 'OPEN' for update`);
    let taskId = openTask.rows[0]?.id;
    if (taskId) {
      await tx.execute(sql`update tasks set type = 'FOLLOW_UP', due_at = ${dueAt}, assignee_user_id = ${ownerId}, updated_at = now() where id = ${taskId}`);
    } else {
      const inserted = await tx.execute<{ id: string }>(sql`insert into tasks (tenant_id, ${sql.raw(column)}, assignee_user_id, type, due_at) values (${ctx.tenantId}, ${subject.id}, ${ownerId}, 'FOLLOW_UP', ${dueAt}) returning id`);
      taskId = inserted.rows[0].id;
    }
    await tx.execute(sql`update sales_insights set status = 'ACCEPTED', accepted_task_id = ${taskId}, updated_at = now() where id = ${insightId} and status = 'OPEN'`);
    await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail) values (${ctx.tenantId}, ${ctx.userId}, 'insight.accept', 'sales_insight', ${insightId}, ${JSON.stringify({ taskId, dueAt: dueAt.toISOString() })}::jsonb)`);
    return { insightId, taskId };
  });
}

export async function dismissSalesInsightService(ctx: TenantContext, insightId: string, reason: InsightDismissReason) {
  if (!dismissReasons.has(reason)) {
    throw new BusinessError("VALIDATION_ERROR", "无效的忽略原因", "reason");
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const insight = await lockInsight(tx, ctx, insightId);
    const subject: Subject = insight.lead_id ? { type: "lead", id: insight.lead_id } : { type: "opportunity", id: insight.opportunity_id! };
    await assertSubjectOwner(tx, ctx, subject);
    await tx.execute(sql`update sales_insights set status = 'DISMISSED', dismiss_reason = ${reason}, updated_at = now() where id = ${insightId} and status = 'OPEN'`);
    await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail) values (${ctx.tenantId}, ${ctx.userId}, 'insight.dismiss', 'sales_insight', ${insightId}, ${JSON.stringify({ reason })}::jsonb)`);
    return { insightId };
  });
}
