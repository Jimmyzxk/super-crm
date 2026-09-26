import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { recordLeadStatus } from "@/core/leads/service";
import { refreshCustomerOpportunityInsightsSafely, refreshInsightsSafely } from "@/core/insight/service";
import { scoreLeadSafely } from "@/core/scoring/service";
import { autoCreateScheduleFromFollowup } from "@/core/schedule/service";

const opportunityStageSlaDays: Record<string, number> = {
  DISCOVERY: 7,
  PROPOSAL: 14,
  NEGOTIATION: 14,
};

async function restoreStagePushTask(
  tx: TenantTransaction,
  tenantId: string,
  opportunityId: string,
  ownerId: string,
  stage: string,
) {
  const days = opportunityStageSlaDays[stage];
  if (!days) return;
  await tx.execute(sql`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
    select ${tenantId}, o.id, ${ownerId}, 'STAGE_PUSH', o.stage_entered_at + (${days}::text || ' days')::interval
    from opportunities o where o.tenant_id = ${tenantId} and o.id = ${opportunityId}
      and o.stage = ${stage}::opportunity_stage`);
}

export async function logActivityService(ctx: TenantContext, input: {
  leadId?: string; customerId?: string; opportunityId?: string; type: string; outcome?: string; summary: string; occurredAt?: Date; nextFollowUpAt?: Date;
}) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const subjectCount = [input.leadId, input.customerId, input.opportunityId].filter(Boolean).length;
    if (subjectCount !== 1) throw new BusinessError("VALIDATION_ERROR", "跟进必须关联一个对象");
    let ownerId: string | null = null;
    let collabAuthorized = false;
    let leadStatus: string | null = null;
    let opportunityStage: string | null = null;
    let opportunityCustomerId: string | null = null;
    let opportunityOpenTask: { id: string; type: string; customerId: string | null } | null = null;
    let sharedCustomerTaskCompleted = false;
    if (input.leadId) {
      const found = await tx.execute<{ owner_user_id: string | null; status: string }>(sql`select owner_user_id, status from leads where id = ${input.leadId} and deleted_at is null for update`);
      const lead = found.rows[0];
      if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
      ownerId = lead.owner_user_id; leadStatus = lead.status;
      if (lead.status === "CONVERTED" || lead.status === "DISCARDED") throw new BusinessError("INVALID_TRANSITION", "当前状态不允许此操作");
    } else if (input.customerId) {
      const found = await tx.execute<{ owner_user_id: string }>(sql`select owner_user_id from customers where id = ${input.customerId} and deleted_at is null for update`);
      ownerId = found.rows[0]?.owner_user_id ?? null;
      // 协同跟进：开关开启且本人持有该客户商机（任意阶段）的协作销售
      // 可记录客户级跟进——否则"看得见客户却记不了跟进"，协同半生效
      if (ctx.role === "SALES" && ownerId && ownerId !== ctx.userId) {
        const collab = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
          select allow_multi_sales_followup from public.customer_collaboration_settings
          where tenant_id = ${ctx.tenantId} limit 1`);
        if (collab.rows[0]?.allow_multi_sales_followup) {
          const ownOpp = await tx.execute<{ id: string }>(sql`
            select id from public.opportunities
            where tenant_id = ${ctx.tenantId} and customer_id = ${input.customerId}
              and owner_user_id = ${ctx.userId} and deleted_at is null
            limit 1`);
          if (ownOpp.rows.length > 0) {
            // 协同授权：持有该客户商机，绕过下方 owner 相等校验
            collabAuthorized = true;
          }
        }
      }
    } else if (input.opportunityId) {
      const found = await tx.execute<{ owner_user_id: string; customer_id: string; stage: string }>(sql`select owner_user_id, customer_id, stage from opportunities where id = ${input.opportunityId} and deleted_at is null for update`);
      const opportunity = found.rows[0];
      if (opportunity?.stage === "WON" || opportunity?.stage === "LOST") {
        throw new BusinessError("INVALID_TRANSITION", "终态商机不能记录跟进");
      }
      ownerId = opportunity?.owner_user_id ?? null;
      opportunityCustomerId = opportunity?.customer_id ?? null;
      opportunityStage = opportunity?.stage ?? null;
      if (opportunity) {
        const openTask = await tx.execute<{ id: string; type: string; customerId: string | null }>(sql`select id, type, customer_id as "customerId"
          from tasks where tenant_id = ${ctx.tenantId} and status = 'OPEN' and (
            opportunity_id = ${input.opportunityId} or customer_id = ${opportunity.customer_id}
          )
          order by (type = 'FOLLOW_UP') desc, (opportunity_id is not null) desc, due_at, id
          limit 1 for update`);
        opportunityOpenTask = openTask.rows[0] ?? null;
      }
    }
    if (!ownerId || (ctx.role === "SALES" && ownerId !== ctx.userId && !collabAuthorized)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    const subjectColumn = input.leadId ? sql`lead_id` : input.customerId ? sql`customer_id` : sql`opportunity_id`;
    const subjectId = input.leadId ?? input.customerId ?? input.opportunityId;
    const occurredAt = input.occurredAt ?? new Date();
    const activity = await tx.execute<{ id: string }>(sql`insert into activities
      (tenant_id, ${subjectColumn}, user_id, type, outcome, summary, occurred_at)
      values (${ctx.tenantId}, ${subjectId}, ${ctx.userId}, ${input.type}::activity_type,
        ${input.type === "NOTE" ? null : input.outcome ?? null}::activity_outcome, ${input.summary}, ${occurredAt}) returning id`);
    if (input.customerId) {
      await tx.execute(sql`update customers set last_activity_at = greatest(coalesce(last_activity_at, ${occurredAt}), ${occurredAt}), updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${input.customerId}`);
    } else if (input.opportunityId) {
      await tx.execute(sql`update customers set last_activity_at = greatest(coalesce(last_activity_at, ${occurredAt}), ${occurredAt}), updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = (select customer_id from opportunities where tenant_id = ${ctx.tenantId} and id = ${input.opportunityId})`);
    }
    if (input.leadId && leadStatus === "NEW") {
      await tx.execute(sql`update leads set status = 'CONTACTED', updated_at = now() where id = ${input.leadId}`);
      await recordLeadStatus(tx, ctx, input.leadId, "NEW", "CONTACTED", "完成首次跟进");
    }
    if (input.opportunityId && opportunityStage) {
      if (input.nextFollowUpAt) {
        const completed = await tx.execute<{ customerId: string | null }>(sql`update tasks set status = 'DONE', completed_at = now(), updated_at = now()
          where tenant_id = ${ctx.tenantId} and status = 'OPEN'
            and (opportunity_id = ${subjectId} or customer_id = ${opportunityCustomerId})
          returning customer_id as "customerId"`);
        sharedCustomerTaskCompleted = completed.rows.some((task) => task.customerId !== null);
        await tx.execute(sql`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
          values (${ctx.tenantId}, ${subjectId}, ${ownerId}, 'FOLLOW_UP', ${input.nextFollowUpAt})`);
      } else if (opportunityOpenTask?.type === "FOLLOW_UP") {
        await tx.execute(sql`update tasks set status = 'DONE', completed_at = now(), updated_at = now()
          where id = ${opportunityOpenTask.id} and status = 'OPEN'`);
        sharedCustomerTaskCompleted = opportunityOpenTask.customerId !== null;
        await restoreStagePushTask(tx, ctx.tenantId, subjectId!, ownerId, opportunityStage);
      } else if (!opportunityOpenTask) {
        await restoreStagePushTask(tx, ctx.tenantId, subjectId!, ownerId, opportunityStage);
      }
    } else {
      await tx.execute(sql`update tasks set status = 'DONE', completed_at = now(), updated_at = now()
        where ${subjectColumn} = ${subjectId} and status = 'OPEN'`);
      if (input.nextFollowUpAt) await tx.execute(sql`insert into tasks
        (tenant_id, ${subjectColumn}, assignee_user_id, type, due_at) values
        (${ctx.tenantId}, ${subjectId}, ${ownerId}, 'FOLLOW_UP', ${input.nextFollowUpAt})`);
    }

    if (input.nextFollowUpAt) {
      const scheduleTypeMap: Record<string, "CALL" | "MEETING" | "VISIT" | "FOLLOW_UP"> = {
        CALL: "CALL",
        MEETING: "MEETING",
        VISIT: "VISIT",
      };
      const schedType = scheduleTypeMap[input.type] || "FOLLOW_UP";
      await autoCreateScheduleFromFollowup(tx, ctx.tenantId, ownerId || ctx.userId, {
        title: `跟进安排: ${input.summary.slice(0, 40)}`,
        scheduleType: schedType,
        leadId: input.leadId,
        customerId: input.customerId || opportunityCustomerId,
        opportunityId: input.opportunityId,
        startAt: input.nextFollowUpAt,
        note: input.summary,
      }).catch(() => {});
    }

    await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
      values (${ctx.tenantId}, ${ctx.userId}, 'activity.create', ${input.leadId ? 'lead' : input.customerId ? 'customer' : 'opportunity'}, ${subjectId},
        ${JSON.stringify({ activityId: activity.rows[0].id })}::jsonb)`);
    return {
      activityId: activity.rows[0].id,
      customerIdToRefresh: sharedCustomerTaskCompleted ? opportunityCustomerId : null,
    };
  });
  if (input.leadId) {
    await scoreLeadSafely(ctx, input.leadId);
    await refreshInsightsSafely(ctx, { type: "lead", id: input.leadId });
  }
  if (input.customerId) await refreshCustomerOpportunityInsightsSafely(ctx, input.customerId);
  if (input.opportunityId) {
    if (result.customerIdToRefresh) await refreshCustomerOpportunityInsightsSafely(ctx, result.customerIdToRefresh);
    else await refreshInsightsSafely(ctx, { type: "opportunity", id: input.opportunityId });
  }
  return { activityId: result.activityId };
}

export async function rescheduleTaskService(ctx: TenantContext, taskId: string, dueAt: Date) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const task = await tx.execute<{ lead_id: string | null; customer_id: string | null; opportunity_id: string | null; assignee_user_id: string; due_at: string }>(sql`
      select lead_id, customer_id, opportunity_id, assignee_user_id, due_at::text from tasks where id = ${taskId} and status = 'OPEN' for update`);
    const row = task.rows[0];
    if (!row || (ctx.role === "SALES" && row.assignee_user_id !== ctx.userId)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    await tx.execute(sql`update tasks set due_at = ${dueAt}, updated_at = now() where id = ${taskId}`);
    await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
      values (${ctx.tenantId}, ${ctx.userId}, 'task.reschedule', 'task', ${taskId},
        ${JSON.stringify({ from: row.due_at, to: dueAt.toISOString() })}::jsonb)`);
    return { result: { taskId }, subject: { leadId: row.lead_id, customerId: row.customer_id, opportunityId: row.opportunity_id } };
  });
  if (result.subject.leadId) await refreshInsightsSafely(ctx, { type: "lead", id: result.subject.leadId });
  if (result.subject.customerId) await refreshCustomerOpportunityInsightsSafely(ctx, result.subject.customerId);
  if (result.subject.opportunityId) await refreshInsightsSafely(ctx, { type: "opportunity", id: result.subject.opportunityId });
  return result.result;
}

export async function createSimulationTaskService(
  ctx: TenantContext,
  input: {
    title: string;
    dueDays?: number;
    opportunityId?: string;
    leadId?: string;
    customerId?: string;
    note?: string;
  },
): Promise<{ id: string; success: boolean }> {
  return withTenant(ctx.tenantId, async (tx) => {
    let opportunityId = input.opportunityId;
    let leadId = input.leadId;
    let customerId = input.customerId;

    if (!opportunityId && !leadId && !customerId) {
      const oppRes = await tx.execute<{ id: string }>(sql`
        select id from opportunities
        where tenant_id = ${ctx.tenantId}::uuid and deleted_at is null
          and stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
        order by (owner_user_id = ${ctx.userId}::uuid) desc, updated_at desc
        limit 1
      `);
      if (oppRes.rows[0]) {
        opportunityId = oppRes.rows[0].id;
      } else {
        const custRes = await tx.execute<{ id: string }>(sql`
          select id from customers
          where tenant_id = ${ctx.tenantId}::uuid and deleted_at is null
          order by (owner_user_id = ${ctx.userId}::uuid) desc, updated_at desc
          limit 1
        `);
        if (custRes.rows[0]) {
          customerId = custRes.rows[0].id;
        } else {
          const leadRes = await tx.execute<{ id: string }>(sql`
            select id from leads
            where tenant_id = ${ctx.tenantId}::uuid and deleted_at is null and status <> 'DISCARDED'
            order by (owner_user_id = ${ctx.userId}::uuid) desc, updated_at desc
            limit 1
          `);
          if (leadRes.rows[0]) {
            leadId = leadRes.rows[0].id;
          }
        }
      }
    }

    if (!opportunityId && !leadId && !customerId) {
      throw new BusinessError("VALIDATION_ERROR", "生成任务失败：当前系统暂无线索、客户或商机可供关联，请先创建业务主体");
    }

    const days = input.dueDays ?? 1;
    if (opportunityId) {
      const existing = await tx.execute<{ id: string }>(sql`
        select id from tasks
        where tenant_id = ${ctx.tenantId}::uuid and opportunity_id = ${opportunityId}::uuid and status = 'OPEN'
        limit 1 for update
      `);
      if (existing.rows[0]) {
        await tx.execute(sql`
          update tasks set
            assignee_user_id = ${ctx.userId}::uuid,
            type = 'FOLLOW_UP',
            due_at = now() + (${days}::text || ' days')::interval,
            title = ${input.title},
            note = ${input.note ?? null},
            updated_at = now()
          where id = ${existing.rows[0].id}::uuid
        `);
        return { id: existing.rows[0].id, success: true };
      }
    }
    const res = await tx.execute<{ id: string }>(sql`
      insert into tasks (
        tenant_id,
        opportunity_id,
        lead_id,
        customer_id,
        assignee_user_id,
        type,
        title,
        note,
        due_at
      ) values (
        ${ctx.tenantId}::uuid,
        ${opportunityId ? sql`${opportunityId}::uuid` : null},
        ${leadId ? sql`${leadId}::uuid` : null},
        ${customerId ? sql`${customerId}::uuid` : null},
        ${ctx.userId}::uuid,
        'FOLLOW_UP',
        ${input.title},
        ${input.note ?? null},
        now() + (${days}::text || ' days')::interval
      )
      returning id
    `);
    return { id: res.rows[0].id, success: true };
  });
}
