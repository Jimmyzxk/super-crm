import { sql } from "drizzle-orm";
import { withTenant, type TenantContext, type TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import type {
  CustomerCollaborationSettings,
  DealInterventionItem,
  InterventionStatus,
  InterventionType,
  InterventionWinRateAnalytics,
  RequestInterventionInput,
  ResolveInterventionInput,
  UpdateCustomerCollaborationSettingsInput,
} from "./types";
import { dispatchWorkplaceNotificationService } from "@/core/workplace/service";

async function audit(tx: TenantTransaction, ctx: TenantContext, action: string, id: string, detail: object = {}) {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, 'customer_collaboration_settings', ${id}, ${JSON.stringify(detail)}::jsonb)`);
}

export async function requestManagerInterventionService(
  tenant: TenantContext,
  input: RequestInterventionInput,
): Promise<DealInterventionItem> {
  const trimmedNote = input.requestNote.trim();
  if (!trimmedNote || trimmedNote.length > 500) {
    throw new Error("请详细填写呼叫主管介入的诉求与卡点 (1-500 字)");
  }

  const result = await withTenant(tenant.tenantId, async (tx) => {
    // 验证商机存在
    const oppRes = await tx.execute<{ id: string; name: string; customer_name: string; owner_user_id: string }>(sql`
      select o.id, o.name, c.name as customer_name, o.owner_user_id
      from public.opportunities o
      join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
      where o.id = ${input.opportunityId} and o.tenant_id = ${tenant.tenantId} and o.deleted_at is null
    `);

    if (oppRes.rows.length === 0) {
      throw new Error("目标商机不存在或已被删除");
    }

    if (tenant.role === "SALES" && oppRes.rows[0].owner_user_id !== tenant.userId) {
      throw new BusinessError("FORBIDDEN", "仅商机归属人可申请主管协同介入");
    }

    // 指派主管必须在本租户内且为主管/管理员角色——
    // 否则可写入跨租户用户 id 形成脏数据
    if (input.assignedManagerId) {
      const mgr = await tx.execute<{ role: string }>(sql`
        select role::text as role from public.users
        where id = ${input.assignedManagerId}::uuid and tenant_id = ${tenant.tenantId} and status = 'ACTIVE'
      `);
      const mgrRole = mgr.rows[0]?.role;
      if (mgrRole !== "MANAGER" && mgrRole !== "ADMIN") {
        throw new BusinessError("VALIDATION_ERROR", "指派的介入主管不存在、非本企业成员或角色不符");
      }
    }

    // 插入介入申请记录
    const result = await tx.execute<{
      id: string;
      opportunity_id: string;
      requester_user_id: string;
      assigned_manager_id: string | null;
      intervention_type: InterventionType;
      status: InterventionStatus;
      request_note: string;
      manager_feedback: string | null;
      coaching_notes: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into public.deal_interventions (
        tenant_id,
        opportunity_id,
        requester_user_id,
        assigned_manager_id,
        intervention_type,
        status,
        request_note,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.opportunityId},
        ${tenant.userId},
        ${input.assignedManagerId || null},
        ${input.interventionType},
        'REQUESTED',
        ${trimmedNote},
        now(),
        now()
      )
      returning
        id,
        opportunity_id,
        requester_user_id,
        assigned_manager_id,
        intervention_type,
        status,
        request_note,
        manager_feedback,
        coaching_notes,
        resolved_at::text as resolved_at,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);

    const row = result.rows[0];

    // 写入不可篡改审计日志
    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'DEAL_INTERVENTION_REQUEST',
        'opportunity',
        ${input.opportunityId},
        ${JSON.stringify({
          interventionId: row.id,
          type: input.interventionType,
          note: trimmedNote,
        })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      opportunityId: row.opportunity_id,
      opportunityName: oppRes.rows[0].name,
      customerName: oppRes.rows[0].customer_name,
      requesterUserId: row.requester_user_id,
      assignedManagerId: row.assigned_manager_id,
      interventionType: row.intervention_type,
      status: row.status,
      requestNote: row.request_note,
      managerFeedback: row.manager_feedback,
      coachingNotes: row.coaching_notes,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });

  dispatchWorkplaceNotificationService(tenant, {
    event: "INTERVENTION_REQUESTED",
    title: "【战情室协助请求】",
    markdownContent: `### 🆘 战情室介入请求\n\n**客户**：${result.customerName}\n**商机**：${result.opportunityName}\n**诉求类型**：${result.interventionType}\n**卡点说明**：${result.requestNote}`,
    data: { interventionId: result.id, opportunityId: result.opportunityId },
  }).catch(console.error);

  return result;
}

export async function resolveManagerInterventionService(
  tenant: TenantContext,
  input: ResolveInterventionInput,
): Promise<void> {
  const trimmedFeedback = input.managerFeedback.trim();
  if (!trimmedFeedback) {
    throw new Error("请录入主管介入指导或反馈建议");
  }
  // 运行时状态白名单：action 层未做 zod 校验，非法值会直通 PG 抛 500
  if (input.status !== "RESOLVED" && input.status !== "REJECTED") {
    throw new BusinessError("VALIDATION_ERROR", "介入处置状态非法，仅允许 RESOLVED 或 REJECTED");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    const checkRes = await tx.execute<{ id: string; opportunity_id: string; status: string }>(sql`
      select id, opportunity_id, status::text as status from public.deal_interventions
      where id = ${input.interventionId} and tenant_id = ${tenant.tenantId}
      for update
    `);
    if (checkRes.rows.length === 0) {
      throw new Error("协同介入记录不存在");
    }
    // 终态守卫：RESOLVED/REJECTED 为不可逆终态，防止已结案记录被反复改写
    if (checkRes.rows[0].status === "RESOLVED" || checkRes.rows[0].status === "REJECTED") {
      throw new BusinessError("CONFLICT", "介入记录已结案，不可重复处置或改写结论");
    }

    await tx.execute(sql`
      update public.deal_interventions
      set
        status = ${input.status},
        manager_feedback = ${trimmedFeedback},
        coaching_notes = ${input.coachingNotes ? input.coachingNotes.trim() : null},
        assigned_manager_id = coalesce(assigned_manager_id, ${tenant.userId}),
        resolved_at = case when ${input.status} = 'RESOLVED' then now() else resolved_at end,
        updated_at = now()
      where id = ${input.interventionId} and tenant_id = ${tenant.tenantId}
    `);

    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'DEAL_INTERVENTION_RESOLVE',
        'opportunity',
        ${checkRes.rows[0].opportunity_id},
        ${JSON.stringify({
          interventionId: input.interventionId,
          status: input.status,
          feedback: trimmedFeedback,
        })}::jsonb,
        now()
      )
    `);
  });
}

export async function listDealInterventionsService(
  tenant: TenantContext,
  params?: {
    opportunityId?: string;
    status?: InterventionStatus;
    assignedManagerId?: string;
  },
): Promise<DealInterventionItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const conditions = [sql`di.tenant_id = ${tenant.tenantId}`];

    if (tenant.role === "SALES") {
      conditions.push(sql`(di.requester_user_id = ${tenant.userId} or o.owner_user_id = ${tenant.userId})`);
    }

    if (params?.opportunityId) {
      conditions.push(sql`di.opportunity_id = ${params.opportunityId}`);
    }
    if (params?.status) {
      conditions.push(sql`di.status = ${params.status}`);
    }
    if (params?.assignedManagerId) {
      conditions.push(
        sql`(di.assigned_manager_id = ${params.assignedManagerId} or di.assigned_manager_id is null)`,
      );
    }

    const whereClause = sql.join(conditions, sql` and `);

    const result = await tx.execute<{
      id: string;
      opportunity_id: string;
      opportunity_name: string;
      customer_name: string;
      expected_amount: string | null;
      requester_user_id: string;
      requester_name: string;
      assigned_manager_id: string | null;
      assigned_manager_name: string | null;
      intervention_type: InterventionType;
      status: InterventionStatus;
      request_note: string;
      manager_feedback: string | null;
      coaching_notes: string | null;
      resolved_at: string | null;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        di.id,
        di.opportunity_id,
        o.name as opportunity_name,
        c.name as customer_name,
        o.expected_amount::text as expected_amount,
        di.requester_user_id,
        req.name as requester_name,
        di.assigned_manager_id,
        mgr.name as assigned_manager_name,
        di.intervention_type,
        di.status,
        di.request_note,
        di.manager_feedback,
        di.coaching_notes,
        di.resolved_at::text as resolved_at,
        di.created_at::text as created_at,
        di.updated_at::text as updated_at
      from public.deal_interventions di
      join public.opportunities o on o.id = di.opportunity_id and o.tenant_id = di.tenant_id
      join public.customers c on c.id = o.customer_id and c.tenant_id = di.tenant_id
      join public.users req on req.id = di.requester_user_id and req.tenant_id = di.tenant_id
      left join public.users mgr on mgr.id = di.assigned_manager_id and mgr.tenant_id = di.tenant_id
      where ${whereClause}
      order by di.created_at desc
    `);

    const hasManagementAuth = tenant.role === "ADMIN" || tenant.role === "MANAGER";

    return result.rows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      opportunityName: row.opportunity_name,
      customerName: row.customer_name,
      expectedAmount: row.expected_amount ? Number(row.expected_amount) : null,
      requesterUserId: row.requester_user_id,
      requesterName: row.requester_name,
      assignedManagerId: row.assigned_manager_id,
      assignedManagerName: row.assigned_manager_name,
      interventionType: row.intervention_type,
      status: row.status,
      requestNote: row.request_note,
      managerFeedback: row.manager_feedback,
      coachingNotes: hasManagementAuth ? row.coaching_notes : null,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

export async function getInterventionWinRateAnalyticsService(
  tenant: TenantContext,
): Promise<InterventionWinRateAnalytics> {
  return withTenant(tenant.tenantId, async (tx) => {
    // 统计已结案商机中：有主管介入 vs 无主管介入 的赢单率对比
    const res = await tx.execute<{
      with_won: string;
      with_total: string;
      without_won: string;
      without_total: string;
    }>(sql`
      with closed_deals as (
        select
          o.id,
          o.stage,
          exists(
            select 1 from public.deal_interventions di
            where di.opportunity_id = o.id and di.tenant_id = o.tenant_id and di.status = 'RESOLVED'
          ) as had_intervention
        from public.opportunities o
        where o.tenant_id = ${tenant.tenantId}
          and o.stage in ('WON', 'LOST')
          and o.deleted_at is null
      )
      select
        count(*) filter (where had_intervention and stage = 'WON')::text as with_won,
        count(*) filter (where had_intervention)::text as with_total,
        count(*) filter (where not had_intervention and stage = 'WON')::text as without_won,
        count(*) filter (where not had_intervention)::text as without_total
      from closed_deals
    `);

    const row = res.rows[0];
    const withWon = Number(row?.with_won || 0);
    const withTotal = Number(row?.with_total || 0);
    const withoutWon = Number(row?.without_won || 0);
    const withoutTotal = Number(row?.without_total || 0);

    const withRate = withTotal > 0 ? Math.round((withWon / withTotal) * 100) : 0;
    const withoutRate = withoutTotal > 0 ? Math.round((withoutWon / withoutTotal) * 100) : 0;
    const lift = withoutRate > 0 ? Math.round(((withRate - withoutRate) / withoutRate) * 100) : (withRate > 0 ? 100 : 0);

    return {
      withInterventionWonCount: withWon,
      withInterventionTotalCount: withTotal,
      withInterventionWonRate: withRate,
      withoutInterventionWonCount: withoutWon,
      withoutInterventionTotalCount: withoutTotal,
      withoutInterventionWonRate: withoutRate,
      liftPercentage: lift,
    };
  });
}

export async function getCustomerCollaborationSettingsService(
  tenant: TenantContext,
): Promise<CustomerCollaborationSettings> {
  return withTenant(tenant.tenantId, async (tx) => {
    const row = await tx.execute<{
      id: string;
      allow_multi_sales_followup: boolean;
      require_product_exclusivity: boolean;
      updated_at: string;
    }>(sql`
      select id, allow_multi_sales_followup, require_product_exclusivity, updated_at::text
      from public.customer_collaboration_settings
      where tenant_id = ${tenant.tenantId}
      limit 1
    `);

    if (row.rows.length === 0) {
      return {
        allowMultiSalesFollowup: false,
        // 无配置行 = 租户默认：排他保护开启（与规则引擎内置行为一致）
        requireProductExclusivity: true,
      };
    }

    return {
      id: row.rows[0].id,
      allowMultiSalesFollowup: row.rows[0].allow_multi_sales_followup,
      requireProductExclusivity: row.rows[0].require_product_exclusivity,
      updatedAt: row.rows[0].updated_at,
    };
  });
}

export async function updateCustomerCollaborationSettingsService(
  tenant: TenantContext,
  input: UpdateCustomerCollaborationSettingsInput,
): Promise<CustomerCollaborationSettings> {
  if (tenant.role !== "ADMIN") {
    throw new BusinessError("FORBIDDEN", "只有管理员可以修改客户共享协同与防撞单规则配置");
  }

  // 排他保护默认开启：未显式传 false 时保持 true，
  // 避免 UI 漏传字段把保护静默关掉
  const requireProductExclusivity = input.requireProductExclusivity !== false;

  return withTenant(tenant.tenantId, async (tx) => {
    const upserted = await tx.execute<{
      id: string;
      allow_multi_sales_followup: boolean;
      require_product_exclusivity: boolean;
      updated_at: string;
    }>(sql`
      insert into public.customer_collaboration_settings (
        tenant_id,
        allow_multi_sales_followup,
        require_product_exclusivity,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.allowMultiSalesFollowup},
        ${requireProductExclusivity},
        now()
      )
      on conflict (tenant_id)
      do update set
        allow_multi_sales_followup = excluded.allow_multi_sales_followup,
        require_product_exclusivity = excluded.require_product_exclusivity,
        updated_at = now()
      returning id, allow_multi_sales_followup, require_product_exclusivity, updated_at::text
    `);

    const result = {
      id: upserted.rows[0].id,
      allowMultiSalesFollowup: upserted.rows[0].allow_multi_sales_followup,
      requireProductExclusivity: upserted.rows[0].require_product_exclusivity,
      updatedAt: upserted.rows[0].updated_at,
    };

    await audit(tx, tenant, "customer_collaboration.update_settings", result.id, {
      allowMultiSalesFollowup: input.allowMultiSalesFollowup,
      requireProductExclusivity,
    });

    return result;
  });
}

