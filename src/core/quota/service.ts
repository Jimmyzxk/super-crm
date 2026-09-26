import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { zonedYearMonth } from "@/core/shared/tz";
import { quotaPeriodDateRange, resolveQuotaPeriod } from "@/core/shared/period";
import type {
  BatchUpsertQuotasInput,
  QuotaAttainmentSummary,
  QuotaPeriodType,
  SalesQuotaItem,
  TeamQuotaDashboardData,
  UpsertQuotaInput,
} from "./types";

export async function listSalesQuotas(
  ctx: TenantContext,
  filter: {
    year?: number;
    periodType?: QuotaPeriodType;
    periodKey?: string;
    departmentId?: string;
    userId?: string;
  } = {},
): Promise<SalesQuotaItem[]> {
  return withTenant(ctx.tenantId, async (tx: TenantTransaction) => {
    const currentYear = filter.year ?? zonedYearMonth().year;
    // SALES 只能看到自己的目标（含邮箱等成员信息），管理员/主管看全员——
    // 与仪表盘 getSalesQuotaAttainmentDashboard 的角色口径保持一致
    const effectiveUserId = ctx.role === "SALES" ? ctx.userId : filter.userId;

    const rows = await tx.execute<{
      id: string;
      tenant_id: string;
      user_id: string;
      user_name: string;
      user_email: string;
      department_id: string | null;
      department_name: string | null;
      year: number;
      period_type: QuotaPeriodType;
      period_key: string;
      target_amount_cents: string;
      target_deals_count: number;
      target_leads_count: number;
      note: string | null;
      created_at: string;
      updated_at: string;
    }>(sql`
      select 
        q.id,
        q.tenant_id,
        q.user_id,
        u.name as user_name,
        u.email as user_email,
        u.department_id,
        d.name as department_name,
        q.year,
        q.period_type,
        q.period_key,
        q.target_amount_cents,
        q.target_deals_count,
        q.target_leads_count,
        q.note,
        q.created_at,
        q.updated_at
      from public.sales_quotas q
      join public.users u on u.tenant_id = q.tenant_id and u.id = q.user_id
      left join public.departments d on d.tenant_id = q.tenant_id and d.id = u.department_id
      where q.tenant_id = ${ctx.tenantId}
        and q.year = ${currentYear}
        ${filter.periodType ? sql`and q.period_type = ${filter.periodType}` : sql``}
        ${filter.periodKey ? sql`and q.period_key = ${filter.periodKey}` : sql``}
        ${filter.departmentId ? sql`and u.department_id = ${filter.departmentId}` : sql``}
        ${effectiveUserId ? sql`and q.user_id = ${effectiveUserId}` : sql``}
      order by d.name asc nulls last, u.name asc, q.period_key asc
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      departmentId: r.department_id,
      departmentName: r.department_name,
      year: r.year,
      periodType: r.period_type,
      periodKey: r.period_key,
      targetAmountCents: Number(r.target_amount_cents),
      targetDealsCount: r.target_deals_count,
      targetLeadsCount: r.target_leads_count,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function upsertSalesQuota(ctx: TenantContext, input: UpsertQuotaInput): Promise<SalesQuotaItem> {
  if (ctx.role !== "ADMIN" && ctx.role !== "MANAGER") {
    throw new BusinessError("FORBIDDEN", "无权配置销售目标");
  }

  return withTenant(ctx.tenantId, async (tx: TenantTransaction) => {
    // 自动获取该销售人员的部门
    const userRow = await tx.execute<{ id: string; department_id: string | null }>(sql`
      select id, department_id from public.users where tenant_id = ${ctx.tenantId} and id = ${input.userId}
    `);
    if (userRow.rows.length === 0) {
      throw new BusinessError("NOT_FOUND", "销售人员不存在");
    }

    const deptId = userRow.rows[0].department_id;

    await tx.execute(sql`
      insert into public.sales_quotas (
        tenant_id,
        user_id,
        department_id,
        year,
        period_type,
        period_key,
        target_amount_cents,
        target_deals_count,
        target_leads_count,
        note,
        created_by_user_id,
        updated_at
      ) values (
        ${ctx.tenantId},
        ${input.userId},
        ${deptId},
        ${input.year},
        ${input.periodType},
        ${input.periodKey},
        ${input.targetAmountCents},
        ${input.targetDealsCount ?? 0},
        ${input.targetLeadsCount ?? 0},
        ${input.note ?? null},
        ${ctx.userId},
        now()
      )
      on conflict (tenant_id, user_id, period_type, period_key)
      do update set
        target_amount_cents = excluded.target_amount_cents,
        target_deals_count = excluded.target_deals_count,
        target_leads_count = excluded.target_leads_count,
        department_id = excluded.department_id,
        note = coalesce(excluded.note, sales_quotas.note),
        updated_at = now()
    `);

    const rows = await tx.execute<{
      id: string;
      tenant_id: string;
      user_id: string;
      user_name: string;
      user_email: string;
      department_id: string | null;
      department_name: string | null;
      year: number;
      period_type: QuotaPeriodType;
      period_key: string;
      target_amount_cents: string;
      target_deals_count: number;
      target_leads_count: number;
      note: string | null;
      created_at: string;
      updated_at: string;
    }>(sql`
      select 
        q.id,
        q.tenant_id,
        q.user_id,
        u.name as user_name,
        u.email as user_email,
        u.department_id,
        d.name as department_name,
        q.year,
        q.period_type,
        q.period_key,
        q.target_amount_cents,
        q.target_deals_count,
        q.target_leads_count,
        q.note,
        q.created_at,
        q.updated_at
      from public.sales_quotas q
      join public.users u on u.tenant_id = q.tenant_id and u.id = q.user_id
      left join public.departments d on d.tenant_id = q.tenant_id and d.id = u.department_id
      where q.tenant_id = ${ctx.tenantId}
        and q.year = ${input.year}
        and q.period_type = ${input.periodType}
        and q.period_key = ${input.periodKey}
        and q.user_id = ${input.userId}
      limit 1
    `);

    if (rows.rows.length === 0) {
      throw new BusinessError("INTERNAL_ERROR", "目标创建失败");
    }

    const r = rows.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      departmentId: r.department_id,
      departmentName: r.department_name,
      year: r.year,
      periodType: r.period_type,
      periodKey: r.period_key,
      targetAmountCents: Number(r.target_amount_cents),
      targetDealsCount: r.target_deals_count,
      targetLeadsCount: r.target_leads_count,
      note: r.note,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function batchUpsertSalesQuotas(ctx: TenantContext, input: BatchUpsertQuotasInput): Promise<{ count: number }> {
  if (ctx.role !== "ADMIN" && ctx.role !== "MANAGER") {
    throw new BusinessError("FORBIDDEN", "无权批量配置销售目标");
  }

  return withTenant(ctx.tenantId, async (tx: TenantTransaction) => {
    if (input.quotas.length === 0) return { count: 0 };
    // 批量取用户部门映射，减少 N+1
    const userIds = Array.from(new Set(input.quotas.map((q) => q.userId)));
    const usersRes = await tx.execute<{ id: string; department_id: string | null }>(sql`
      select id, department_id from public.users
      where tenant_id = ${ctx.tenantId} and id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})
    `);
    const deptMap = new Map<string, string | null>(usersRes.rows.map((r) => [r.id, r.department_id]));
    const validQuotas = input.quotas.filter((q) => deptMap.has(q.userId));
    if (validQuotas.length === 0) return { count: 0 };
    // 多 values 单条 INSERT ... ON CONFLICT DO UPDATE
    const valuesSql = sql.join(
      validQuotas.map(
        (q) => sql`(${ctx.tenantId}::uuid, ${q.userId}::uuid, ${deptMap.get(q.userId) ? sql`${deptMap.get(q.userId)}::uuid` : sql`null`}, ${q.year}, ${q.periodType}, ${q.periodKey}, ${q.targetAmountCents}, ${q.targetDealsCount ?? 0}, ${q.targetLeadsCount ?? 0}, ${q.note ?? null}, ${ctx.userId}::uuid, now())`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      insert into public.sales_quotas (
        tenant_id,
        user_id,
        department_id,
        year,
        period_type,
        period_key,
        target_amount_cents,
        target_deals_count,
        target_leads_count,
        note,
        created_by_user_id,
        updated_at
      ) values ${valuesSql}
      on conflict (tenant_id, user_id, period_type, period_key)
      do update set
        target_amount_cents = excluded.target_amount_cents,
        target_deals_count = excluded.target_deals_count,
        target_leads_count = excluded.target_leads_count,
        department_id = excluded.department_id,
        note = coalesce(excluded.note, sales_quotas.note),
        updated_at = now()
    `);
    return { count: validQuotas.length };
  });
}

export async function getSalesQuotaAttainmentDashboard(
  ctx: TenantContext,
  params: {
    year?: number;
    periodType?: QuotaPeriodType;
    periodKey?: string;
    departmentId?: string;
  } = {},
): Promise<TeamQuotaDashboardData> {
  return withTenant(ctx.tenantId, async (tx: TenantTransaction) => {
    // 当期年月按业务时区判定：UTC 月末的上海次月凌晨不得错期；period_key 格式由
    // shared/period 唯一实现（BI 与 analytics 共用），避免第四处再写一遍
    const { year, periodType, periodKey } = resolveQuotaPeriod({
      year: params.year,
      periodType: params.periodType,
      periodKey: params.periodKey,
    });

    const { start, end } = quotaPeriodDateRange(year, periodType, periodKey);

    // 1. 获取所有在职销售团队成员
    const membersRes = await tx.execute<{
      id: string;
      name: string;
      department_name: string | null;
    }>(sql`
      select 
        u.id,
        u.name,
        d.name as department_name
      from public.users u
      left join public.departments d on d.tenant_id = u.tenant_id and d.id = u.department_id
      where u.tenant_id = ${ctx.tenantId}
        and u.status = 'ACTIVE'
        ${params.departmentId ? sql`and u.department_id = ${params.departmentId}` : sql``}
        ${ctx.role === "SALES" ? sql`and u.id = ${ctx.userId}` : sql``}
      order by d.name asc nulls last, u.name asc
    `);

    // 2. 查出当期设定的销售目标
    const quotasRes = await tx.execute<{
      user_id: string;
      target_amount_cents: string;
      target_deals_count: number;
    }>(sql`
      select user_id, target_amount_cents, target_deals_count
      from public.sales_quotas
      where tenant_id = ${ctx.tenantId}
        and year = ${year}
        and period_type = ${periodType}
        and period_key = ${periodKey}
        ${ctx.role === "SALES" ? sql`and user_id = ${ctx.userId}` : sql``}
    `);

    const quotaMap = new Map<string, { targetAmount: number; targetDeals: number }>();
    quotasRes.rows.forEach((q) => {
      quotaMap.set(q.user_id, {
        targetAmount: Number(q.target_amount_cents),
        targetDeals: q.target_deals_count,
      });
    });

    // 3. 查出当期内每个人的实际签约赢单额 (WON)
    const wonRes = await tx.execute<{
      owner_user_id: string;
      won_amount_cents: string;
      won_count: string;
    }>(sql`
      select 
        owner_user_id,
        coalesce(sum(coalesce(actual_amount, expected_amount)), 0) as won_amount_cents,
        count(id) as won_count
      from public.opportunities
      where tenant_id = ${ctx.tenantId}
        and stage = 'WON'
        and deleted_at is null
        and coalesce(actual_close_at::timestamptz, stage_entered_at, created_at) >= ${start.toISOString()}::timestamptz
        and coalesce(actual_close_at::timestamptz, stage_entered_at, created_at) < ${end.toISOString()}::timestamptz
        ${ctx.role === "SALES" ? sql`and owner_user_id = ${ctx.userId}` : sql``}
      group by owner_user_id
    `);

    const wonMap = new Map<string, { wonAmount: number; wonCount: number }>();
    wonRes.rows.forEach((w) => {
      wonMap.set(w.owner_user_id, {
        wonAmount: Number(w.won_amount_cents),
        wonCount: Number(w.won_count),
      });
    });

    // 4. 查出每个人的在途商机 (Open Pipeline)
    const pipelineRes = await tx.execute<{
      owner_user_id: string;
      open_pipeline_cents: string;
    }>(sql`
      select 
        owner_user_id,
        coalesce(sum(expected_amount), 0) as open_pipeline_cents
      from public.opportunities
      where tenant_id = ${ctx.tenantId}
        and stage not in ('WON', 'LOST')
        and deleted_at is null
        ${ctx.role === "SALES" ? sql`and owner_user_id = ${ctx.userId}` : sql``}
      group by owner_user_id
    `);

    const pipelineMap = new Map<string, number>();
    pipelineRes.rows.forEach((p) => {
      pipelineMap.set(p.owner_user_id, Number(p.open_pipeline_cents));
    });

    // 5. 组装每个成员的达成与缺口明细
    let teamTarget = 0;
    let teamWon = 0;
    let teamPipeline = 0;

    const summaries: QuotaAttainmentSummary[] = membersRes.rows.map((m) => {
      const q = quotaMap.get(m.id) || { targetAmount: 0, targetDeals: 0 };
      const w = wonMap.get(m.id) || { wonAmount: 0, wonCount: 0 };
      const openPipe = pipelineMap.get(m.id) || 0;

      const targetAmt = q.targetAmount;
      const wonAmt = w.wonAmount;
      const gap = Math.max(0, targetAmt - wonAmt);
      const attainmentRate = targetAmt > 0 ? Math.round((wonAmt / targetAmt) * 1000) / 10 : 0;
      const coverageRatio = gap > 0 ? Math.round((openPipe / gap) * 10) / 10 : 99.9;

      teamTarget += targetAmt;
      teamWon += wonAmt;
      teamPipeline += openPipe;

      return {
        userId: m.id,
        userName: m.name,
        departmentName: m.department_name,
        year,
        periodType,
        periodKey,
        targetAmountCents: targetAmt,
        wonAmountCents: wonAmt,
        attainmentRate,
        quotaGapCents: gap,
        targetDealsCount: q.targetDeals,
        wonDealsCount: w.wonCount,
        openPipelineAmountCents: openPipe,
        pipelineCoverageRatio: coverageRatio,
      };
    });

    const teamGap = Math.max(0, teamTarget - teamWon);
    const teamAttainmentRate = teamTarget > 0 ? Math.round((teamWon / teamTarget) * 1000) / 10 : 0;
    const teamPipelineCoverageRatio = teamGap > 0 ? Math.round((teamPipeline / teamGap) * 10) / 10 : 99.9;

    return {
      year,
      periodType,
      periodKey,
      teamTargetAmountCents: teamTarget,
      teamWonAmountCents: teamWon,
      teamAttainmentRate,
      teamQuotaGapCents: teamGap,
      teamOpenPipelineAmountCents: teamPipeline,
      teamPipelineCoverageRatio,
      members: summaries,
    };
  });
}
