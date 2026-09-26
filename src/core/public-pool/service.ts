import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withTenant } from "@/core/tenant";
import type { TenantContext } from "@/core/tenant";
import type {
  PublicPoolRecycleItemPreview,
  PublicPoolRecycleScanResult,
  PublicPoolRuleItem,
  PublicPoolRuleType,
  UpdatePublicPoolRuleInput,
} from "./types";
import { dispatchWorkplaceNotificationService } from "@/core/workplace/service";

const DEFAULT_RULES: Array<{
  ruleType: PublicPoolRuleType;
  thresholdDays: number;
  protectWindowDays: number;
  notifyBeforeHours: number;
  isEnabled: boolean;
}> = [
  {
    ruleType: "LEAD_UNTOUCHED",
    thresholdDays: 7,
    protectWindowDays: 3,
    notifyBeforeHours: 24,
    isEnabled: true,
  },
  {
    ruleType: "LEAD_UNCONVERTED",
    thresholdDays: 30,
    protectWindowDays: 3,
    notifyBeforeHours: 24,
    isEnabled: true,
  },
  {
    ruleType: "CUSTOMER_INACTIVE",
    thresholdDays: 60,
    protectWindowDays: 7,
    notifyBeforeHours: 48,
    isEnabled: true,
  },
];

export async function listPublicPoolRulesService(
  tenant: TenantContext,
): Promise<PublicPoolRuleItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      rule_type: PublicPoolRuleType;
      threshold_days: number;
      protect_window_days: number;
      notify_before_hours: number;
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        id,
        rule_type,
        threshold_days,
        protect_window_days,
        notify_before_hours,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
      from public.public_pool_rules
      where tenant_id = ${tenant.tenantId}
      order by rule_type asc
    `);

    const existingMap = new Map(rows.rows.map((r) => [r.rule_type, r]));

    return DEFAULT_RULES.map((def) => {
      const existing = existingMap.get(def.ruleType);
      if (existing) {
        return {
          id: existing.id,
          ruleType: existing.rule_type,
          thresholdDays: existing.threshold_days,
          protectWindowDays: existing.protect_window_days,
          notifyBeforeHours: existing.notify_before_hours,
          isEnabled: existing.is_enabled,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        };
      }
      return {
        id: `default-${def.ruleType}`,
        ruleType: def.ruleType,
        thresholdDays: def.thresholdDays,
        protectWindowDays: def.protectWindowDays,
        notifyBeforeHours: def.notifyBeforeHours,
        isEnabled: def.isEnabled,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
  });
}

export async function upsertPublicPoolRuleService(
  tenant: TenantContext,
  input: UpdatePublicPoolRuleInput,
): Promise<PublicPoolRuleItem> {
  if (tenant.role !== "ADMIN" && tenant.role !== "MANAGER") {
    throw new Error("权限不足：仅管理员或主管可配置公海回收规则");
  }

  if (input.thresholdDays < 1 || input.thresholdDays > 365) {
    throw new Error("回收阈值天数必须在 1 至 365 天之间");
  }

  const protectDays = input.protectWindowDays ?? 3;
  const notifyHours = input.notifyBeforeHours ?? 24;

  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      rule_type: PublicPoolRuleType;
      threshold_days: number;
      protect_window_days: number;
      notify_before_hours: number;
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into public.public_pool_rules (
        tenant_id,
        rule_type,
        threshold_days,
        protect_window_days,
        notify_before_hours,
        is_enabled,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.ruleType},
        ${input.thresholdDays},
        ${protectDays},
        ${notifyHours},
        ${input.isEnabled},
        now(),
        now()
      )
      on conflict (tenant_id, rule_type) do update set
        threshold_days = excluded.threshold_days,
        protect_window_days = excluded.protect_window_days,
        notify_before_hours = excluded.notify_before_hours,
        is_enabled = excluded.is_enabled,
        updated_at = now()
      returning
        id,
        rule_type,
        threshold_days,
        protect_window_days,
        notify_before_hours,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);

    const row = res.rows[0];

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
        'public_pool_rule.update',
        'public_pool_rule',
        ${row.id},
        ${JSON.stringify({ ruleType: input.ruleType, thresholdDays: input.thresholdDays, isEnabled: input.isEnabled })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      ruleType: row.rule_type,
      thresholdDays: row.threshold_days,
      protectWindowDays: row.protect_window_days,
      notifyBeforeHours: row.notify_before_hours,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function runPublicPoolRecycleScanService(
  tenant: TenantContext,
  options: { dryRun?: boolean; afterCandidateScan?: () => Promise<void> | void } = {},
): Promise<PublicPoolRecycleScanResult> {
  const dryRun = options.dryRun ?? true;

  const result = await withTenant(tenant.tenantId, async (tx) => {
    // 1. 获取该租户生效的公海规则
    const rules = await listPublicPoolRulesService(tenant);
    const untouchedRule = rules.find((r) => r.ruleType === "LEAD_UNTOUCHED" && r.isEnabled);
    const unconvertedRule = rules.find((r) => r.ruleType === "LEAD_UNCONVERTED" && r.isEnabled);
    const inactiveCustomerRule = rules.find((r) => r.ruleType === "CUSTOMER_INACTIVE" && r.isEnabled);

    const previews: PublicPoolRecycleItemPreview[] = [];
    const leadIdsToRecycle: string[] = [];
    const customerIdsToRecycle: string[] = [];
    let totalProtected = 0;
    let allPrivateLeads: Array<{ id: string; contact_name: string; company_name: string | null; owner_user_id: string; status: string; owner_name: string }> = [];
    let allPrivateCustomers: Array<{ id: string; name: string; owner_user_id: string; owner_name: string }> = [];

    // 2. 扫描私海线索
    if (untouchedRule || unconvertedRule) {
      const privateLeads = await tx.execute<{
        id: string;
        contact_name: string;
        company_name: string | null;
        owner_user_id: string;
        status: string;
        owner_name: string;
        created_at: string;
        claimed_at: string | null;
        last_activity_at: string | null;
        days_since_touch: number;
        days_since_created: number;
        days_since_claim: number | null;
      }>(sql`
        select
          l.id,
          l.contact_name,
          l.company_name,
          l.owner_user_id,
          l.status::text as status,
          u.name as owner_name,
          l.created_at::text as created_at,
          coalesce(l.claimed_at, l.created_at)::text as claimed_at,
          max(a.created_at)::text as last_activity_at,
          extract(day from (now() - coalesce(max(a.created_at), l.created_at)))::integer as days_since_touch,
          extract(day from (now() - l.created_at))::integer as days_since_created,
          extract(day from (now() - coalesce(l.claimed_at, l.created_at)))::integer as days_since_claim
        from public.leads l
        join public.users u on u.id = l.owner_user_id
        left join public.activities a on a.lead_id = l.id
        where l.tenant_id = ${tenant.tenantId}
          and l.owner_user_id is not null
          and l.status not in ('CONVERTED', 'DISCARDED')
          and l.deleted_at is null
        group by l.id, l.contact_name, l.company_name, l.owner_user_id, u.name, l.created_at, l.claimed_at
        order by l.id asc
      `);

      allPrivateLeads = privateLeads.rows;
      for (const lead of privateLeads.rows) {
        let isEligible = false;
        let reason = "";
        let triggeredRule: typeof untouchedRule = undefined;

        if (untouchedRule && lead.days_since_touch >= untouchedRule.thresholdDays) {
          isEligible = true;
          triggeredRule = untouchedRule;
          reason = `私海线索超过 ${untouchedRule.thresholdDays} 天无新增跟进记录 (实际停滞 ${lead.days_since_touch} 天)`;
        } else if (unconvertedRule && (lead.days_since_claim ?? lead.days_since_created) >= unconvertedRule.thresholdDays) {
          isEligible = true;
          triggeredRule = unconvertedRule;
          const claimDaysForReason = lead.days_since_claim ?? lead.days_since_created;
          reason = `线索认领进入私海超过 ${unconvertedRule.thresholdDays} 天未成单 (实际已在池 ${claimDaysForReason} 天)`;
        }

        if (isEligible) {
          // 检查是否在对应规则设定的免回收保护期内
          const protectDays = triggeredRule?.protectWindowDays ?? 3;
          const claimDays = lead.days_since_claim ?? lead.days_since_created;
          const isProtected = claimDays < protectDays;

          if (isProtected) {
            totalProtected += 1;
          } else {
            leadIdsToRecycle.push(lead.id);
          }

          previews.push({
            id: lead.id,
            name: lead.contact_name + (lead.company_name ? ` (${lead.company_name})` : ""),
            entityType: "LEAD",
            ownerUserId: lead.owner_user_id,
            ownerName: lead.owner_name,
            lastActivityAt: lead.last_activity_at,
            claimedAt: lead.claimed_at,
            daysSinceLastTouch: lead.days_since_touch,
            reason,
            isProtected,
          });
        }
      }
    }

    // 3. 扫描沉睡客户
    if (inactiveCustomerRule) {
      const privateCustomers = await tx.execute<{
        id: string;
        name: string;
        owner_user_id: string;
        owner_name: string;
        created_at: string;
        claimed_at: string | null;
        last_activity_at: string | null;
        days_since_touch: number;
        days_since_claim: number;
      }>(sql`
        select
          c.id,
          c.name,
          c.owner_user_id,
          u.name as owner_name,
          c.created_at::text as created_at,
          coalesce(c.claimed_at, c.created_at)::text as claimed_at,
          max(a.created_at)::text as last_activity_at,
          extract(day from (now() - coalesce(max(a.created_at), c.created_at)))::integer as days_since_touch,
          extract(day from (now() - coalesce(c.claimed_at, c.created_at)))::integer as days_since_claim
        from public.customers c
        join public.users u on u.id = c.owner_user_id
        left join public.activities a on a.customer_id = c.id
        where c.tenant_id = ${tenant.tenantId}
          and c.owner_user_id is not null
          and c.deleted_at is null
          and not exists (
            select 1 from public.opportunities o
            where o.tenant_id = c.tenant_id
              and o.customer_id = c.id
              and o.deleted_at is null
              and o.stage not in ('WON', 'LOST')
          )
        group by c.id, c.name, c.owner_user_id, u.name, c.created_at, c.claimed_at
        order by c.id asc
      `);

      allPrivateCustomers = privateCustomers.rows;
      for (const cust of privateCustomers.rows) {
        if (cust.days_since_touch >= inactiveCustomerRule.thresholdDays) {
          // 保护期按真实认领时间计算：刚捞回的沉睡客户不能次日被再抢走
          const protectDays = inactiveCustomerRule.protectWindowDays ?? 7;
          const isProtected = cust.days_since_claim < protectDays;
          if (!isProtected) customerIdsToRecycle.push(cust.id);

          previews.push({
            id: cust.id,
            name: cust.name,
            entityType: "CUSTOMER",
            ownerUserId: cust.owner_user_id,
            ownerName: cust.owner_name,
            lastActivityAt: cust.last_activity_at,
            claimedAt: cust.claimed_at,
            daysSinceLastTouch: cust.days_since_touch,
            reason: isProtected
              ? `认领保护期内（剩余 ${Math.max(0, protectDays - cust.days_since_claim)} 天），暂不回收`
              : `客户档案超过 ${inactiveCustomerRule.thresholdDays} 天无跟进记录 (实际沉睡 ${cust.days_since_touch} 天)`,
            isProtected,
          });
        }
      }
    }

    // 4. 执行实际回收释放操作（若非 Dry Run）
    let recycledLeadsCount = 0;
    let recycledCustomersCount = 0;
    const recycledLeadIds: string[] = [];
    const recycledCustomerIds: string[] = [];

    if (!dryRun) {
      if (options.afterCandidateScan) await options.afterCandidateScan();
      if (leadIdsToRecycle.length > 0) {
        for (const leadId of leadIdsToRecycle) {
          const leadItem = allPrivateLeads.find((l) => l.id === leadId);
          const expectedOwnerUserId = leadItem?.owner_user_id;
          if (!leadItem || !expectedOwnerUserId) continue;

          const locked = await tx.execute<{ owner_user_id: string | null; status: string }>(sql`
            select owner_user_id, status::text as status
            from public.leads
            where tenant_id = ${tenant.tenantId} and id = ${leadId} and deleted_at is null
            for update
          `);
          if (locked.rows[0]?.owner_user_id !== expectedOwnerUserId
            || locked.rows[0].status === "CONVERTED" || locked.rows[0].status === "DISCARDED") continue;

          const updateRes = await tx.execute(sql`
            update public.leads
            set
              owner_user_id = null,
              claimed_at = null,
              updated_at = now()
            where tenant_id = ${tenant.tenantId}
              and id = ${leadId}
              and owner_user_id = ${expectedOwnerUserId}
              and deleted_at is null
          `);
          if (updateRes.rowCount !== 1) continue;

          recycledLeadIds.push(leadId);
          await tx.execute(sql`
            update public.tasks set status = 'CANCELLED', updated_at = now()
            where tenant_id = ${tenant.tenantId}
              and lead_id = ${leadId}
              and status = 'OPEN'
          `);
          const previewItem = previews.find((p) => p.id === leadId);
          const recycleReason = previewItem?.reason ? `公海规则引擎回收：${previewItem.reason}` : "公海规则引擎超期自动回收释放";
          await tx.execute(sql`
            insert into public.lead_status_history (tenant_id, lead_id, from_status, to_status, reason, actor_user_id)
            values (${tenant.tenantId}, ${leadId}, null, ${locked.rows[0].status}::lead_status, ${recycleReason}, ${tenant.userId}::uuid)
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
              'lead.auto_recycle',
              'lead',
              ${leadId},
              ${JSON.stringify({ reason: recycleReason })}::jsonb,
              now()
            )
          `);
          await tx.execute(sql`
            insert into public.notifications (
              tenant_id,
              user_id,
              lead_id,
              type,
              title,
              body,
              link,
              created_at
            ) values (
              ${tenant.tenantId},
              ${expectedOwnerUserId},
              ${leadId},
              'RECYCLE_EXECUTED',
              '【公海回收通知】潜客已自动释放至公海池',
              ${`线索「${leadItem.contact_name}」因${recycleReason}，已由系统规则引擎释放至公海池供全员认领。`},
              '/leads?tab=public',
              now()
            )
          `);
        }
        recycledLeadsCount = recycledLeadIds.length;
      }

      if (customerIdsToRecycle.length > 0) {
        for (const custId of customerIdsToRecycle) {
          const custItem = allPrivateCustomers.find((c) => c.id === custId);
          const expectedOwnerUserId = custItem?.owner_user_id;
          if (!custItem || !expectedOwnerUserId) continue;

          const locked = await tx.execute<{ owner_user_id: string | null; hasActiveOpportunity: boolean }>(sql`
            select c.owner_user_id,
              exists (
                select 1 from public.opportunities o
                where o.tenant_id = c.tenant_id
                  and o.customer_id = c.id
                  and o.deleted_at is null
                  and o.stage not in ('WON', 'LOST')
              ) as "hasActiveOpportunity"
            from public.customers c
            where c.tenant_id = ${tenant.tenantId} and c.id = ${custId} and c.deleted_at is null
            for update of c
          `);
          if (locked.rows[0]?.owner_user_id !== expectedOwnerUserId || locked.rows[0].hasActiveOpportunity) continue;

          const updateRes = await tx.execute(sql`
            update public.customers
            set
              owner_user_id = null,
              updated_at = now()
            where tenant_id = ${tenant.tenantId}
              and id = ${custId}
              and owner_user_id = ${expectedOwnerUserId}
              and deleted_at is null
          `);
          if (updateRes.rowCount !== 1) continue;

          recycledCustomerIds.push(custId);
          await tx.execute(sql`
            update public.tasks set status = 'CANCELLED', updated_at = now()
            where tenant_id = ${tenant.tenantId}
              and customer_id = ${custId}
              and status = 'OPEN'
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
              'customer.auto_recycle',
              'customer',
              ${custId},
              ${JSON.stringify({ reason: "公海规则引擎沉睡客户超期自动回收释放" })}::jsonb,
              now()
            )
          `);
          await tx.execute(sql`
            insert into public.notifications (
              tenant_id,
              user_id,
              type,
              title,
              body,
              link,
              created_at
            ) values (
              ${tenant.tenantId},
              ${expectedOwnerUserId},
              'RECYCLE_EXECUTED',
              '【公海回收通知】沉睡客户已释放至公海池',
              ${`客户「${custItem.name}」因超过 ${inactiveCustomerRule?.thresholdDays ?? 60} 天无有效跟进，已自动释放至公海客户池。`},
              '/customers',
              now()
            )
          `);
        }
        recycledCustomersCount = recycledCustomerIds.length;
      }
    }

    return {
      scannedAt: new Date().toISOString(),
      totalEligibleLeads: leadIdsToRecycle.length,
      totalEligibleCustomers: customerIdsToRecycle.length,
      totalProtectedItems: totalProtected,
      recycledLeadsCount: dryRun ? 0 : recycledLeadsCount,
      recycledCustomersCount: dryRun ? 0 : recycledCustomersCount,
      dryRun,
      previewItems: previews,
      recycledLeadIds: dryRun ? [] : [...recycledLeadIds],
    };
  });

  // 回收落库后刷新相关线索的销售洞察：无线索的旧建议若不即时过期，
  // 今日工作台会继续给已无关的线索推过时建议
  if (!dryRun && result.recycledLeadIds.length > 0) {
    const { refreshInsightsSafely } = await import("@/core/insight/service");
    for (const leadId of result.recycledLeadIds) {
      await refreshInsightsSafely(tenant, { type: "lead", id: leadId });
    }
  }

  if (!dryRun && (result.recycledLeadsCount > 0 || result.recycledCustomersCount > 0)) {
    dispatchWorkplaceNotificationService(tenant, {
      event: "PUBLIC_POOL_RECYCLED",
      title: "【公海资源自动回收】",
      markdownContent: `### 公海资源自动回收播报\n\n系统刚才自动回收了 **${result.recycledLeadsCount}** 条逾期未跟进线索及 **${result.recycledCustomersCount}** 个沉睡客户至公海。\n\n请大家及时领取并跟进，保持活水循环！`,
      data: {
        recycledLeadsCount: result.recycledLeadsCount,
        recycledCustomersCount: result.recycledCustomersCount,
      }
    }).catch(console.error);
  }

  return result;
}

export type PublicPoolTenantRecycleSummary = {
  tenantId: string;
  status: "RECYCLED" | "SKIPPED" | "FAILED";
  recycledLeadsCount: number;
  recycledCustomersCount: number;
  totalProtectedItems: number;
  /** SKIPPED/FAILED 时的原因说明 */
  detail?: string;
};

/**
 * 全租户定时回收编排（供 /api/cron/recycle-public-pools 调用）。
 *
 * 为什么单独成函数：此前路由逐租户串行执行且无隔离，
 * 任何一个租户出错（典型：无 ADMIN 用户时用假 UUID 写审计日志触发外键违规）
 * 都会让整轮回收 500 中断，其余租户全部漏回收。
 *
 * 隔离规则：
 * - 单个租户的任何失败只记为 FAILED，不影响其他租户；
 * - 找不到可用操作人（审计日志 actor 必须是真实用户）的租户记为 SKIPPED 跳过；
 * - 本函数自身不抛错，调用方只需关心逐租户结果。
 */
export async function runPublicPoolRecycleForAllTenantsService(deps: {
  listActiveTenantIds?: () => Promise<string[]>;
  resolveActorUserId?: (tenantId: string) => Promise<string | null>;
} = {}): Promise<PublicPoolTenantRecycleSummary[]> {
  const summaries: PublicPoolTenantRecycleSummary[] = [];

  // 默认实现留在 core 层（route/cron 调用方不允许碰 DB 连接）；
  // 测试可注入假实现模拟连接抖动与空租户
  const listActiveTenantIds = deps.listActiveTenantIds ?? (async () => {
    const res = await db.execute<{ id: string }>(sql`select id from tenants where status = 'ACTIVE'`);
    return res.rows.map((r) => r.id);
  });
  const resolveActorUserId = deps.resolveActorUserId ?? (async (tenantId: string) => {
    // 审计日志要求 actor 是真实用户：优先管理员，退化到任意活跃用户，再没有就跳过该租户
    // users 表受 FORCE ROW LEVEL SECURITY 保护，必须通过 withTenant 切换租户上下文查询
    return withTenant(tenantId, async (tx) => {
      const adminRes = await tx.execute<{ id: string }>(sql`
        select id from users where tenant_id = ${tenantId} and role = 'ADMIN' and status = 'ACTIVE' limit 1`);
      if (adminRes.rows[0]?.id) return adminRes.rows[0].id;
      const anyRes = await tx.execute<{ id: string }>(sql`
        select id from users where tenant_id = ${tenantId} and status = 'ACTIVE' limit 1`);
      return anyRes.rows[0]?.id ?? null;
    });
  });

  const tenantIds = await listActiveTenantIds();

  for (const tenantId of tenantIds) {
    const base: PublicPoolTenantRecycleSummary = {
      tenantId,
      status: "RECYCLED",
      recycledLeadsCount: 0,
      recycledCustomersCount: 0,
      totalProtectedItems: 0,
    };

    try {
      const actorUserId = await resolveActorUserId(tenantId);
      if (!actorUserId) {
        summaries.push({ ...base, status: "SKIPPED", detail: "NO_ACTOR_USER：租户无可用用户，无法作为审计操作人" });
        continue;
      }

      const result = await runPublicPoolRecycleScanService(
        { tenantId, userId: actorUserId, role: "ADMIN" },
        { dryRun: false },
      );

      // 回收完成后补一轮临期预警扫描（给"快超期"的销售发提醒）。
      // 该扫描此前没有任何调用方，属于纯摆设功能。预警失败只记日志：
      // 回收本身已成功，不能让通知系统抖动把整轮结果拖成 FAILED
      try {
        await scanPublicPoolPreRecycleWarningsService({ tenantId, userId: actorUserId, role: "ADMIN" });
      } catch (warnError) {
        console.error("public pool pre-recycle warning scan failed", { tenantId, error: warnError });
      }

      summaries.push({
        ...base,
        recycledLeadsCount: result.recycledLeadsCount,
        recycledCustomersCount: result.recycledCustomersCount,
        totalProtectedItems: result.totalProtectedItems,
      });
    } catch (error) {
      summaries.push({
        ...base,
        status: "FAILED",
        detail: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  return summaries;
}

export type PublicPoolPreWarningItem = {
  id: string;
  name: string;
  entityType: "LEAD" | "CUSTOMER";
  ownerUserId: string;
  ownerName: string;
  daysSinceTouch: number;
  hoursRemaining: number;
  thresholdDays: number;
};

export async function scanPublicPoolPreRecycleWarningsService(
  tenant: TenantContext,
): Promise<{ warningCount: number; warnings: PublicPoolPreWarningItem[] }> {
  return withTenant(tenant.tenantId, async (tx) => {
    const rules = await listPublicPoolRulesService(tenant);
    const untouchedRule = rules.find((r) => r.ruleType === "LEAD_UNTOUCHED" && r.isEnabled);
    const unconvertedRule = rules.find((r) => r.ruleType === "LEAD_UNCONVERTED" && r.isEnabled);
    const inactiveRule = rules.find((r) => r.ruleType === "CUSTOMER_INACTIVE" && r.isEnabled);
    if (!untouchedRule && !unconvertedRule && !inactiveRule) return { warningCount: 0, warnings: [] };

    const warningItems: PublicPoolPreWarningItem[] = [];

    // 1) LEAD_UNTOUCHED 临期（复用主扫描窗口口径：days_since_touch）
    if (untouchedRule) {
      const thresholdDays = untouchedRule.thresholdDays;
      const notifyHours = untouchedRule.notifyBeforeHours || 24;
      const warnDaysThreshold = thresholdDays - notifyHours / 24;
      const leads = await tx.execute<{
        id: string;
        contact_name: string;
        company_name: string | null;
        owner_user_id: string;
        owner_name: string;
        created_at: string;
        last_activity_at: string | null;
        days_since_touch: number;
      }>(sql`
        select
          l.id,
          l.contact_name,
          l.company_name,
          l.owner_user_id,
          u.name as owner_name,
          l.created_at::text as created_at,
          max(a.created_at)::text as last_activity_at,
          extract(day from (now() - coalesce(max(a.created_at), l.created_at)))::integer as days_since_touch
        from public.leads l
        join public.users u on u.id = l.owner_user_id
        left join public.activities a on a.lead_id = l.id
        where l.tenant_id = ${tenant.tenantId}
          and l.owner_user_id is not null
          and l.status not in ('CONVERTED', 'DISCARDED')
          and l.deleted_at is null
        group by l.id, l.contact_name, l.company_name, l.owner_user_id, u.name, l.created_at
      `);
      for (const lead of leads.rows) {
        if (lead.days_since_touch >= warnDaysThreshold && lead.days_since_touch < thresholdDays) {
          const daysLeft = thresholdDays - lead.days_since_touch;
          const hoursRemaining = Math.max(1, Math.round(daysLeft * 24));
          warningItems.push({
            id: lead.id,
            name: lead.contact_name + (lead.company_name ? ` (${lead.company_name})` : ""),
            entityType: "LEAD",
            ownerUserId: lead.owner_user_id,
            ownerName: lead.owner_name,
            daysSinceTouch: lead.days_since_touch,
            hoursRemaining,
            thresholdDays,
          });
          const recentNotif = await tx.execute<{ id: string }>(sql`
            select id from public.notifications
            where tenant_id = ${tenant.tenantId}
              and user_id = ${lead.owner_user_id}
              and lead_id = ${lead.id}
              and type = 'RECYCLE_WARNING'
              and created_at > now() - interval '24 hours'
            limit 1
          `);
          if (recentNotif.rows.length === 0) {
            await tx.execute(sql`
              insert into public.notifications (
                tenant_id,
                user_id,
                lead_id,
                type,
                title,
                body,
                link,
                created_at
              ) values (
                ${tenant.tenantId},
                ${lead.owner_user_id},
                ${lead.id},
                'RECYCLE_WARNING',
                '【公海临期预警】私海潜客即将超时自动释放',
                ${`您的私海线索「${lead.contact_name}」已有 ${lead.days_since_touch} 天未跟进，将于约 ${hoursRemaining} 小时后自动释放回公海，请及时跟进！`},
                ${`/leads/${lead.id}`},
                now()
              )
            `);
          }
        }
      }
    }

    // 2) LEAD_UNCONVERTED 临期（复用主扫描窗口口径：days_since_claim）
    if (unconvertedRule) {
      const thresholdDays = unconvertedRule.thresholdDays;
      const notifyHours = unconvertedRule.notifyBeforeHours || 24;
      const warnDaysThreshold = thresholdDays - notifyHours / 24;
      const leads = await tx.execute<{
        id: string;
        contact_name: string;
        company_name: string | null;
        owner_user_id: string;
        owner_name: string;
        days_since_claim: number;
      }>(sql`
        select
          l.id,
          l.contact_name,
          l.company_name,
          l.owner_user_id,
          u.name as owner_name,
          extract(day from (now() - coalesce(l.claimed_at, l.created_at)))::integer as days_since_claim
        from public.leads l
        join public.users u on u.id = l.owner_user_id
        where l.tenant_id = ${tenant.tenantId}
          and l.owner_user_id is not null
          and l.status not in ('CONVERTED', 'DISCARDED')
          and l.deleted_at is null
        group by l.id, l.contact_name, l.company_name, l.owner_user_id, u.name, l.claimed_at, l.created_at
      `);
      for (const lead of leads.rows) {
        if (lead.days_since_claim >= warnDaysThreshold && lead.days_since_claim < thresholdDays) {
          const daysLeft = thresholdDays - lead.days_since_claim;
          const hoursRemaining = Math.max(1, Math.round(daysLeft * 24));
          warningItems.push({
            id: lead.id,
            name: lead.contact_name + (lead.company_name ? ` (${lead.company_name})` : ""),
            entityType: "LEAD",
            ownerUserId: lead.owner_user_id,
            ownerName: lead.owner_name,
            daysSinceTouch: lead.days_since_claim,
            hoursRemaining,
            thresholdDays,
          });
          const recentNotif = await tx.execute<{ id: string }>(sql`
            select id from public.notifications
            where tenant_id = ${tenant.tenantId}
              and user_id = ${lead.owner_user_id}
              and lead_id = ${lead.id}
              and type = 'RECYCLE_WARNING'
              and created_at > now() - interval '24 hours'
            limit 1
          `);
          if (recentNotif.rows.length === 0) {
            await tx.execute(sql`
              insert into public.notifications (
                tenant_id,
                user_id,
                lead_id,
                type,
                title,
                body,
                link,
                created_at
              ) values (
                ${tenant.tenantId},
                ${lead.owner_user_id},
                ${lead.id},
                'RECYCLE_WARNING',
                '【公海临期预警】私海线索未转化即将释放',
                ${`您的私海线索「${lead.contact_name}」已认领 ${lead.days_since_claim} 天未成单，将于约 ${hoursRemaining} 小时后自动释放回公海，请及时推进转化！`},
                ${`/leads/${lead.id}`},
                now()
              )
            `);
          }
        }
      }
    }

    // 3) CUSTOMER_INACTIVE 临期（复用主扫描窗口口径：days_since_touch，排除有进行中商机客户）
    if (inactiveRule) {
      const thresholdDays = inactiveRule.thresholdDays;
      const notifyHours = inactiveRule.notifyBeforeHours || 48;
      const warnDaysThreshold = thresholdDays - notifyHours / 24;
      const customers = await tx.execute<{
        id: string;
        name: string;
        owner_user_id: string;
        owner_name: string;
        days_since_touch: number;
      }>(sql`
        select
          c.id,
          c.name,
          c.owner_user_id,
          u.name as owner_name,
          extract(day from (now() - coalesce(max(a.created_at), c.created_at)))::integer as days_since_touch
        from public.customers c
        join public.users u on u.id = c.owner_user_id
        left join public.activities a on a.customer_id = c.id
        where c.tenant_id = ${tenant.tenantId}
          and c.owner_user_id is not null
          and c.deleted_at is null
          and not exists (
            select 1 from public.opportunities o
            where o.tenant_id = c.tenant_id
              and o.customer_id = c.id
              and o.deleted_at is null
              and o.stage not in ('WON', 'LOST')
          )
        group by c.id, c.name, c.owner_user_id, u.name, c.created_at
      `);
      for (const cust of customers.rows) {
        if (cust.days_since_touch >= warnDaysThreshold && cust.days_since_touch < thresholdDays) {
          const daysLeft = thresholdDays - cust.days_since_touch;
          const hoursRemaining = Math.max(1, Math.round(daysLeft * 24));
          warningItems.push({
            id: cust.id,
            name: cust.name,
            entityType: "CUSTOMER",
            ownerUserId: cust.owner_user_id,
            ownerName: cust.owner_name,
            daysSinceTouch: cust.days_since_touch,
            hoursRemaining,
            thresholdDays,
          });
          const recentNotif = await tx.execute<{ id: string }>(sql`
            select id from public.notifications
            where tenant_id = ${tenant.tenantId}
              and user_id = ${cust.owner_user_id}
              and type = 'RECYCLE_WARNING'
              and link = ${`/customers/${cust.id}`}
              and created_at > now() - interval '24 hours'
            limit 1
          `);
          if (recentNotif.rows.length === 0) {
            await tx.execute(sql`
              insert into public.notifications (
                tenant_id,
                user_id,
                type,
                title,
                body,
                link,
                created_at
              ) values (
                ${tenant.tenantId},
                ${cust.owner_user_id},
                'RECYCLE_WARNING',
                '【公海临期预警】沉睡客户即将释放',
                ${`您的客户「${cust.name}」已有 ${cust.days_since_touch} 天无跟进，将于约 ${hoursRemaining} 小时后自动释放回公海，请及时跟进！`},
                ${`/customers/${cust.id}`},
                now()
              )
            `);
          }
        }
      }
    }

    return {
      warningCount: warningItems.length,
      warnings: warningItems,
    };
  });
}

