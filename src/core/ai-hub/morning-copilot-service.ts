import { sql } from "drizzle-orm";
import { TenantContext, withTenant } from "@/core/tenant";
import type { TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";

export interface MorningRecommendationItem {
  id: string;
  title: string;
  reason: string;
  suggestedAction: {
    type: "CREATE_FOLLOW_UP" | "CREATE_TASK" | "VIEW_DETAIL";
    payload: {
      opportunityId?: string;
      customerId?: string;
      leadId?: string;
      targetName?: string;
      defaultNote?: string;
    };
    priority: "HIGH" | "MEDIUM" | "LOW";
  };
  confidenceScore: number;
  isApplied: boolean;
  feedbackVerdict: "HELPFUL" | "NOT_HELPFUL" | "NOT_APPLICABLE" | null;
  createdAt: string;
}

export interface AdoptionStats {
  days: number;
  totalGenerated: number;
  appliedCount: number;
  dismissedCount: number;
  pendingCount: number;
  adoptionRate: number; // 0 - 100 percentage
}

export async function getTodayMorningRecommendationsService(
  ctx: TenantContext,
  userId: string,
): Promise<MorningRecommendationItem[]> {
  // SALES 角色只能查看属于本人的推荐
  if (ctx.role === "SALES" && ctx.userId !== userId) {
    throw new BusinessError("FORBIDDEN", "无权查看其他销售的晨会建议");
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      title: string;
      content: string;
      suggested_action: {
        type: "CREATE_FOLLOW_UP" | "CREATE_TASK" | "VIEW_DETAIL";
        payload: {
          opportunityId?: string;
          customerId?: string;
          leadId?: string;
          targetName?: string;
          defaultNote?: string;
        };
        priority: "HIGH" | "MEDIUM" | "LOW";
      } | null;
      confidence_score: string | number;
      is_applied: boolean;
      feedback_verdict: "HELPFUL" | "NOT_HELPFUL" | "NOT_APPLICABLE" | null;
      created_at: string;
    }>(sql`
      select
        id,
        title,
        content,
        suggested_action,
        confidence_score,
        is_applied,
        feedback_verdict,
        created_at::text as created_at
      from ai_recommendations
      where tenant_id = ${ctx.tenantId}::uuid
        and user_id = ${userId}::uuid
        and recommendation_type = 'MORNING_COPILOT'
      order by created_at desc
      limit 3
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.content,
      suggestedAction: r.suggested_action || {
        type: "VIEW_DETAIL",
        payload: {},
        priority: "MEDIUM",
      },
      confidenceScore: Number(r.confidence_score),
      isApplied: r.is_applied,
      feedbackVerdict: r.feedback_verdict,
      createdAt: r.created_at,
    }));
  });
}

async function recordMorningRecommendationAudit(
  tx: TenantTransaction,
  ctx: TenantContext,
  action: string,
  recommendationId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, ${action}, 'ai_recommendation', ${recommendationId}::uuid, ${JSON.stringify(detail)}::jsonb)
  `);
}

export async function applyMorningRecommendationService(
  ctx: TenantContext,
  recommendationId: string,
  actionNote?: string,
): Promise<{ success: boolean }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const recRes = await tx.execute<{
      id: string;
      user_id: string;
      title: string;
      content: string;
      suggested_action: Record<string, unknown> | null;
    }>(sql`
      select id, user_id::text as "user_id", title, content, suggested_action
      from ai_recommendations
      where tenant_id = ${ctx.tenantId}::uuid
        and id = ${recommendationId}::uuid
    `);

    const rec = recRes.rows[0];
    if (!rec) {
      throw new BusinessError("NOT_FOUND", "晨会建议不存在或已被删除");
    }

    if (ctx.role === "SALES" && rec.user_id !== ctx.userId) {
      throw new BusinessError("FORBIDDEN", "无权操作其他销售的晨会建议");
    }

    await tx.execute(sql`
      update ai_recommendations
      set
        is_applied = true,
        feedback_verdict = 'HELPFUL',
        updated_at = now()
      where tenant_id = ${ctx.tenantId}::uuid
        and id = ${recommendationId}::uuid
    `);
    await recordMorningRecommendationAudit(tx, ctx, "ai_recommendation.applied", recommendationId, {
      actionType: (rec.suggested_action as { type?: string })?.type || "VIEW_DETAIL",
      actionNote: actionNote ?? null,
    });

    // 回流学习飞轮
    const actionType = (rec.suggested_action as { type?: string })?.type || "VIEW_DETAIL";
    await tx.execute(sql`
      insert into ai_agent_learning_logs (
        tenant_id,
        source_type,
        source_id,
        topic,
        extracted_strategy,
        sample_dialogue,
        effectiveness_score,
        is_promoted_to_pool,
        created_at
      ) values (
        ${ctx.tenantId}::uuid,
        'MORNING_COPILOT',
        ${recommendationId}::uuid,
        ${rec.title},
        ${`销售已采纳行动建议 [${actionType}]: ${actionNote || rec.title}`},
        ${rec.content},
        95.00,
        true,
        now()
      )
    `);

    return { success: true };
  });
}

export async function dismissMorningRecommendationService(
  ctx: TenantContext,
  recommendationId: string,
  reason?: string,
): Promise<{ success: boolean }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const recRes = await tx.execute<{
      id: string;
      user_id: string;
      title: string;
      content: string;
    }>(sql`
      select id, user_id::text as "user_id", title, content
      from ai_recommendations
      where tenant_id = ${ctx.tenantId}::uuid
        and id = ${recommendationId}::uuid
    `);

    const rec = recRes.rows[0];
    if (!rec) {
      throw new BusinessError("NOT_FOUND", "晨会建议不存在或已被删除");
    }

    if (ctx.role === "SALES" && rec.user_id !== ctx.userId) {
      throw new BusinessError("FORBIDDEN", "无权操作其他销售的晨会建议");
    }

    await tx.execute(sql`
      update ai_recommendations
      set
        is_applied = false,
        feedback_verdict = 'NOT_APPLICABLE',
        updated_at = now()
      where tenant_id = ${ctx.tenantId}::uuid
        and id = ${recommendationId}::uuid
    `);
    await recordMorningRecommendationAudit(tx, ctx, "ai_recommendation.feedback", recommendationId, {
      verdict: "NOT_APPLICABLE",
      reason: reason ?? null,
    });

    // 回流学习飞轮（记录忽略/不适用）
    await tx.execute(sql`
      insert into ai_agent_learning_logs (
        tenant_id,
        source_type,
        source_id,
        topic,
        extracted_strategy,
        sample_dialogue,
        effectiveness_score,
        is_promoted_to_pool,
        created_at
      ) values (
        ${ctx.tenantId}::uuid,
        'MORNING_COPILOT',
        ${recommendationId}::uuid,
        ${rec.title},
        ${`销售标记不适用/忽略建议: ${reason || "业务暂不需要跟进"}`},
        ${rec.content},
        50.00,
        false,
        now()
      )
    `);

    return { success: true };
  });
}

export async function getAdoptionStatsService(
  ctx: TenantContext,
  days: number = 7,
): Promise<AdoptionStats> {
  const normalizedDays = days === 30 ? 30 : 7;
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{
      totalGenerated: string | number;
      appliedCount: string | number;
      dismissedCount: string | number;
    }>(sql`
      select
        count(*)::int as "totalGenerated",
        count(case when is_applied = true then 1 end)::int as "appliedCount",
        count(case when feedback_verdict in ('NOT_APPLICABLE', 'NOT_HELPFUL') then 1 end)::int as "dismissedCount"
      from ai_recommendations
      where tenant_id = ${ctx.tenantId}::uuid
        and recommendation_type = 'MORNING_COPILOT'
        and created_at >= now() - (${normalizedDays} || ' days')::interval
    `);

    const total = Number(res.rows[0]?.totalGenerated || 0);
    const applied = Number(res.rows[0]?.appliedCount || 0);
    const dismissed = Number(res.rows[0]?.dismissedCount || 0);
    const pending = Math.max(0, total - applied - dismissed);
    const adoptionRate = total > 0 ? Number(((applied / total) * 100).toFixed(1)) : 0;

    return {
      days: normalizedDays,
      totalGenerated: total,
      appliedCount: applied,
      dismissedCount: dismissed,
      pendingCount: pending,
      adoptionRate,
    };
  });
}

export async function getMyRecentRecommendationsService(
  ctx: TenantContext,
  days: number = 7
): Promise<MorningRecommendationItem[]> {
  const normalizedDays = Math.min(Math.max(days, 1), 30);
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      title: string;
      content: string;
      suggested_action: {
        type: "CREATE_FOLLOW_UP" | "CREATE_TASK" | "VIEW_DETAIL";
        payload: {
          opportunityId?: string;
          customerId?: string;
          leadId?: string;
          targetName?: string;
          defaultNote?: string;
        };
        priority: "HIGH" | "MEDIUM" | "LOW";
      } | null;
      confidence_score: string | number;
      is_applied: boolean;
      feedback_verdict: "HELPFUL" | "NOT_HELPFUL" | "NOT_APPLICABLE" | null;
      created_at: string;
    }>(sql`
      select
        id,
        title,
        content,
        suggested_action,
        confidence_score,
        is_applied,
        feedback_verdict,
        created_at::text as created_at
      from ai_recommendations
      where tenant_id = ${ctx.tenantId}::uuid
        and user_id = ${ctx.userId}::uuid
        and recommendation_type = 'MORNING_COPILOT'
        and created_at >= now() - (${normalizedDays} || ' days')::interval
      order by created_at desc
      limit 50
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      title: r.title,
      reason: r.content,
      suggestedAction: r.suggested_action || {
        type: "VIEW_DETAIL",
        payload: {},
        priority: "MEDIUM",
      },
      confidenceScore: Number(r.confidence_score),
      isApplied: r.is_applied,
      feedbackVerdict: r.feedback_verdict,
      createdAt: r.created_at,
    }));
  });
}

