import { sql } from "drizzle-orm";
import { withTenant, type TenantContext, type TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import type {
  CreateScheduleInput,
  SalesScheduleItem,
  ScheduleStatus,
  ScheduleType,
  UpdateScheduleInput,
} from "./types";

export async function listSalesSchedulesService(
  tenant: TenantContext,
  params?: {
    userId?: string;
    startDate?: string;
    endDate?: string;
    status?: ScheduleStatus;
  },
): Promise<SalesScheduleItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const conditions = [sql`s.tenant_id = ${tenant.tenantId}`];

    const targetUserId = tenant.role === "SALES" ? tenant.userId : params?.userId;
    if (targetUserId) {
      conditions.push(sql`s.user_id = ${targetUserId}`);
    }
    if (params?.status) {
      conditions.push(sql`s.status = ${params.status}`);
    }
    if (params?.startDate) {
      conditions.push(sql`s.start_at >= ${params.startDate}::timestamptz`);
    }
    if (params?.endDate) {
      conditions.push(sql`s.start_at <= ${params.endDate}::timestamptz`);
    }

    const whereClause = sql.join(conditions, sql` and `);

    const result = await tx.execute<{
      id: string;
      user_id: string;
      user_name: string;
      title: string;
      schedule_type: ScheduleType;
      lead_id: string | null;
      lead_name: string | null;
      customer_id: string | null;
      customer_name: string | null;
      opportunity_id: string | null;
      opportunity_name: string | null;
      start_at: string;
      end_at: string | null;
      note: string | null;
      status: ScheduleStatus;
      source: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        s.id,
        s.user_id,
        u.name as user_name,
        s.title,
        s.schedule_type,
        s.lead_id,
        l.contact_name as lead_name,
        s.customer_id,
        c.name as customer_name,
        s.opportunity_id,
        o.name as opportunity_name,
        s.start_at::text as start_at,
        s.end_at::text as end_at,
        s.note,
        s.status,
        s.source,
        s.created_at::text as created_at,
        s.updated_at::text as updated_at
      from public.sales_schedules s
      join public.users u on u.id = s.user_id and u.tenant_id = s.tenant_id
      left join public.leads l on l.id = s.lead_id and l.tenant_id = s.tenant_id
      left join public.customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
      left join public.opportunities o on o.id = s.opportunity_id and o.tenant_id = s.tenant_id
      where ${whereClause}
      order by s.start_at asc
    `);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      title: row.title,
      scheduleType: row.schedule_type,
      leadId: row.lead_id,
      leadName: row.lead_name,
      customerId: row.customer_id,
      customerName: row.customer_name,
      opportunityId: row.opportunity_id,
      opportunityName: row.opportunity_name,
      startAt: row.start_at,
      endAt: row.end_at,
      note: row.note,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

export async function createSalesScheduleService(
  tenant: TenantContext,
  input: CreateScheduleInput,
): Promise<SalesScheduleItem> {
  const trimmedTitle = input.title.trim();
  if (!trimmedTitle || trimmedTitle.length > 100) {
    throw new BusinessError("VALIDATION_ERROR", "日程标题长度必须在 1-100 个字符之间", "title");
  }

  const startIso = input.startAt instanceof Date ? input.startAt.toISOString() : input.startAt;
  const endIso = input.endAt ? (input.endAt instanceof Date ? input.endAt.toISOString() : input.endAt) : null;

  return withTenant(tenant.tenantId, async (tx) => {
    if (input.leadId) {
      const leadRes = await tx.execute(sql`
        select id from public.leads
        where id = ${input.leadId}::uuid and tenant_id = ${tenant.tenantId}::uuid and deleted_at is null
      `);
      if (leadRes.rows.length === 0) {
        throw new BusinessError("NOT_FOUND", "关联的线索不存在或已被删除", "leadId");
      }
    }

    if (input.customerId) {
      const custRes = await tx.execute(sql`
        select id from public.customers
        where id = ${input.customerId}::uuid and tenant_id = ${tenant.tenantId}::uuid and deleted_at is null
      `);
      if (custRes.rows.length === 0) {
        throw new BusinessError("NOT_FOUND", "关联的客户不存在或已被删除", "customerId");
      }
    }

    if (input.opportunityId) {
      const oppRes = await tx.execute(sql`
        select id from public.opportunities
        where id = ${input.opportunityId}::uuid and tenant_id = ${tenant.tenantId}::uuid and deleted_at is null
      `);
      if (oppRes.rows.length === 0) {
        throw new BusinessError("NOT_FOUND", "关联的商机不存在或已被删除", "opportunityId");
      }
    }

    const result = await tx.execute<{
      id: string;
      user_id: string;
      title: string;
      schedule_type: ScheduleType;
      lead_id: string | null;
      customer_id: string | null;
      opportunity_id: string | null;
      start_at: string;
      end_at: string | null;
      note: string | null;
      status: ScheduleStatus;
      source: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into public.sales_schedules (
        tenant_id,
        user_id,
        title,
        schedule_type,
        lead_id,
        customer_id,
        opportunity_id,
        start_at,
        end_at,
        note,
        status,
        source,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        ${trimmedTitle},
        ${input.scheduleType},
        ${input.leadId || null},
        ${input.customerId || null},
        ${input.opportunityId || null},
        ${startIso}::timestamptz,
        ${endIso ? sql`${endIso}::timestamptz` : null},
        ${input.note ? input.note.trim() : null},
        'PENDING',
        'MANUAL',
        now(),
        now()
      )
      returning
        id, user_id, title, schedule_type, lead_id, customer_id, opportunity_id,
        start_at::text as start_at, end_at::text as end_at, note, status, source,
        created_at::text as created_at, updated_at::text as updated_at
    `);

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      scheduleType: row.schedule_type,
      leadId: row.lead_id,
      customerId: row.customer_id,
      opportunityId: row.opportunity_id,
      startAt: row.start_at,
      endAt: row.end_at,
      note: row.note,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function completeSalesScheduleService(
  tenant: TenantContext,
  scheduleId: string,
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    const exist = await tx.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from public.sales_schedules
      where id = ${scheduleId}::uuid and tenant_id = ${tenant.tenantId}::uuid
    `);
    if (exist.rows.length === 0) {
      throw new BusinessError("NOT_FOUND", "日程不存在");
    }
    if (tenant.role === "SALES" && exist.rows[0].user_id !== tenant.userId) {
      throw new BusinessError("FORBIDDEN", "当前用户无权操作该日程");
    }

    await tx.execute(sql`
      update public.sales_schedules
      set status = 'COMPLETED', updated_at = now()
      where id = ${scheduleId}::uuid and tenant_id = ${tenant.tenantId}::uuid
    `);
  });
}

export async function updateSalesScheduleService(
  tenant: TenantContext,
  input: UpdateScheduleInput,
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    const exist = await tx.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from public.sales_schedules
      where id = ${input.id}::uuid and tenant_id = ${tenant.tenantId}::uuid
    `);
    if (exist.rows.length === 0) {
      throw new BusinessError("NOT_FOUND", "日程不存在");
    }
    if (tenant.role === "SALES" && exist.rows[0].user_id !== tenant.userId) {
      throw new BusinessError("FORBIDDEN", "当前用户无权操作该日程");
    }

    const sets = [];
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new BusinessError("VALIDATION_ERROR", "日程标题长度必须在 1-100 个字符之间", "title");
      }
      sets.push(sql`title = ${trimmed}`);
    }
    if (input.scheduleType !== undefined) {
      sets.push(sql`schedule_type = ${input.scheduleType}`);
    }
    if (input.startAt !== undefined) {
      const startIso = input.startAt instanceof Date ? input.startAt.toISOString() : input.startAt;
      sets.push(sql`start_at = ${startIso}::timestamptz`);
    }
    if (input.endAt !== undefined) {
      const endIso = input.endAt ? (input.endAt instanceof Date ? input.endAt.toISOString() : input.endAt) : null;
      sets.push(sql`end_at = ${endIso ? sql`${endIso}::timestamptz` : null}`);
    }
    if (input.note !== undefined) {
      sets.push(sql`note = ${input.note ? input.note.trim() : null}`);
    }
    if (input.status !== undefined) {
      sets.push(sql`status = ${input.status}`);
    }
    sets.push(sql`updated_at = now()`);

    if (sets.length > 1) {
      await tx.execute(sql`
        update public.sales_schedules
        set ${sql.join(sets, sql`, `)}
        where id = ${input.id}::uuid and tenant_id = ${tenant.tenantId}::uuid
      `);
    }
  });
}

export async function deleteSalesScheduleService(
  tenant: TenantContext,
  scheduleId: string,
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    const exist = await tx.execute<{ id: string; user_id: string }>(sql`
      select id, user_id from public.sales_schedules
      where id = ${scheduleId}::uuid and tenant_id = ${tenant.tenantId}::uuid
    `);
    if (exist.rows.length === 0) {
      throw new BusinessError("NOT_FOUND", "日程不存在");
    }
    if (tenant.role === "SALES" && exist.rows[0].user_id !== tenant.userId) {
      throw new BusinessError("FORBIDDEN", "当前用户无权操作该日程");
    }

    await tx.execute(sql`
      delete from public.sales_schedules
      where id = ${scheduleId}::uuid and tenant_id = ${tenant.tenantId}::uuid
    `);
  });
}

export async function autoCreateScheduleFromFollowup(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
  data: {
    title: string;
    scheduleType: ScheduleType;
    leadId?: string | null;
    customerId?: string | null;
    opportunityId?: string | null;
    startAt: Date | string;
    note?: string | null;
  },
): Promise<void> {
  const startIso = data.startAt instanceof Date ? data.startAt.toISOString() : data.startAt;
  await tx.execute(sql`
    insert into public.sales_schedules (
      tenant_id,
      user_id,
      title,
      schedule_type,
      lead_id,
      customer_id,
      opportunity_id,
      start_at,
      note,
      status,
      source,
      created_at,
      updated_at
    ) values (
      ${tenantId},
      ${userId},
      ${data.title.slice(0, 100)},
      ${data.scheduleType},
      ${data.leadId || null},
      ${data.customerId || null},
      ${data.opportunityId || null},
      ${startIso}::timestamptz,
      ${data.note || null},
      'PENDING',
      'AUTO_FROM_FOLLOWUP',
      now(),
      now()
    )
  `);
}
