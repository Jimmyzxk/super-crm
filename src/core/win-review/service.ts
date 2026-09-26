import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { withSessionAdvisoryLock } from "@/plugin-kit/server";
import type { WinReview, WinReviewStatus } from "./types";

const ACTIVITY_WINDOW_LIMIT = 500;
const STAGE_WINDOW_LIMIT = 50;
const GENERATION_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const effectiveOutcomes = new Set(["CONNECTED", "INTERESTED"]);

type FactOpportunity = {
  id: string;
  owner_id: string;
  created_at: string;
  actual_amount: string | null;
  actual_close_at: string | null;
  demand_note: string | null;
  customer_industry: string | null;
  customer_region: string | null;
  customer_size: string | null;
  won_at: string;
};
type StageFact = { id: string; from_stage: string | null; to_stage: string; note: string | null; created_at: string };
type ActivityFact = { id: string; type: string; outcome: string | null; summary: string; occurred_at: string };

function canSee(ctx: TenantContext, ownerId: string) {
  return ctx.role !== "SALES" || ctx.userId === ownerId;
}

function roundHours(start: string, end: string): number {
  return Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100;
}

function isEffective(activity: ActivityFact): boolean {
  return activity.type !== "NOTE" && activity.outcome !== null && effectiveOutcomes.has(activity.outcome);
}

async function assertVisibleWonOpportunity(tx: TenantTransaction, ctx: TenantContext, opportunityId: string): Promise<FactOpportunity> {
  const result = await tx.execute<FactOpportunity>(sql`
    select o.id, o.owner_user_id as owner_id, o.created_at::text, o.actual_amount::text, o.actual_close_at::text,
      o.demand_note, c.industry as customer_industry, c.region as customer_region, c.size::text as customer_size,
      (select h.created_at::text from opportunity_stage_history h
        where h.tenant_id = o.tenant_id and h.opportunity_id = o.id and h.to_stage = 'WON'
        order by h.created_at desc limit 1) as won_at
    from opportunities o
    join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
    where o.tenant_id = ${ctx.tenantId} and o.id = ${opportunityId} and o.deleted_at is null and o.stage = 'WON'
  `);
  const opportunity = result.rows[0];
  if (!opportunity || !canSee(ctx, opportunity.owner_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  if (!opportunity.won_at) throw new BusinessError("CONFLICT", "赢单时间线不完整，暂不能生成复盘");
  return opportunity;
}

async function ensureDraft(ctx: TenantContext, opportunityId: string): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    await assertVisibleWonOpportunity(tx, ctx, opportunityId);
    await tx.execute(sql`insert into win_reviews (tenant_id, opportunity_id)
      values (${ctx.tenantId}, ${opportunityId}) on conflict (tenant_id, opportunity_id) do nothing`);
  });
}

function buildReview(opportunity: FactOpportunity, history: StageFact[], activityRows: ActivityFact[], stagesTruncated: boolean, activitiesTruncated: boolean) {
  const activities = activityRows.filter((activity) => new Date(activity.occurred_at) <= new Date(opportunity.won_at));
  const effective = activities.filter(isEffective);
  const dataGaps: string[] = [];
  if (history.length === 0 || history[0].from_stage !== null) dataGaps.push("缺少商机创建阶段记录，部分阶段停留时间无法确认。");
  if (!history.some((entry) => entry.to_stage === "WON")) dataGaps.push("缺少赢单阶段记录，使用当前赢单时间生成复盘。");
  if (effective.length === 0) dataGaps.push("未记录可作为有效响应的商机跟进，无法计算首次有效响应和跟进间隔。");
  if (!opportunity.demand_note?.trim()) dataGaps.push("未记录结构化需求说明，无法判断成交需求特征。");
  if (!opportunity.customer_industry && !opportunity.customer_region && !opportunity.customer_size) dataGaps.push("未记录客户行业、地区或规模，无法判断适用客户特征。");
  const wonEntry = history.find((entry) => entry.to_stage === "WON");
  if (!wonEntry?.note?.trim()) dataGaps.push("赢单时未记录原因，只能复盘过程指标，不能归因成功原因。");
  if (stagesTruncated) dataGaps.push(`阶段记录超过 ${STAGE_WINDOW_LIMIT} 条，仅使用最近窗口，阶段停留时间可能不完整。`);
  if (activitiesTruncated) dataGaps.push(`商机跟进超过 ${ACTIVITY_WINDOW_LIMIT} 条，仅使用事实窗口，跟进指标可能不完整。`);

  const stageDurations = history.flatMap((entry, index) => {
    if (entry.to_stage === "WON" || entry.to_stage === "LOST") return [];
    const next = history[index + 1]?.created_at ?? opportunity.won_at;
    return [{ stage: entry.to_stage, startedAt: entry.created_at, endedAt: next, hours: roundHours(entry.created_at, next) }];
  });
  const stageFollowUps = history.filter((entry) => entry.from_stage !== null).map((entry) => {
    const latest = effective.filter((activity) => new Date(activity.occurred_at) <= new Date(entry.created_at)).at(-1) ?? null;
    return {
      stage: entry.to_stage,
      transitionedAt: entry.created_at,
      activity: latest && { id: latest.id, type: latest.type, outcome: latest.outcome, occurredAt: latest.occurred_at },
    };
  });
  if (stageFollowUps.some((entry) => entry.activity === null)) dataGaps.push("至少一次阶段转换前没有可核验的有效跟进记录。");
  const averageIntervalHours = effective.length < 2 ? null : Math.round((effective.slice(1).reduce((total, activity, index) => total + roundHours(effective[index].occurred_at, activity.occurred_at), 0) / (effective.length - 1)) * 100) / 100;
  const metrics = {
    createdToWonHours: roundHours(opportunity.created_at, opportunity.won_at),
    stageDurations,
    firstEffectiveResponseHours: effective[0] ? roundHours(opportunity.created_at, effective[0].occurred_at) : null,
    effectiveFollowUpCount: effective.length,
    averageEffectiveFollowUpIntervalHours: averageIntervalHours,
    recentEffectiveFollowUpBeforeStage: stageFollowUps,
    actualAmount: opportunity.actual_amount,
    actualCloseAt: opportunity.actual_close_at,
    customerProfile: {
      industry: opportunity.customer_industry,
      region: opportunity.customer_region,
      size: opportunity.customer_size,
    },
  };
  const evidence = [
    { kind: "OPPORTUNITY", id: opportunity.id, createdAt: opportunity.created_at, wonAt: opportunity.won_at, actualAmount: opportunity.actual_amount, actualCloseAt: opportunity.actual_close_at, demandNote: opportunity.demand_note },
    ...history.map((entry) => ({ kind: "STAGE", id: entry.id, fromStage: entry.from_stage, toStage: entry.to_stage, occurredAt: entry.created_at, note: entry.note })),
    ...effective.map((activity) => ({ kind: "ACTIVITY", id: activity.id, type: activity.type, outcome: activity.outcome, occurredAt: activity.occurred_at, summary: activity.summary })),
  ];
  const summary = `该赢单样本从创建到赢单共 ${metrics.createdToWonHours} 小时，记录 ${effective.length} 次有效跟进，实际成交金额为 ${opportunity.actual_amount ?? "未填写"} 分。以上仅陈述已记录事实，不推断赢单原因。`;
  return { summary, metrics, evidence, dataGaps };
}

async function hydrateDraft(ctx: TenantContext, opportunityId: string): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    const opportunity = await assertVisibleWonOpportunity(tx, ctx, opportunityId);
    const [historyResult, activitiesResult] = await Promise.all([
      tx.execute<StageFact>(sql`select id, from_stage, to_stage, note, created_at::text from (
        select id, from_stage, to_stage, note, created_at from opportunity_stage_history
        where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId}
        order by created_at desc, id desc limit ${STAGE_WINDOW_LIMIT + 1}
      ) recent_history order by created_at asc, id asc`),
      tx.execute<ActivityFact>(sql`select id, type, outcome, summary, occurred_at::text from activities
        where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId}
          and occurred_at >= ${opportunity.created_at}::timestamptz and occurred_at <= ${opportunity.won_at}::timestamptz
        order by occurred_at asc, created_at asc, id asc limit ${ACTIVITY_WINDOW_LIMIT + 1}`),
    ]);
    const facts = buildReview(opportunity, historyResult.rows.slice(0, STAGE_WINDOW_LIMIT), activitiesResult.rows.slice(0, ACTIVITY_WINDOW_LIMIT), historyResult.rows.length > STAGE_WINDOW_LIMIT, activitiesResult.rows.length > ACTIVITY_WINDOW_LIMIT);
    await tx.execute(sql`update win_reviews set summary = ${facts.summary}, metrics = ${JSON.stringify(facts.metrics)}::jsonb,
      evidence = ${JSON.stringify(facts.evidence)}::jsonb, data_gaps = ${JSON.stringify(facts.dataGaps)}::jsonb,
      generation_failed_at = null, generation_attempts = generation_attempts + 1, updated_at = now()
      where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId} and status = 'DRAFT'`);
  });
}

async function recordGenerationFailure(ctx: TenantContext, opportunityId: string, error: unknown): Promise<void> {
  const detail = { reason: error instanceof Error ? error.message.slice(0, 300) : "unknown" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await tx.execute(sql`update win_reviews set generation_failed_at = now(), generation_attempts = generation_attempts + 1, updated_at = now()
        where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId} and status = 'DRAFT'`);
      await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
        values (${ctx.tenantId}, ${ctx.userId}, 'win_review.generate_failed', 'opportunity', ${opportunityId}, ${JSON.stringify(detail)}::jsonb)`);
    });
  } catch (recordError) {
    console.error("win review failure could not be recorded", { tenantId: ctx.tenantId, opportunityId, error: recordError });
  }
}

export async function generateWinReviewSafely(ctx: TenantContext, opportunityId: string): Promise<void> {
  try {
    await ensureDraft(ctx, opportunityId);
    await hydrateDraft(ctx, opportunityId);
  } catch (error) {
    await recordGenerationFailure(ctx, opportunityId, error);
    console.error("win review generation failed", { tenantId: ctx.tenantId, opportunityId, error });
  }
}

async function readWinReview(ctx: TenantContext, opportunityId: string): Promise<WinReview | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx.execute<WinReview>(sql`select wr.id, wr.opportunity_id as "opportunityId", wr.status, wr.summary, wr.metrics, wr.evidence, wr.data_gaps as "dataGaps",
      wr.generation_failed_at::text as "generationFailedAt", wr.generation_attempts as "generationAttempts", reviewer.name as "reviewedByName",
      wr.review_reason as "reviewReason", wr.reviewed_at::text as "reviewedAt", wr.created_at::text as "createdAt", wr.updated_at::text as "updatedAt"
      from win_reviews wr join opportunities o on o.tenant_id = wr.tenant_id and o.id = wr.opportunity_id
      left join users reviewer on reviewer.tenant_id = wr.tenant_id and reviewer.id = wr.reviewed_by_user_id
      where wr.tenant_id = ${ctx.tenantId} and wr.opportunity_id = ${opportunityId} and o.deleted_at is null
        and (${ctx.role} <> 'SALES' or o.owner_user_id = ${ctx.userId})`);
    return rows.rows[0] ?? null;
  });
}

export async function getWinReviewService(ctx: TenantContext, opportunityId: string): Promise<WinReview | null> {
  await withTenant(ctx.tenantId, async (tx) => assertVisibleWonOpportunity(tx, ctx, opportunityId));
  const existing = await readWinReview(ctx, opportunityId);
  const retryDue = existing?.generationFailedAt
    ? Date.now() - new Date(existing.generationFailedAt).getTime() >= GENERATION_RETRY_COOLDOWN_MS
    : true;
  const needGenerate = !existing || (existing.status === "DRAFT" && !existing.summary && retryDue);
  if (needGenerate) {
    // 初次生成路径加 advisory lock 防并发生成（参考 insight 的 withSessionAdvisoryLock 用法）
    await withSessionAdvisoryLock(`win_review:${ctx.tenantId}:${opportunityId}`, async () => {
      const latest = await readWinReview(ctx, opportunityId);
      const latestRetryDue = latest?.generationFailedAt
        ? Date.now() - new Date(latest.generationFailedAt).getTime() >= GENERATION_RETRY_COOLDOWN_MS
        : true;
      const stillNeed = !latest || (latest.status === "DRAFT" && !latest.summary && latestRetryDue);
      if (stillNeed) await generateWinReviewSafely(ctx, opportunityId);
    });
  }
  return readWinReview(ctx, opportunityId);
}

export async function reviewWinReviewService(ctx: TenantContext, input: { winReviewId: string; status: Extract<WinReviewStatus, "REVIEWED" | "REJECTED">; reason: string }) {
  if (ctx.role !== "MANAGER" && ctx.role !== "ADMIN") throw new BusinessError("FORBIDDEN", "只有主管或管理员可以审核赢单复盘");
  const reason = input.reason.trim();
  if (!reason) throw new BusinessError("VALIDATION_ERROR", "请填写审核理由", "reason");
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const found = await tx.execute<{ id: string; status: WinReviewStatus; summary: string; evidence_count: number; generation_failed_at: string | null }>(sql`select id, status, summary,
      jsonb_array_length(evidence)::integer as evidence_count, generation_failed_at::text
      from win_reviews
      where tenant_id = ${ctx.tenantId} and id = ${input.winReviewId} for update`);
    const review = found.rows[0];
    if (!review) throw new BusinessError("NOT_FOUND", "赢单复盘不存在");
    if (review.status !== "DRAFT") throw new BusinessError("CONFLICT", "复盘已完成审核，不能原地覆盖");
    if (review.generation_failed_at || !review.summary.trim() || review.evidence_count === 0) {
      throw new BusinessError("CONFLICT", "复盘尚未生成完成，暂不能审核");
    }
    const updated = await tx.execute(sql`update win_reviews set status = ${input.status}::win_review_status,
      reviewed_by_user_id = ${ctx.userId}, review_reason = ${reason}, reviewed_at = now(), updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${input.winReviewId} and status = 'DRAFT'
        and generation_failed_at is null and char_length(btrim(summary)) > 0 and jsonb_array_length(evidence) > 0`);
    if (updated.rowCount !== 1) throw new BusinessError("CONFLICT", "复盘已被他人审核，请刷新后重试");
    await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
      values (${ctx.tenantId}, ${ctx.userId}, 'win_review.review', 'win_review', ${input.winReviewId}, ${JSON.stringify({ status: input.status, reason })}::jsonb)`);

    return { winReviewId: input.winReviewId, status: input.status };
  });

  // 触发提炼在事务提交之后：事务内 fire-and-forget 会立刻开新连接读库
  // （读到的可能还是未提交状态，外层回滚时学习库还会残留无效记录），
  // 且嵌套占连接。失败只记日志，不影响审核主流程。
  if (input.status === "REVIEWED") {
    void import("@/core/ai-hub/service")
      .then(({ extractLearningFromWinReviewService }) =>
        extractLearningFromWinReviewService(ctx, input.winReviewId),
      )
      .catch((err) => {
        console.error("AI agent failed to extract learning from win review", err);
      });
  }

  return result;
}

