import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { listActiveTenantIdsWithoutTenant, withTenant } from "@/core/tenant";
import type { NotificationItem, NotificationPage, NotificationScanResult, NotificationType } from "./types";

export async function createLeadAssignedNotification(
  tx: TenantTransaction,
  input: {
    tenantId: string;
    userId: string;
    taskId: string;
    leadId: string;
    contactName: string;
    source: string;
    score: number | null;
  },
): Promise<void> {
  const title = `新线索已分配给你：${input.contactName}`.slice(0, 100);
  const body = `来源：${input.source}${input.score === null ? "" : `，评分 ${input.score}`}`.slice(0, 200);
  await tx.execute(sql`insert into notifications
    (tenant_id, user_id, type, task_id, lead_id, title, body, link)
    select ${input.tenantId}, ${input.userId}, 'LEAD_ASSIGNED', ${input.taskId}, ${input.leadId},
      ${title}, ${body}, ${`/leads/${input.leadId}`}
    where not exists (
      select 1 from notifications
      where task_id = ${input.taskId} and type = 'LEAD_ASSIGNED'
    )`);
}

export async function createNotificationInTransaction(
  tx: TenantTransaction,
  input: {
    tenantId: string;
    userId: string;
    type?: NotificationType;
    title: string;
    body: string;
    link?: string;
    createdAt?: Date | string;
  },
): Promise<void> {
  const notifType = input.type || "TASK_DUE_SOON";
  const sanitizedLink = input.link ? input.link.slice(0, 300) : null;
  const createdAtSql = input.createdAt
    ? sql`${new Date(input.createdAt).toISOString()}::timestamptz`
    : sql`now()`;
  await tx.execute(sql`
    insert into notifications (
      tenant_id, user_id, type, title, body, link, created_at
    ) values (
      ${input.tenantId}, ${input.userId}, ${notifType}::notification_type,
      ${input.title.slice(0, 100)}, ${input.body.slice(0, 200)}, ${sanitizedLink}, ${createdAtSql}
    )
  `);
}

/** @deprecated 请直接使用 createNotificationInTransaction 或通过 @/plugin-kit 引用 */
export const createPluginNotificationInTransaction = createNotificationInTransaction;

export async function getNotificationUnreadCountService(ctx: TenantContext): Promise<number> {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ count: number }>(sql`select count(*)::int as count
      from notifications where user_id = ${ctx.userId} and read_at is null`);
    return Number(result.rows[0]?.count ?? 0);
  });
}

export async function listNotificationsService(
  ctx: TenantContext,
  limit = 20,
): Promise<NotificationPage> {
  const pageSize = Math.max(20, Math.min(Math.floor(limit), 100));
  return withTenant(ctx.tenantId, async (tx) => {
    const [items, unread, total] = await Promise.all([
      tx.execute<NotificationItem>(sql`select id, type::text as type, title, body, link,
        read_at::text as "readAt", created_at::text as "createdAt"
        from notifications where user_id = ${ctx.userId}
        order by created_at desc, id desc limit ${pageSize + 1}`),
      tx.execute<{ count: number }>(sql`select count(*)::int as count
        from notifications where user_id = ${ctx.userId} and read_at is null`),
      tx.execute<{ count: number }>(sql`select count(*)::int as count
        from notifications where user_id = ${ctx.userId}`),
    ]);
    return {
      items: items.rows.slice(0, pageSize),
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      totalCount: Number(total.rows[0]?.count ?? 0),
      nextLimit: items.rows.length > pageSize ? Math.min(pageSize + 20, 100) : null,
    };
  });
}

export async function markNotificationReadService(ctx: TenantContext, notificationId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.execute(sql`update notifications set read_at = coalesce(read_at, now())
      where id = ${notificationId} and user_id = ${ctx.userId}`);
    return { notificationId };
  });
}

export async function markAllNotificationsReadService(ctx: TenantContext) {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute(sql`update notifications set read_at = now()
      where user_id = ${ctx.userId} and read_at is null`);
    return { updated: result.rowCount ?? 0 };
  });
}

async function scanTenant(tenantId: string, now: Date) {
  return withTenant(tenantId, async (tx) => {
    const nowIso = now.toISOString();
    const dueSoonAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const dueSoonAtIso = dueSoonAt.toISOString();

    // 消除空转扫描：先快速低成本检查当前租户是否存在即将到期或已超期的 OPEN 待办，无待办则直接短路跳过重型 5 表关联与锁表
    // 但无临期待办 early-return 前也执行 90 天历史通知清理
    const hasCandidateTasks = await tx.execute<{ id: string }>(sql`
      select id from tasks
      where tenant_id = ${tenantId} and status = 'OPEN' and due_at <= ${dueSoonAtIso}::timestamptz
      limit 1
    `);
    if (hasCandidateTasks.rows.length === 0) {
      const cleanedEarly = await tx.execute<{ cleaned: number }>(sql`
        select public.cleanup_notifications_before(${new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)}) as cleaned`);
      return { overdueCreated: 0, dueSoonCreated: 0, cleaned: Number(cleanedEarly.rows[0]?.cleaned ?? 0) };
    }

    const inserted = await tx.execute<{ type: "TASK_OVERDUE" | "TASK_DUE_SOON" }>(sql`
      with candidates as (
        select t.id as task_id,
          case when assignee.status = 'ACTIVE' then assignee.id else admin_user.id end as assignee_user_id,
          t.lead_id, t.customer_id, t.opportunity_id, t.type as task_type, t.due_at,
          coalesce(l.contact_name, o.name, c.name, '待处理事项') as object_name,
          case when t.due_at < ${nowIso}::timestamptz then 'TASK_OVERDUE'::notification_type
            else 'TASK_DUE_SOON'::notification_type end as notification_type,
          (assignee.status is null or assignee.status <> 'ACTIVE') as is_fallback
        from tasks t
        left join users assignee on assignee.tenant_id = t.tenant_id
          and assignee.id = t.assignee_user_id
        left join lateral (
          select u.id from users u
          where u.tenant_id = t.tenant_id and u.role = 'ADMIN' and u.status = 'ACTIVE'
          order by u.created_at asc limit 1
        ) admin_user on true
        left join leads l on l.tenant_id = t.tenant_id and l.id = t.lead_id
        left join customers c on c.tenant_id = t.tenant_id and c.id = t.customer_id
        left join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
        where t.status = 'OPEN'
          and (assignee.status = 'ACTIVE' or admin_user.id is not null)
          and (
            (t.due_at < ${nowIso}::timestamptz and not exists (
              select 1 from notifications existing
              where existing.tenant_id = ${tenantId}::uuid
                and existing.user_id = coalesce(case when assignee.status = 'ACTIVE' then assignee.id else admin_user.id end, t.assignee_user_id)
                and (
                  (existing.task_id is not null and existing.task_id = t.id)
                  or (existing.link is not null and existing.link like ('%' || t.id::text || '%'))
                )
                and existing.type = 'TASK_OVERDUE'
                and (
                  existing.created_at > ${nowIso}::timestamptz - interval '24 hours'
                  or (existing.created_at at time zone 'Asia/Shanghai')::date = (${nowIso}::timestamptz at time zone 'Asia/Shanghai')::date
                )
            ))
            or
            (t.due_at >= ${nowIso}::timestamptz and t.due_at <= ${dueSoonAtIso}::timestamptz and not exists (
              select 1 from notifications existing
              where existing.tenant_id = ${tenantId}::uuid
                and existing.user_id = coalesce(case when assignee.status = 'ACTIVE' then assignee.id else admin_user.id end, t.assignee_user_id)
                and (
                  (existing.task_id is not null and existing.task_id = t.id)
                  or (existing.link is not null and existing.link like ('%' || t.id::text || '%'))
                )
                and existing.type = 'TASK_DUE_SOON'
                and (
                  existing.created_at > ${nowIso}::timestamptz - interval '24 hours'
                  or (existing.created_at at time zone 'Asia/Shanghai')::date = (${nowIso}::timestamptz at time zone 'Asia/Shanghai')::date
                )
            ))
          )
        order by t.due_at, t.id
        limit 1000
        for update of t skip locked
      )
      insert into notifications
        (tenant_id, user_id, type, task_id, lead_id, opportunity_id, title, body, link, created_at)
      select ${tenantId}, candidate.assignee_user_id, candidate.notification_type,
        candidate.task_id, candidate.lead_id, candidate.opportunity_id,
        left(candidate.object_name || '的' || case candidate.task_type
          when 'FIRST_RESPONSE' then '首次响应' when 'FOLLOW_UP' then '跟进任务'
          else '阶段推进' end || case candidate.notification_type
          when 'TASK_OVERDUE' then '已超时' else '即将到期' end, 100),
        left(
          case when candidate.is_fallback then '【原负责人已停用】' else '' end
          || case candidate.notification_type when 'TASK_OVERDUE' then '已超时，截止时间 '
            else '将在 2 小时内到期，截止时间 ' end
          || to_char(candidate.due_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'),
          200
        ),
        case when candidate.lead_id is not null then '/leads/' || candidate.lead_id::text || '?taskId=' || candidate.task_id::text
          when candidate.opportunity_id is not null then '/opportunities/' || candidate.opportunity_id::text || '?taskId=' || candidate.task_id::text
          when candidate.customer_id is not null then '/customers/' || candidate.customer_id::text || '?taskId=' || candidate.task_id::text
          else '/tasks/' || candidate.task_id::text end,
        ${nowIso}::timestamptz
      from candidates candidate
      returning type::text as type`);
    const cleaned = await tx.execute<{ cleaned: number }>(sql`
      select public.cleanup_notifications_before(${new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)}) as cleaned`);
    return {
      overdueCreated: inserted.rows.filter((row) => row.type === "TASK_OVERDUE").length,
      dueSoonCreated: inserted.rows.filter((row) => row.type === "TASK_DUE_SOON").length,
      cleaned: Number(cleaned.rows[0]?.cleaned ?? 0),
    };
  });
}

export async function scanTaskNotificationsService(now = new Date()): Promise<NotificationScanResult> {
  const startedAt = Date.now();
  const tenantIds = await listActiveTenantIdsWithoutTenant();
  let overdueCreated = 0;
  let dueSoonCreated = 0;
  let cleaned = 0;
  for (const tenantId of tenantIds) {
    try {
      const result = await scanTenant(tenantId, now);
      overdueCreated += result.overdueCreated;
      dueSoonCreated += result.dueSoonCreated;
      cleaned += result.cleaned;
    } catch (error) {
      console.error("notification scan failed", { tenantId, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { tenantsScanned: tenantIds.length, overdueCreated, dueSoonCreated, cleaned, elapsedMs: Date.now() - startedAt };
}
