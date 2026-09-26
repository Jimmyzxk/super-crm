import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

type BenchmarkSpec = { name: string; sql: string; params: unknown[] };
type ExplainRow = { "QUERY PLAN": Array<{ Plan: { "Actual Total Time"?: number; "Actual Rows"?: number; "Shared Read Blocks"?: number; "Shared Hit Blocks"?: number } }> };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalCustomerId(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!uuidPattern.test(value)) throw new Error("CAPACITY_CUSTOMER_ID 必须是合法 UUID");
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("BENCHMARK_RUNS 必须是正整数");
  return parsed;
}

function benchmarkMode(value: string | undefined): "cold" | "warm" {
  if (value === undefined || value === "warm") return "warm";
  if (value === "cold") return "cold";
  throw new Error("BENCHMARK_MODE 只能是 cold 或 warm");
}

function assertSafeCapacityDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const database = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_capacity(?:_[a-z0-9_]+)?$/.test(database)) throw new Error("容量基准只允许连接名称以 _capacity 结尾的数据库");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("容量基准只允许连接本机 PostgreSQL");
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function specs(tenantId: string, salesId: string, managerId: string, customerId: string): BenchmarkSpec[] {
  return [
    {
      name: "lead_pool_created",
      params: [tenantId, salesId],
      sql: `select l.id, l.contact_name, l.score, l.created_at
        from leads l
        left join users u on u.tenant_id = l.tenant_id and u.id = l.owner_user_id
        left join tasks t on t.tenant_id = l.tenant_id and t.lead_id = l.id and t.status = 'OPEN'
        where l.tenant_id = $1 and l.deleted_at is null and ($2::uuid is null or l.owner_user_id = $2)
        order by l.created_at desc, l.id desc limit 21`,
    },
    {
      name: "lead_pool_counts",
      params: [tenantId, salesId, 1001],
      sql: `with scoped as not materialized (
          select l.id, l.score, l.is_possible_duplicate, l.owner_user_id
          from leads l
          where l.tenant_id = $1 and l.deleted_at is null and l.owner_user_id = $2
        )
        select
          (select count(*) from (select id from scoped limit $3) bounded) as all_count,
          (select count(*) from (select id from scoped where score >= 70 limit $3) bounded) as high_count,
          (select count(*) from (select id from scoped where is_possible_duplicate limit $3) bounded) as duplicate_count`,
    },
    {
      name: "customer_pool_recent",
      params: [tenantId, salesId],
      sql: `select c.id, c.name, c.last_activity_at,
          (select count(*) from opportunities o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null) as opportunity_count,
          (select min(next_task.due_at) from (
            (select customer_task.due_at
              from tasks customer_task
              where customer_task.tenant_id = c.tenant_id and customer_task.customer_id = c.id and customer_task.status = 'OPEN'
              order by customer_task.due_at
              limit 1)
            union all
            (select opportunity_task.due_at
              from opportunities task_opportunity
              join tasks opportunity_task on opportunity_task.tenant_id = task_opportunity.tenant_id and opportunity_task.opportunity_id = task_opportunity.id
              where task_opportunity.tenant_id = c.tenant_id and task_opportunity.customer_id = c.id
                and task_opportunity.deleted_at is null and opportunity_task.status = 'OPEN'
              order by opportunity_task.due_at
              limit 1)
          ) next_task) as next_task_due_at
        from customers c join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
        where c.tenant_id = $1 and c.deleted_at is null and ($2::uuid is null or c.owner_user_id = $2)
        order by c.last_activity_at desc nulls last, c.id desc limit 51`,
    },
    {
      name: "opportunity_pool_active",
      params: [tenantId, salesId],
      sql: `with candidates as (
          (
            select o.id, o.name, o.stage, o.expected_close_at, o.updated_at, t.due_at, 0 as priority
            from tasks t
            join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
            join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
            join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
            left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
            where t.tenant_id = $1 and t.status = 'OPEN' and t.opportunity_id is not null and t.due_at < now()
              and o.deleted_at is null and o.stage not in ('WON', 'LOST') and o.owner_user_id = $2
            order by o.expected_close_at nulls last, o.updated_at desc, o.id desc limit 51
          )
          union all
          (
            select o.id, o.name, o.stage, o.expected_close_at, o.updated_at, t.due_at, 1 as priority
            from (
              select o.id, o.tenant_id, o.customer_id, o.owner_user_id, o.primary_contact_id, o.name, o.stage,
                o.expected_close_at, o.updated_at
              from opportunities o
              where o.tenant_id = $1 and o.deleted_at is null and o.stage not in ('WON', 'LOST') and o.owner_user_id = $2
                and not exists (
                  select 1 from tasks overdue_task where overdue_task.tenant_id = o.tenant_id and overdue_task.opportunity_id = o.id
                    and overdue_task.status = 'OPEN' and overdue_task.due_at < now()
                )
              order by o.expected_close_at nulls last, o.updated_at desc, o.id desc limit 51
            ) o
            join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
            join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
            left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
            left join tasks t on t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
            order by o.expected_close_at nulls last, o.updated_at desc, o.id desc limit 51
          )
        )
        select id, name, stage, expected_close_at, due_at from candidates
        order by priority, expected_close_at nulls last, updated_at desc, id desc limit 51`,
    },
    {
      name: "sales_workbench",
      params: [tenantId, salesId],
      sql: `with selected_candidates as materialized (
          select candidate.id, candidate.tenant_id, candidate.lead_id, candidate.customer_id,
            candidate.opportunity_id, candidate.assignee_user_id, candidate.type, candidate.due_at
          from (
            select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
              t.assignee_user_id, t.type, t.due_at, l.score
            from tasks t
            join leads l on l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
            where t.tenant_id = $1 and t.assignee_user_id = $2 and t.status = 'OPEN' and t.lead_id is not null

            union all

            select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
              t.assignee_user_id, t.type, t.due_at, null::integer as score
            from tasks t
            join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
            where t.tenant_id = $1 and t.assignee_user_id = $2 and t.status = 'OPEN' and t.customer_id is not null

            union all

            select t.id, t.tenant_id, t.lead_id, t.customer_id, t.opportunity_id,
              t.assignee_user_id, t.type, t.due_at, null::integer as score
            from tasks t
            join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
            where t.tenant_id = $1 and t.assignee_user_id = $2 and t.status = 'OPEN' and t.opportunity_id is not null
          ) candidate
          order by
            case
              when candidate.due_at < now() then 0
              when candidate.due_at < date_trunc('day', now()) + interval '1 day' then 1
              when candidate.lead_id is not null and candidate.score >= 70 then 2
              else 3
            end,
            candidate.score desc nulls last,
            candidate.due_at,
            candidate.id
          limit 20
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
        left join leads l on l.tenant_id = t.tenant_id and l.id = t.lead_id and l.deleted_at is null
        left join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id and c.deleted_at is null
        left join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id and o.deleted_at is null
        left join customers c_for_opportunity
          on c_for_opportunity.tenant_id = t.tenant_id and c_for_opportunity.id = o.customer_id and c_for_opportunity.deleted_at is null
        left join users l_owner
          on l_owner.tenant_id = t.tenant_id and l_owner.id = l.owner_user_id
        left join users c_owner
          on c_owner.tenant_id = t.tenant_id and c_owner.id = c.owner_user_id
        left join users o_owner
          on o_owner.tenant_id = t.tenant_id and o_owner.id = o.owner_user_id
        join users assignee
          on assignee.tenant_id = t.tenant_id and assignee.id = t.assignee_user_id`,
    },
    {
      name: "manager_workbench_counts",
      params: [tenantId, managerId, 1001],
      sql: `select
        $2::uuid as manager_id,
        (select count(*) from (select l.id from leads l where l.tenant_id = $1 and l.deleted_at is null and l.owner_user_id is null limit $3) bounded) as unassigned_leads,
        (select count(*) from (select o.id from opportunities o where o.tenant_id = $1 and o.deleted_at is null and o.stage not in ('WON','LOST') limit $3) bounded) as active_opportunities`,
    },
    {
      name: "customer_detail_summary",
      params: [tenantId, customerId],
      sql: `select c.id, c.name, c.industry, c.region, c.size, u.name as owner_name, c.created_at,
          count(distinct o.id)::int as opportunity_count,
          count(distinct o.id) filter (where o.stage not in ('WON','LOST'))::int as active_opportunity_count,
          count(distinct o.id) filter (where o.stage = 'WON')::int as won_opportunity_count,
          case when count(distinct o.id) filter (where o.stage not in ('WON','LOST')) > 0 then '推进中'
            when count(distinct o.id) filter (where o.stage = 'WON') > 0 then '已成交' else '暂无进行中商机' end as operating_status,
          case max(case o.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 else 0 end)
            when 3 then 'NEGOTIATION' when 2 then 'PROPOSAL' when 1 then 'DISCOVERY' else null end as progressing_stage,
          (select min(next_task.due_at) from (
            (select customer_task.due_at
              from tasks customer_task
              where customer_task.tenant_id = c.tenant_id and customer_task.customer_id = c.id and customer_task.status = 'OPEN'
              order by customer_task.due_at
              limit 1)
            union all
            (select opportunity_task.due_at
              from opportunities task_opportunity
              join tasks opportunity_task on opportunity_task.tenant_id = task_opportunity.tenant_id and opportunity_task.opportunity_id = task_opportunity.id
              where task_opportunity.tenant_id = c.tenant_id and task_opportunity.customer_id = c.id
                and task_opportunity.deleted_at is null and opportunity_task.status = 'OPEN'
              order by opportunity_task.due_at
              limit 1)
          ) next_task) as next_task_due_at,
          (select ct.name from contacts ct where ct.tenant_id = c.tenant_id and ct.customer_id = c.id and ct.deleted_at is null
            order by ct.is_primary desc, ct.created_at limit 1) as primary_contact_name,
          (select ct.phone from contacts ct where ct.tenant_id = c.tenant_id and ct.customer_id = c.id and ct.deleted_at is null
            order by ct.is_primary desc, ct.created_at limit 1) as primary_contact_phone,
          c.last_activity_at as recent_interaction_at
        from customers c
        join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
        left join opportunities o on o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null
        where c.tenant_id = $1 and c.id = $2 and c.deleted_at is null
        group by c.id, u.name
        limit 1`,
    },
    {
      name: "customer_detail_source_leads",
      params: [tenantId, customerId, 101],
      sql: `with conversion_candidates as (
          select l.contact_name, lc.created_at, lc.lead_id, 1 as precedence
          from lead_conversions lc
          join leads l on l.tenant_id = lc.tenant_id and l.id = lc.lead_id
          where lc.tenant_id = $1 and lc.customer_id = $2
          order by lc.created_at, lc.lead_id
          limit $3
        ), legacy_customer_candidates as (
          select l.contact_name, l.created_at, l.id as lead_id, 0 as precedence
          from leads l
          where l.tenant_id = $1 and l.customer_id = $2
            and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
          order by l.created_at, l.id
          limit $3
        ), legacy_customer_origin_candidates as (
          select l.contact_name, l.created_at, l.id as lead_id, 0 as precedence
          from customers legacy_customer
          join leads l on l.tenant_id = legacy_customer.tenant_id and l.id = legacy_customer.from_lead_id
          where legacy_customer.tenant_id = $1 and legacy_customer.id = $2
            and legacy_customer.from_lead_id is not null
            and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
          order by l.created_at, l.id
          limit $3
        ), legacy_opportunity_origin_candidates as (
          select candidate.contact_name, candidate.created_at, candidate.lead_id, 0 as precedence
          from (
            select distinct on (l.id) l.contact_name, l.created_at, l.id as lead_id
            from opportunities legacy_opportunity
            join leads l on l.tenant_id = legacy_opportunity.tenant_id and l.id = legacy_opportunity.from_lead_id
            where legacy_opportunity.tenant_id = $1 and legacy_opportunity.customer_id = $2
              and legacy_opportunity.from_lead_id is not null
              and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
            order by l.id, l.created_at
          ) candidate
          order by candidate.created_at, candidate.lead_id
          limit $3
        ), candidates as (
          select * from conversion_candidates
          union all select * from legacy_customer_candidates
          union all select * from legacy_customer_origin_candidates
          union all select * from legacy_opportunity_origin_candidates
        ), source as (
          select distinct on (candidate.lead_id) candidate.contact_name, candidate.created_at, candidate.lead_id
          from candidates candidate
          order by candidate.lead_id, candidate.precedence desc
        )
        select source.contact_name as name
        from source
        order by source.created_at, source.lead_id
        limit $3`,
    },
    {
      name: "customer_detail_contacts",
      params: [tenantId, customerId, 101],
      sql: `select id, name, phone, email, title, is_primary
        from contacts
        where tenant_id = $1 and customer_id = $2 and deleted_at is null
        order by is_primary desc, created_at, id
        limit $3`,
    },
    {
      name: "customer_detail_opportunities",
      params: [tenantId, customerId, 101],
      sql: `select o.id, o.name, o.stage, o.expected_amount, o.expected_close_at, task.type as open_task_type, task.due_at as open_task_due_at
        from opportunities o
        left join lateral (
          select t.type, t.due_at
          from tasks t
          where t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
          order by t.due_at, t.id
          limit 1
        ) task on true
        where o.tenant_id = $1 and o.customer_id = $2 and o.deleted_at is null
        order by o.created_at desc, o.id desc
        limit $3`,
    },
    {
      name: "customer_detail_customer_tasks",
      params: [tenantId, customerId, 101],
      sql: `select id, type, due_at
        from tasks
        where tenant_id = $1 and customer_id = $2 and status = 'OPEN'
        order by due_at, id
        limit $3`,
    },
    {
      name: "customer_detail_opportunity_tasks",
      params: [tenantId, customerId, 101],
      sql: `select t.id, t.type, t.due_at
        from tasks t
        join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
        where t.tenant_id = $1 and o.customer_id = $2 and o.deleted_at is null and t.status = 'OPEN'
        order by t.due_at, t.id
        limit $3`,
    },
    {
      name: "customer_timeline",
      params: [tenantId, customerId, 21],
      sql: `with customer_activity_events as (
          select a.id::text as id, a.type::text as type, a.outcome::text as outcome, a.summary, a.occurred_at, u.name as user_name
          from activities a
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
          where a.tenant_id = $1 and a.customer_id = $2
          order by a.occurred_at desc, a.id desc
          limit $3
        ), opportunity_activity_events as (
          select a.id::text as id, a.type::text as type, a.outcome::text as outcome, a.summary, a.occurred_at, u.name as user_name
          from opportunities activity_opportunity
          join activities a on a.tenant_id = activity_opportunity.tenant_id and a.opportunity_id = activity_opportunity.id
          join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
          where activity_opportunity.tenant_id = $1 and activity_opportunity.customer_id = $2
          order by a.occurred_at desc, a.id desc
          limit $3
        ), activity_events as (
          select * from customer_activity_events
          union all select * from opportunity_activity_events
        ), converted_lead_events as (
          select ('lead-created:' || l.id)::text as id, 'LEAD_CREATED' as type, null::text as outcome, '线索创建：' || l.contact_name as summary, l.created_at as occurred_at, u.name as user_name
          from lead_conversions lc join leads l on l.tenant_id = lc.tenant_id and l.id = lc.lead_id
          join users u on u.tenant_id = l.tenant_id and u.id = coalesce(l.owner_user_id, lc.converted_by_user_id)
          where lc.tenant_id = $1 and lc.customer_id = $2
          order by l.created_at desc, l.id desc
          limit $3
        ), converted_events as (
          select ('converted:' || lc.id)::text as id, 'CONVERTED' as type, null::text as outcome, '线索转为客户' as summary, lc.created_at as occurred_at, u.name as user_name
          from lead_conversions lc join users u on u.tenant_id = lc.tenant_id and u.id = lc.converted_by_user_id
          where lc.tenant_id = $1 and lc.customer_id = $2
          order by lc.created_at desc, lc.id desc
          limit $3
        ), legacy_customer_lead_candidates as (
          select l.id as lead_id, l.created_at
          from leads l
          where l.tenant_id = $1 and l.customer_id = $2
            and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
          order by l.created_at desc, l.id desc
          limit $3
        ), legacy_customer_origin_lead_candidates as (
          select l.id as lead_id, l.created_at
          from customers legacy_customer
          join leads l on l.tenant_id = legacy_customer.tenant_id and l.id = legacy_customer.from_lead_id
          where legacy_customer.tenant_id = $1 and legacy_customer.id = $2
            and legacy_customer.from_lead_id is not null
            and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
          order by l.created_at desc, l.id desc
          limit $3
        ), legacy_opportunity_origin_lead_candidates as (
          select candidate.lead_id, candidate.created_at
          from (
            select distinct on (l.id) l.id as lead_id, l.created_at
            from opportunities legacy_opportunity
            join leads l on l.tenant_id = legacy_opportunity.tenant_id and l.id = legacy_opportunity.from_lead_id
            where legacy_opportunity.tenant_id = $1 and legacy_opportunity.customer_id = $2
              and legacy_opportunity.from_lead_id is not null
              and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
            order by l.id, l.created_at desc
          ) candidate
          order by candidate.created_at desc, candidate.lead_id desc
          limit $3
        ), legacy_lead_candidates as (
          select * from legacy_customer_lead_candidates
          union all select * from legacy_customer_origin_lead_candidates
          union all select * from legacy_opportunity_origin_lead_candidates
        ), legacy_lead_ids as (
          select distinct on (candidate.lead_id) candidate.lead_id, candidate.created_at
          from legacy_lead_candidates candidate
          order by candidate.lead_id, candidate.created_at desc
        ), legacy_lead_events as (
          select ('lead-created:' || l.id)::text as id, 'LEAD_CREATED' as type, null::text as outcome, '线索创建：' || l.contact_name as summary, l.created_at as occurred_at, u.name as user_name
          from legacy_lead_ids legacy_lead
          join leads l on l.tenant_id = $1 and l.id = legacy_lead.lead_id
          join users u on u.tenant_id = l.tenant_id and u.id = l.owner_user_id
          order by l.created_at desc, l.id desc
          limit $3
        ), legacy_converted_events as (
          select ('converted-legacy:' || l.id)::text as id, 'CONVERTED' as type, null::text as outcome, '线索转为客户' as summary, conversion_audit.created_at as occurred_at, u.name as user_name
          from legacy_lead_ids legacy_lead
          join leads l on l.tenant_id = $1 and l.id = legacy_lead.lead_id
          join lateral (
            select al.actor_user_id, al.created_at
            from audit_logs al
            where al.tenant_id = l.tenant_id and al.action = 'lead.convert' and al.subject_type = 'lead' and al.subject_id = l.id
            order by al.created_at, al.id
            limit 1
          ) conversion_audit on true
          join users u on u.tenant_id = l.tenant_id and u.id = conversion_audit.actor_user_id
          order by conversion_audit.created_at desc, l.id desc
          limit $3
        ), opportunity_created_events as (
          select ('opportunity-created:' || al.id)::text as id, 'OPPORTUNITY_CREATED' as type, null::text as outcome, '创建商机：' || o.name as summary, al.created_at as occurred_at, u.name as user_name
          from audit_logs al
          join opportunities o on o.tenant_id = al.tenant_id and o.id = al.subject_id
          join users u on u.tenant_id = al.tenant_id and u.id = al.actor_user_id
          where al.tenant_id = $1 and al.action = 'opportunity.create' and al.subject_type = 'opportunity'
            and al.subject_id in (select id from opportunities where tenant_id = $1 and customer_id = $2)
          order by al.created_at desc, al.id desc
          limit $3
        ), stage_events as (
          select ('stage:' || h.id)::text as id,
            case when h.to_stage = 'WON' then 'WON' when h.to_stage = 'LOST' then 'LOST' else 'STAGE_CHANGED' end as type,
            null::text as outcome, coalesce(h.note, '商机阶段变化：' || h.to_stage) as summary, h.created_at as occurred_at, u.name as user_name
          from opportunity_stage_history h join users u on u.tenant_id = h.tenant_id and u.id = h.operator_user_id
          where h.tenant_id = $1 and h.opportunity_id in (select id from opportunities where tenant_id = $1 and customer_id = $2)
          order by h.created_at desc, h.id desc
          limit $3
        ), events as (
          select * from activity_events
          union all select * from converted_lead_events
          union all select * from legacy_lead_events
          union all select * from converted_events
          union all select * from legacy_converted_events
          union all select * from opportunity_created_events
          union all select * from stage_events
        )
        select events.id, events.type, events.outcome, events.summary, events.occurred_at, events.user_name
        from events
        order by events.occurred_at desc, events.id desc
        limit $3`,
    },
  ];
}

async function main(): Promise<void> {
  const connectionString = required("CAPACITY_APP_DATABASE_URL");
  assertSafeCapacityDatabase(connectionString);
  const tenantId = required("CAPACITY_TENANT_ID");
  const salesId = required("CAPACITY_SALES_USER_ID");
  const managerId = required("CAPACITY_MANAGER_USER_ID");
  const requestedCustomerId = optionalCustomerId(process.env.CAPACITY_CUSTOMER_ID);
  const runs = positiveInteger(process.env.BENCHMARK_RUNS, 7);
  const mode = benchmarkMode(process.env.BENCHMARK_MODE);
  const outputPath = process.env.BENCHMARK_OUTPUT ?? `artifacts/capacity-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const rowCounts = await client.query<{ customers: string; leads: string; opportunities: string; activities: string; tasks: string }>(`select
      (select count(*)::text from customers where tenant_id = $1) as customers,
      (select count(*)::text from leads where tenant_id = $1) as leads,
      (select count(*)::text from opportunities where tenant_id = $1) as opportunities,
      (select count(*)::text from activities where tenant_id = $1) as activities,
      (select count(*)::text from tasks where tenant_id = $1) as tasks`, [tenantId]);
    const representativeCustomer = requestedCustomerId
      ? await client.query<{ id: string }>(`select id
          from customers
          where tenant_id = $1 and id = $2 and deleted_at is null
          limit 1`, [tenantId, requestedCustomerId])
      : await client.query<{ id: string }>(`with candidates as (
          (select task_opportunity.customer_id as id, 0 as priority, opportunity_task.due_at as ranked_at
            from tasks opportunity_task
            join opportunities task_opportunity on task_opportunity.tenant_id = opportunity_task.tenant_id and task_opportunity.id = opportunity_task.opportunity_id
            join customers c on c.tenant_id = task_opportunity.tenant_id and c.id = task_opportunity.customer_id
            where opportunity_task.tenant_id = $1 and opportunity_task.status = 'OPEN' and opportunity_task.opportunity_id is not null
              and task_opportunity.deleted_at is null and c.deleted_at is null
            order by opportunity_task.due_at, opportunity_task.id
            limit 1)
          union all
          (select c.id, 0 as priority, customer_task.due_at as ranked_at
            from tasks customer_task
            join customers c on c.tenant_id = customer_task.tenant_id and c.id = customer_task.customer_id
            join opportunities customer_opportunity on customer_opportunity.tenant_id = c.tenant_id and customer_opportunity.customer_id = c.id
            where customer_task.tenant_id = $1 and customer_task.status = 'OPEN' and customer_task.customer_id is not null
              and c.deleted_at is null and customer_opportunity.deleted_at is null
            order by customer_task.due_at, customer_task.id
            limit 1)
          union all
          (select o.customer_id as id, 1 as priority, o.updated_at as ranked_at
            from opportunities o
            join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
            where o.tenant_id = $1 and o.deleted_at is null and c.deleted_at is null
            order by o.updated_at desc, o.id desc
            limit 1)
          union all
          (select c.id, 2 as priority, c.last_activity_at as ranked_at
            from customers c
            where c.tenant_id = $1 and c.deleted_at is null
            order by c.last_activity_at desc nulls last, c.id desc
            limit 1)
        )
        select id from candidates order by priority, ranked_at desc nulls last, id desc limit 1`, [tenantId]);
    const customerId = representativeCustomer.rows[0]?.id;
    if (!customerId) {
      if (requestedCustomerId) throw new Error("CAPACITY_CUSTOMER_ID 在当前 tenant 下不存在或客户已删除");
      throw new Error("容量基准租户中找不到可用客户，无法执行客户详情与时间线基准");
    }
    const results: Array<Record<string, unknown>> = [];
    for (const spec of specs(tenantId, salesId, managerId, customerId)) {
      const explain = await client.query<ExplainRow>(`explain (analyze, buffers, format json) ${spec.sql}`, spec.params);
      const plan = explain.rows[0]?.["QUERY PLAN"]?.[0]?.Plan;
      const timings: number[] = [];
      let returnedRows = 0;
      for (let run = 0; run < runs; run += 1) {
        const started = performance.now();
        const response = await client.query(spec.sql, spec.params);
        timings.push(performance.now() - started);
        returnedRows = response.rowCount ?? 0;
      }
      results.push({
        name: spec.name,
        params: spec.params,
        runs,
        p50Ms: Number(percentile(timings, 0.5).toFixed(2)),
        p95Ms: Number(percentile(timings, 0.95).toFixed(2)),
        p99Ms: Number(percentile(timings, 0.99).toFixed(2)),
        returnedRows,
        explain: plan,
        sql: spec.sql,
      });
    }
    await client.query("commit");
    const report = {
      generatedAt: new Date().toISOString(),
      environment: { database: new URL(connectionString).pathname.slice(1), postgresVersion: (await client.query("select version()")).rows[0]?.version ?? null },
      data: { tenantId, representativeCustomerId: customerId, customerSelection: requestedCustomerId ? "explicit" : "automatic", runs, mode, rowCounts: rowCounts.rows[0] },
      results,
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Capacity benchmark written to ${outputPath}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
