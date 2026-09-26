import { and, eq, inArray, sql } from "drizzle-orm";
import { winReviews } from "@/db/schema";
import type { TenantContext, TenantTransaction } from "@/core/tenant";

import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import {
  customerSizeValues,
  playbookTargetStageValues,
  type CreateSalesPlaybookDraftInput,
  type CustomerSize,
  type PlaybookTargetStage,
  type PublishSalesPlaybookInput,
  type ReviewedWinSample,
  type SalesPlaybook,
  type SalesPlaybookFeedback,
  type SalesPlaybookRecommendation,
  type SubmitPlaybookFeedbackInput,
} from "./types";

const contentKeys = ["checkpoints", "recommendedCadence", "effectiveActions", "commonRisks"] as const;
const allowedCustomerSizes = new Set<string>(customerSizeValues);
const allowedStages = new Set<string>(playbookTargetStageValues);

type PlaybookRow = {
  id: string;
  familyKey: string;
  version: number;
  status: SalesPlaybook["status"];
  name: string;
  targetStage: PlaybookTargetStage;
  applicableIndustries: string[];
  excludedIndustries: string[];
  applicableRegions: string[];
  excludedRegions: string[];
  applicableCustomerSizes: CustomerSize[];
  excludedCustomerSizes: CustomerSize[];
  checkpoints: string[];
  recommendedCadence: string[];
  effectiveActions: string[];
  commonRisks: string[];
  claimEvidence: SalesPlaybook["claimEvidence"];
  sampleIds: string[];
  createdByName: string | null;
  publishedByName: string | null;
  publishReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewRow = {
  id: string;
  opportunityId: string;
  opportunityName: string;
  customerName: string;
  customerIndustry: string | null;
  customerRegion: string | null;
  customerSize: CustomerSize | null;
  summary: string;
  metrics: Record<string, unknown>;
  reviewedAt: string;
};

function requireManager(ctx: TenantContext): void {
  if (ctx.role !== "MANAGER" && ctx.role !== "ADMIN") {
    throw new BusinessError("FORBIDDEN", "只有主管或管理员可以管理团队打法");
  }
}



function mapPlaybook(row: PlaybookRow): SalesPlaybook {
  return {
    id: row.id,
    familyKey: row.familyKey,
    version: row.version,
    status: row.status,
    name: row.name,
    targetStage: row.targetStage,
    applicableIndustries: row.applicableIndustries ?? [],
    excludedIndustries: row.excludedIndustries ?? [],
    applicableRegions: row.applicableRegions ?? [],
    excludedRegions: row.excludedRegions ?? [],
    applicableCustomerSizes: row.applicableCustomerSizes ?? [],
    excludedCustomerSizes: row.excludedCustomerSizes ?? [],
    checkpoints: row.checkpoints ?? [],
    recommendedCadence: row.recommendedCadence ?? [],
    effectiveActions: row.effectiveActions ?? [],
    commonRisks: row.commonRisks ?? [],
    claimEvidence: row.claimEvidence,
    sampleIds: row.sampleIds ?? [],
    createdByName: row.createdByName,
    publishedByName: row.publishedByName,
    publishReason: row.publishReason,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function readPlaybook(tx: TenantTransaction, tenantId: string, playbookId: string): Promise<SalesPlaybook | null> {
  const result = await tx.execute<PlaybookRow>(sql`
    select p.id, p.family_key as "familyKey", p.version, p.status, p.name, p.target_stage as "targetStage",
      p.applicable_industries as "applicableIndustries", p.excluded_industries as "excludedIndustries",
      p.applicable_regions as "applicableRegions", p.excluded_regions as "excludedRegions",
      p.applicable_customer_sizes as "applicableCustomerSizes", p.excluded_customer_sizes as "excludedCustomerSizes",
      p.checkpoints, p.recommended_cadence as "recommendedCadence", p.effective_actions as "effectiveActions",
      p.common_risks as "commonRisks", p.claim_evidence as "claimEvidence",
      coalesce(array_agg(s.win_review_id) filter (where s.win_review_id is not null), '{}') as "sampleIds",
      creator.name as "createdByName", publisher.name as "publishedByName", p.publish_reason as "publishReason",
      p.published_at::text as "publishedAt", p.created_at::text as "createdAt", p.updated_at::text as "updatedAt"
    from sales_playbooks p
    join users creator on creator.tenant_id = p.tenant_id and creator.id = p.created_by_user_id
    left join users publisher on publisher.tenant_id = p.tenant_id and publisher.id = p.published_by_user_id
    left join sales_playbook_samples s on s.tenant_id = p.tenant_id and s.playbook_id = p.id
    where p.tenant_id = ${tenantId} and p.id = ${playbookId}
    group by p.id, creator.name, publisher.name
  `);
  return result.rows[0] ? mapPlaybook(result.rows[0]) : null;
}

async function audit(tx: TenantTransaction, ctx: TenantContext, action: string, subjectId: string, detail: object = {}) {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, 'sales_playbook', ${subjectId}, ${JSON.stringify(detail)}::jsonb)`);
}

export async function listSalesPlaybooksService(ctx: TenantContext): Promise<SalesPlaybook[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<PlaybookRow>(sql`
      select p.id, p.family_key as "familyKey", p.version, p.status, p.name, p.target_stage as "targetStage",
        p.applicable_industries as "applicableIndustries", p.excluded_industries as "excludedIndustries",
        p.applicable_regions as "applicableRegions", p.excluded_regions as "excludedRegions",
        p.applicable_customer_sizes as "applicableCustomerSizes", p.excluded_customer_sizes as "excludedCustomerSizes",
        p.checkpoints, p.recommended_cadence as "recommendedCadence", p.effective_actions as "effectiveActions",
        p.common_risks as "commonRisks", p.claim_evidence as "claimEvidence",
        coalesce(array_agg(s.win_review_id) filter (where s.win_review_id is not null), '{}') as "sampleIds",
        creator.name as "createdByName", publisher.name as "publishedByName", p.publish_reason as "publishReason",
        p.published_at::text as "publishedAt", p.created_at::text as "createdAt", p.updated_at::text as "updatedAt"
      from sales_playbooks p
      join users creator on creator.tenant_id = p.tenant_id and creator.id = p.created_by_user_id
      left join users publisher on publisher.tenant_id = p.tenant_id and publisher.id = p.published_by_user_id
      left join sales_playbook_samples s on s.tenant_id = p.tenant_id and s.playbook_id = p.id
      where p.tenant_id = ${ctx.tenantId} and (${ctx.role} <> 'SALES' or p.status = 'PUBLISHED')
      group by p.id, creator.name, publisher.name
      order by p.family_key, p.version desc, p.id desc
      limit 200
    `);
    return result.rows.map(mapPlaybook);
  });
}

export async function listReviewedWinSamplesService(ctx: TenantContext): Promise<ReviewedWinSample[]> {
  requireManager(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<ReviewRow>(sql`
      select wr.id, wr.opportunity_id as "opportunityId", o.name as "opportunityName", c.name as "customerName",
        c.industry as "customerIndustry", c.region as "customerRegion", c.size::text as "customerSize",
        wr.summary, wr.metrics, wr.reviewed_at::text as "reviewedAt"
      from win_reviews wr
      join opportunities o on o.tenant_id = wr.tenant_id and o.id = wr.opportunity_id and o.deleted_at is null
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
      where wr.tenant_id = ${ctx.tenantId} and wr.status = 'REVIEWED'
      order by wr.reviewed_at desc, wr.id desc
      limit 100
    `);
    return result.rows;
  });
}

function validateEvidenceReferences(input: CreateSalesPlaybookDraftInput): void {
  const sampleIds = new Set(input.sampleIds);
  for (const key of contentKeys) {
    const references = input.claimEvidence[key];
    if (references.length === 0 || references.some((id) => !sampleIds.has(id))) {
      throw new BusinessError("VALIDATION_ERROR", "固定内容必须引用当前打法的赢单样本", `claimEvidence.${key}`);
    }
  }
}

export async function createSalesPlaybookDraftService(ctx: TenantContext, input: CreateSalesPlaybookDraftInput): Promise<SalesPlaybook> {
  requireManager(ctx);
  validateEvidenceReferences(input);
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:${input.familyKey}`}))`);
    const versionResult = await tx.execute<{ nextVersion: number }>(sql`
      select coalesce(max(version), 0) + 1 as "nextVersion"
      from sales_playbooks where tenant_id = ${ctx.tenantId} and family_key = ${input.familyKey}
    `);
    const version = Number(versionResult.rows[0]?.nextVersion ?? 1);
    const samples = await tx
      .select({ id: winReviews.id })
      .from(winReviews)
      .where(and(eq(winReviews.tenantId, ctx.tenantId), inArray(winReviews.id, input.sampleIds)));

    if (samples.length !== input.sampleIds.length) throw new BusinessError("NOT_FOUND", "部分赢单复盘样本不存在或不属于当前租户");

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into sales_playbooks (
        tenant_id, family_key, version, name, target_stage, applicable_industries, excluded_industries,
        applicable_regions, excluded_regions, applicable_customer_sizes, excluded_customer_sizes,
        checkpoints, recommended_cadence, effective_actions, common_risks, claim_evidence, created_by_user_id
      ) values (
        ${ctx.tenantId}, ${input.familyKey}, ${version}, ${input.name}, ${input.targetStage}::opportunity_stage,
        ${JSON.stringify(input.applicableIndustries)}::jsonb, ${JSON.stringify(input.excludedIndustries)}::jsonb,
        ${JSON.stringify(input.applicableRegions)}::jsonb, ${JSON.stringify(input.excludedRegions)}::jsonb,
        ${JSON.stringify(input.applicableCustomerSizes)}::jsonb, ${JSON.stringify(input.excludedCustomerSizes)}::jsonb,
        ${JSON.stringify(input.checkpoints)}::jsonb, ${JSON.stringify(input.recommendedCadence)}::jsonb,
        ${JSON.stringify(input.effectiveActions)}::jsonb, ${JSON.stringify(input.commonRisks)}::jsonb,
        ${JSON.stringify(input.claimEvidence)}::jsonb, ${ctx.userId}
      ) returning id
    `);
    const playbookId = inserted.rows[0].id;
    for (const sampleId of input.sampleIds) {
      await tx.execute(sql`insert into sales_playbook_samples (tenant_id, playbook_id, win_review_id)
        values (${ctx.tenantId}, ${playbookId}, ${sampleId})`);
    }
    await audit(tx, ctx, "sales_playbook.create_draft", playbookId, { familyKey: input.familyKey, version });
    const playbook = await readPlaybook(tx, ctx.tenantId, playbookId);
    if (!playbook) throw new BusinessError("INTERNAL_ERROR", "打法创建后读取失败");
    return playbook;
  });
}

export async function publishSalesPlaybookService(ctx: TenantContext, input: PublishSalesPlaybookInput): Promise<SalesPlaybook> {
  requireManager(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    const found = await tx.execute<{ id: string; familyKey: string; status: SalesPlaybook["status"]; targetStage: string; claimEvidence: SalesPlaybook["claimEvidence"]; checkpoints: string[]; recommendedCadence: string[]; effectiveActions: string[]; commonRisks: string[] }>(sql`
      select id, family_key as "familyKey", status, target_stage as "targetStage", claim_evidence as "claimEvidence", checkpoints,
        recommended_cadence as "recommendedCadence", effective_actions as "effectiveActions", common_risks as "commonRisks"
      from sales_playbooks where tenant_id = ${ctx.tenantId} and id = ${input.playbookId} for update
    `);
    const playbook = found.rows[0];
    if (!playbook) throw new BusinessError("NOT_FOUND", "打法不存在");
    if (playbook.status !== "DRAFT") throw new BusinessError("CONFLICT", "已发布或已退役的打法不能原地覆盖");
    if (!allowedStages.has(playbook.targetStage)) throw new BusinessError("VALIDATION_ERROR", "目标阶段不支持推荐");
    const samples = await tx.execute<{ winReviewId: string; status: string }>(sql`
      select s.win_review_id as "winReviewId", wr.status
      from sales_playbook_samples s
      join win_reviews wr on wr.tenant_id = s.tenant_id and wr.id = s.win_review_id
      where s.tenant_id = ${ctx.tenantId} and s.playbook_id = ${input.playbookId}
      for update of wr
    `);
    const sampleIds = samples.rows.map((row) => row.winReviewId);
    if (new Set(sampleIds).size < 3) throw new BusinessError("CONFLICT", "发布打法至少需要 3 个不同的赢单复盘样本");
    if (samples.rows.some((row) => row.status !== "REVIEWED")) throw new BusinessError("CONFLICT", "所有打法样本必须已被主管确认");
    const evidence = playbook.claimEvidence;
    const allowedSampleIds = new Set(sampleIds);
    for (const key of contentKeys) {
      const references = evidence?.[key];
      if (!Array.isArray(references) || references.length === 0 || references.some((id) => !allowedSampleIds.has(id))) {
        throw new BusinessError("CONFLICT", "打法固定内容缺少可追溯的赢单样本证据", `claimEvidence.${key}`);
      }
    }
    if (![playbook.checkpoints, playbook.recommendedCadence, playbook.effectiveActions, playbook.commonRisks].every((items) => Array.isArray(items) && items.length > 0)) {
      throw new BusinessError("CONFLICT", "打法固定内容不能为空");
    }
    const updated = await tx.execute(sql`update sales_playbooks set status = 'PUBLISHED', published_by_user_id = ${ctx.userId},
      publish_reason = ${input.reason.trim()}, published_at = now(), updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${input.playbookId} and status = 'DRAFT'`);
    if (updated.rowCount !== 1) throw new BusinessError("CONFLICT", "打法已被其他人发布，请刷新后重试");
    // 同 family_key 其他 PUBLISHED 置 RETIRED
    await tx.execute(sql`update sales_playbooks set status = 'RETIRED', updated_at = now()
      where tenant_id = ${ctx.tenantId} and family_key = ${playbook.familyKey} and id <> ${input.playbookId} and status = 'PUBLISHED'`);
    await audit(tx, ctx, "sales_playbook.publish", input.playbookId, { reason: input.reason.trim(), sampleIds });
    const result = await readPlaybook(tx, ctx.tenantId, input.playbookId);
    if (!result) throw new BusinessError("INTERNAL_ERROR", "打法发布后读取失败");
    return result;
  });
}

export async function getRecommendedPlaybookService(ctx: TenantContext, opportunityId: string): Promise<SalesPlaybookRecommendation | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const opportunityResult = await tx.execute<{ ownerId: string; stage: string; industry: string | null; region: string | null; size: CustomerSize | null }>(sql`
      select o.owner_user_id as "ownerId", o.stage, c.industry, c.region, c.size::text as size
      from opportunities o join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = ${ctx.tenantId} and o.id = ${opportunityId} and o.deleted_at is null
    `);
    const opportunity = opportunityResult.rows[0];
    if (!opportunity || (ctx.role === "SALES" && opportunity.ownerId !== ctx.userId)) throw new BusinessError("NOT_FOUND", "商机不存在或无权查看");
    if (!allowedStages.has(opportunity.stage)) return null;
    if (opportunity.size !== null && !allowedCustomerSizes.has(opportunity.size)) throw new BusinessError("INTERNAL_ERROR", "客户规模数据不符合固定枚举");
    const result = await tx.execute<PlaybookRow & { score: number }>(sql`
      select p.id, p.family_key as "familyKey", p.version, p.status, p.name, p.target_stage as "targetStage",
        p.applicable_industries as "applicableIndustries", p.excluded_industries as "excludedIndustries",
        p.applicable_regions as "applicableRegions", p.excluded_regions as "excludedRegions",
        p.applicable_customer_sizes as "applicableCustomerSizes", p.excluded_customer_sizes as "excludedCustomerSizes",
        p.checkpoints, p.recommended_cadence as "recommendedCadence", p.effective_actions as "effectiveActions",
        p.common_risks as "commonRisks", p.claim_evidence as "claimEvidence",
        coalesce(array_agg(s.win_review_id) filter (where s.win_review_id is not null), '{}') as "sampleIds",
        creator.name as "createdByName", publisher.name as "publishedByName", p.publish_reason as "publishReason",
        p.published_at::text as "publishedAt", p.created_at::text as "createdAt", p.updated_at::text as "updatedAt",
        ((case when jsonb_array_length(p.applicable_industries) = 0 then 0 when ${opportunity.industry}::text is not null and p.applicable_industries @> jsonb_build_array(${opportunity.industry}::text) then 1 else 0 end)
        + (case when jsonb_array_length(p.applicable_regions) = 0 then 0 when ${opportunity.region}::text is not null and p.applicable_regions @> jsonb_build_array(${opportunity.region}::text) then 1 else 0 end)
        + (case when jsonb_array_length(p.applicable_customer_sizes) = 0 then 0 when ${opportunity.size}::text is not null and p.applicable_customer_sizes @> jsonb_build_array(${opportunity.size}::text) then 1 else 0 end))::int as score
      from sales_playbooks p
      join users creator on creator.tenant_id = p.tenant_id and creator.id = p.created_by_user_id
      left join users publisher on publisher.tenant_id = p.tenant_id and publisher.id = p.published_by_user_id
      left join sales_playbook_samples s on s.tenant_id = p.tenant_id and s.playbook_id = p.id
      where p.tenant_id = ${ctx.tenantId} and p.status = 'PUBLISHED' and p.target_stage = ${opportunity.stage}::opportunity_stage
        and (jsonb_array_length(p.applicable_industries) = 0 or (${opportunity.industry}::text is not null and p.applicable_industries @> jsonb_build_array(${opportunity.industry}::text)))
        and (jsonb_array_length(p.applicable_regions) = 0 or (${opportunity.region}::text is not null and p.applicable_regions @> jsonb_build_array(${opportunity.region}::text)))
        and (jsonb_array_length(p.applicable_customer_sizes) = 0 or (${opportunity.size}::text is not null and p.applicable_customer_sizes @> jsonb_build_array(${opportunity.size}::text)))
        and not (${opportunity.industry}::text is not null and p.excluded_industries @> jsonb_build_array(${opportunity.industry}::text))
        and not (${opportunity.region}::text is not null and p.excluded_regions @> jsonb_build_array(${opportunity.region}::text))
        and not (${opportunity.size}::text is not null and p.excluded_customer_sizes @> jsonb_build_array(${opportunity.size}::text))
      group by p.id, creator.name, publisher.name
      order by score desc, p.published_at desc, p.id desc
      limit 1
    `);
    const row = result.rows[0];
    if (!row) return null;
    const feedbackResult = await tx.execute<SalesPlaybookFeedback>(sql`
      select verdict, reason, updated_at::text as "updatedAt"
      from sales_playbook_feedback
      where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId}
        and playbook_id = ${row.id} and user_id = ${ctx.userId}
      limit 1
    `);
    return {
      playbook: mapPlaybook(row),
      score: Number(row.score),
      currentUserFeedback: feedbackResult.rows[0] ?? null,
    };
  });
}

export async function submitPlaybookFeedbackService(ctx: TenantContext, input: SubmitPlaybookFeedbackInput): Promise<SalesPlaybookFeedback> {
  if ((input.verdict === "NOT_HELPFUL" || input.verdict === "NOT_APPLICABLE") && !input.reason?.trim()) {
    throw new BusinessError("VALIDATION_ERROR", "此反馈需要填写原因", "reason");
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const opportunityResult = await tx.execute<{ ownerId: string; stage: string; industry: string | null; region: string | null; size: CustomerSize | null }>(sql`
      select o.owner_user_id as "ownerId", o.stage, c.industry, c.region, c.size::text as size
      from opportunities o join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = ${ctx.tenantId} and o.id = ${input.opportunityId} and o.deleted_at is null`);
    const opportunity = opportunityResult.rows[0];
    if (!opportunity || (ctx.role === "SALES" && opportunity.ownerId !== ctx.userId)) throw new BusinessError("NOT_FOUND", "商机不存在或无权查看");
    const playbookResult = await tx.execute<{ familyKey: string; version: number }>(sql`select family_key as "familyKey", version
      from sales_playbooks where tenant_id = ${ctx.tenantId} and id = ${input.playbookId} and status = 'PUBLISHED'
        and (jsonb_array_length(applicable_industries) = 0 or (${opportunity.industry}::text is not null and applicable_industries @> jsonb_build_array(${opportunity.industry}::text)))
        and (jsonb_array_length(applicable_regions) = 0 or (${opportunity.region}::text is not null and applicable_regions @> jsonb_build_array(${opportunity.region}::text)))
        and (jsonb_array_length(applicable_customer_sizes) = 0 or (${opportunity.size}::text is not null and applicable_customer_sizes @> jsonb_build_array(${opportunity.size}::text)))
        and not (${opportunity.industry}::text is not null and excluded_industries @> jsonb_build_array(${opportunity.industry}::text))
        and not (${opportunity.region}::text is not null and excluded_regions @> jsonb_build_array(${opportunity.region}::text))
        and not (${opportunity.size}::text is not null and excluded_customer_sizes @> jsonb_build_array(${opportunity.size}::text))`);
    const playbook = playbookResult.rows[0];
    if (!playbook) throw new BusinessError("NOT_FOUND", "已发布打法不存在");
    const result = await tx.execute<SalesPlaybookFeedback & { id: string }>(sql`
      insert into sales_playbook_feedback (tenant_id, opportunity_id, playbook_id, playbook_family_key, playbook_version, user_id, verdict, reason)
      values (${ctx.tenantId}, ${input.opportunityId}, ${input.playbookId}, ${playbook.familyKey}, ${playbook.version}, ${ctx.userId}, ${input.verdict}::sales_playbook_feedback_verdict, ${input.reason?.trim() || null})
      on conflict (tenant_id, opportunity_id, playbook_id, user_id) do update set verdict = excluded.verdict, reason = excluded.reason, updated_at = now()
      returning id, verdict, reason, updated_at::text as "updatedAt"
    `);
    await audit(tx, ctx, "sales_playbook.feedback", input.playbookId, { opportunityId: input.opportunityId, verdict: input.verdict });
    const feedback = result.rows[0];
    if (!feedback) throw new BusinessError("INTERNAL_ERROR", "反馈保存后读取失败");
    return feedback;
  });
}
