import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import type {
  ActiveOpportunityStage,
  AdminWorkbench,
  ManagerWorkbench,
  OwnerOpenTaskLoad,
  OpportunityStageDistribution,
  SalesWorkItem,
} from "./types";

export const WORKBENCH_COUNT_CEILING = 1000;

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

export async function listSalesWorkItemsService(ctx: TenantContext, limit?: number): Promise<SalesWorkItem[]> {
  if (ctx.role !== "SALES") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");

  const total = normalizeLimit(limit);
  return withTenant(ctx.tenantId, async (tx) => {
    const clockResult = await tx.execute<{ todayEnd: string }>(sql`
      select ((date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') + interval '1 day')::text as "todayEnd"
    `);
    const clock = clockResult.rows[0];
    if (!clock) throw new Error("销售工作台数据库时钟读取失败");
    const todayEndMs = Date.parse(clock.todayEnd);
    if (!Number.isFinite(todayEndMs)) throw new Error("销售工作台数据库时钟格式无效");
    const result = await tx.execute<SalesWorkItem>(sql`
      with selected_candidates as materialized (
        select candidate.id, candidate.tenant_id, candidate.lead_id, candidate.customer_id,
          candidate.opportunity_id, candidate.assignee_user_id, candidate.type, candidate.due_at
        from (
          select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
            t.assignee_user_id, t.type, t.due_at, l.score
          from tasks t
          join leads l on l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
          where t.tenant_id = ${ctx.tenantId} and t.assignee_user_id = ${ctx.userId}
            and t.status = 'OPEN' and t.lead_id is not null

          union all

          select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
            t.assignee_user_id, t.type, t.due_at, null::integer as score
          from tasks t
          join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
          where t.tenant_id = ${ctx.tenantId} and t.assignee_user_id = ${ctx.userId}
            and t.status = 'OPEN' and t.customer_id is not null

          union all

          select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
            t.assignee_user_id, t.type, t.due_at, null::integer as score
          from tasks t
          join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
          where t.tenant_id = ${ctx.tenantId} and t.assignee_user_id = ${ctx.userId}
            and t.status = 'OPEN' and t.opportunity_id is not null
        ) candidate
        order by
          case
            when candidate.due_at < now() then 0
            when candidate.due_at < (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') + interval '1 day' then 1
            when candidate.lead_id is not null and candidate.score >= 70 then 2
            else 3
          end,
          candidate.score desc nulls last,
          candidate.due_at,
          candidate.id
        limit ${total}
      )
      select
        t.id as "taskId",
        case
          when t.lead_id is not null then 'lead'
          when t.customer_id is not null then 'customer'
          else 'opportunity'
        end as "subjectType",
        coalesce(t.lead_id, t.customer_id, t.opportunity_id)::text as "subjectId",
        coalesce(l.contact_name, c.name, o.name) as "subjectName",
        case
          when t.lead_id is not null then coalesce(l.company_name, '未填写公司')
          when t.customer_id is not null then coalesce(c.industry, c.region, '未填写客户信息')
          else coalesce(c_for_opportunity.name, '客户已删除')
        end as "subjectContext",
        coalesce(l_owner.name, c_owner.name, o_owner.name, assignee.name) as "ownerName",
        t.type::text as "taskType",
        t.due_at::text as "dueAt",
        (t.due_at < now()) as "isOverdue",
        l.score,
        l.score_reason as "scoreReason",
        o.stage::text as stage,
        coalesce(t.customer_id, o.customer_id, l.customer_id)::text as "customerId"
      from selected_candidates t
      left join leads l
        on l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
      left join customers c
        on c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
      left join opportunities o
        on o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
      left join customers c_for_opportunity
        on c_for_opportunity.tenant_id = t.tenant_id and c_for_opportunity.id = o.customer_id and c_for_opportunity.deleted_at is null
      left join users l_owner
        on l_owner.tenant_id = t.tenant_id and l_owner.id = l.owner_user_id
      left join users c_owner
        on c_owner.tenant_id = t.tenant_id and c_owner.id = c.owner_user_id
      left join users o_owner
        on o_owner.tenant_id = t.tenant_id and o_owner.id = o.owner_user_id
      join users assignee
        on assignee.tenant_id = t.tenant_id and assignee.id = t.assignee_user_id
    `);
    const priority = (item: SalesWorkItem): number => {
      if (item.isOverdue) return 0;
      if (Date.parse(item.dueAt) < todayEndMs) return 1;
      if (item.subjectType === "lead" && (item.score ?? -1) >= 70) return 2;
      return 3;
    };
    // Detail joins may reorder the bounded page, so reapply the queue order to at most 50 rows.
    return result.rows.sort((left, right) => {
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference !== 0) return priorityDifference;
      const scoreDifference = (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY);
      if (scoreDifference !== 0) return scoreDifference;
      const dueDifference = Date.parse(left.dueAt) - Date.parse(right.dueAt);
      if (dueDifference !== 0) return dueDifference;
      return left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0;
    });
  });
}

function requireRole(ctx: TenantContext, role: TenantContext["role"]): void {
  if (ctx.role !== role) throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
}

export async function getManagerWorkbenchService(ctx: TenantContext): Promise<ManagerWorkbench> {
  requireRole(ctx, "MANAGER");

  return withTenant(ctx.tenantId, async (tx) => {
    const [countsResult, stagesResult, ownerLoadResult] = await Promise.all([
      tx.execute<{
        unassignedLeads: number;
        overdueLeads: number;
        stalledOpportunities: number;
      }>(sql`
        select
          (select count(*)::int from (
            select l.id from leads l
            where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null and l.owner_user_id is null
            limit ${WORKBENCH_COUNT_CEILING + 1}
          ) bounded) as "unassignedLeads",
          (select count(*)::int from (
            select l.id from leads l
            where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null
              and exists (
                select 1 from tasks t
                where t.tenant_id = l.tenant_id and t.lead_id = l.id and t.status = 'OPEN' and t.due_at < now()
              )
            limit ${WORKBENCH_COUNT_CEILING + 1}
          ) bounded) as "overdueLeads",
          (select count(*)::int from (
            select o.id from opportunities o
            where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and o.stage not in ('WON', 'LOST')
              and exists (
                select 1 from tasks t
                where t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN' and t.due_at < now()
              )
            limit ${WORKBENCH_COUNT_CEILING + 1}
          ) bounded) as "stalledOpportunities"
      `),
      tx.execute<OpportunityStageDistribution>(sql`
        select stages.stage,
          (select count(*)::int from (
            select o.id from opportunities o
            where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and o.stage = stages.stage
            limit ${WORKBENCH_COUNT_CEILING + 1}
          ) bounded) as count
        from (values
          ('DISCOVERY'::opportunity_stage),
          ('PROPOSAL'::opportunity_stage),
          ('NEGOTIATION'::opportunity_stage)
        ) as stages(stage)
        order by case stages.stage
          when 'DISCOVERY' then 1
          when 'PROPOSAL' then 2
          when 'NEGOTIATION' then 3
        end
      `),
      tx.execute<OwnerOpenTaskLoad>(sql`
        select u.id as "userId", u.name as "userName", load.open_task_count as "openTaskCount"
        from users u
        cross join lateral (
          select count(*)::int as open_task_count from (
            select t.id from tasks t
            where t.tenant_id = u.tenant_id and t.assignee_user_id = u.id and t.status = 'OPEN'
              and (
                (t.lead_id is not null and exists (
                  select 1 from leads l where l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
                ))
                or (t.customer_id is not null and exists (
                  select 1 from customers c where c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
                ))
                or (t.opportunity_id is not null and exists (
                  select 1 from opportunities o where o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
                ))
              )
            limit ${WORKBENCH_COUNT_CEILING + 1}
          ) bounded
        ) load
        where u.tenant_id = ${ctx.tenantId}
          and u.status = 'ACTIVE'
          and u.role in ('SALES', 'MANAGER')
        order by load.open_task_count desc, u.name asc, u.id asc
      `),
    ]);

    const counts = countsResult.rows[0];
    return {
      unassignedLeads: counts?.unassignedLeads ?? 0,
      overdueLeads: counts?.overdueLeads ?? 0,
      stalledOpportunities: counts?.stalledOpportunities ?? 0,
      activeOpportunityStages: stagesResult.rows.map((row) => ({
        ...row,
        stage: row.stage as ActiveOpportunityStage,
      })),
      ownerLoad: ownerLoadResult.rows,
      countCeiling: WORKBENCH_COUNT_CEILING,
    };
  });
}

export async function getAdminWorkbenchService(ctx: TenantContext): Promise<AdminWorkbench> {
  requireRole(ctx, "ADMIN");

  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{
      enabledSourceKeys: number;
      totalSourceKeys: number;
      enabledScoreRules: number;
      totalScoreRules: number;
      duplicateLeads: number;
      unassignedLeads: number;
      insightRefreshFailures: number;
    }>(sql`
      select
        (select count(*)::int from (select k.id from lead_source_keys k where k.tenant_id = ${ctx.tenantId} and k.revoked_at is null limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "enabledSourceKeys",
        (select count(*)::int from (select k.id from lead_source_keys k where k.tenant_id = ${ctx.tenantId} limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "totalSourceKeys",
        (select count(*)::int from (select r.id from score_rules r where r.tenant_id = ${ctx.tenantId} and r.deleted_at is null and r.enabled limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "enabledScoreRules",
        (select count(*)::int from (select r.id from score_rules r where r.tenant_id = ${ctx.tenantId} and r.deleted_at is null limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "totalScoreRules",
        (select count(*)::int from (select l.id from leads l where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null and l.is_possible_duplicate limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "duplicateLeads",
        (select count(*)::int from (select l.id from leads l where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null and l.owner_user_id is null limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "unassignedLeads",
        (select count(*)::int from (select si.id from sales_insights si where si.tenant_id = ${ctx.tenantId} and si.refresh_failed_at is not null limit ${WORKBENCH_COUNT_CEILING + 1}) bounded) as "insightRefreshFailures"
    `);
    const counts = result.rows[0];
    return {
      sourceKeys: { enabled: counts?.enabledSourceKeys ?? 0, total: counts?.totalSourceKeys ?? 0 },
      scoreRules: { enabled: counts?.enabledScoreRules ?? 0, total: counts?.totalScoreRules ?? 0 },
      duplicateLeads: counts?.duplicateLeads ?? 0,
      unassignedLeads: counts?.unassignedLeads ?? 0,
      insightRefreshFailures: counts?.insightRefreshFailures ?? 0,
      countCeiling: WORKBENCH_COUNT_CEILING,
    };
  });
}
