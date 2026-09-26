import { sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/core/tenant";
import { zonedYearMonth } from "@/core/shared/tz";

export type LeaderboardPeriod = "DAILY" | "WEEKLY" | "MONTHLY";

export type SalesLeaderboardItem = {
  rank: number;
  userId: string;
  userName: string;
  departmentName: string | null;
  wonAmount: number;
  wonDealsCount: number;
  activitiesCount: number;
  newOppsCount: number;
  isCurrentUser: boolean;
};

export type CurrentUserGamification = {
  rank: number;
  wonAmount: number;
  targetQuota: number;
  attainmentRate: number;
  activitiesCount: number;
  currentTierName: string;
  currentCommissionRate: number;
  nextTierName: string;
  nextCommissionRate: number;
  nextTierGapAmount: number;
};

export type SalesLeaderboardData = {
  period: LeaderboardPeriod;
  items: SalesLeaderboardItem[];
  topGun: SalesLeaderboardItem | null;
  currentUserGamification: CurrentUserGamification;
};

export async function getSalesLeaderboardService(
  tenant: TenantContext,
  period: LeaderboardPeriod = "MONTHLY",
): Promise<SalesLeaderboardData> {
  return withTenant(tenant.tenantId, async (tx) => {
    // 根据 period 确定起止时间过滤条件
    // 业务时区口径截断（数据库会话时区可能是 UTC，直接 date_trunc 会偏 8 小时）
    let startTimestampSql = sql`(date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;

    if (period === "DAILY") {
      startTimestampSql = sql`(date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;
    } else if (period === "WEEKLY") {
      startTimestampSql = sql`(date_trunc('week', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`;
    }

    // 聚合各销售专员的业绩与行为数据
    const result = await tx.execute<{
      user_id: string;
      user_name: string;
      department_name: string | null;
      won_amount: string;
      won_deals_count: string;
      activities_count: string;
      new_opps_count: string;
    }>(sql`
      with sales_users as (
        select u.id, u.name, d.name as department_name
        from public.users u
        left join public.departments d on d.id = u.department_id and d.tenant_id = u.tenant_id
        where u.tenant_id = ${tenant.tenantId} and u.status = 'ACTIVE' and u.role in ('SALES', 'MANAGER')
      ),
      won_deals as (
        select
          owner_user_id,
          coalesce(sum(actual_amount), 0) as total_won_amount,
          count(*) as total_won_count
        from public.opportunities o
        where o.tenant_id = ${tenant.tenantId}
          and o.stage = 'WON'
          and (
            o.actual_close_at >= ${startTimestampSql}
            or (
              o.actual_close_at is null
              -- 历史数据缺成交时间的兜底：用阶段流转到 WON 的真实时间，
              -- 而非 updated_at（改备注也会刷新 updated_at，会造成"补个备注就上榜"）
              and exists (
                select 1 from opportunity_stage_history h
                where h.opportunity_id = o.id and h.to_stage = 'WON'
                  and h.created_at >= ${startTimestampSql}
              )
            )
          )
          and o.deleted_at is null
        group by o.owner_user_id
      ),
      activities_stat as (
        select
          user_id,
          count(*) as total_activities
        from public.activities
        where tenant_id = ${tenant.tenantId}
          and occurred_at >= ${startTimestampSql}
        group by user_id
      ),
      new_opps_stat as (
        select
          owner_user_id,
          count(*) as total_new_opps
        from public.opportunities o
        where o.tenant_id = ${tenant.tenantId}
          and created_at >= ${startTimestampSql}
          and deleted_at is null
        group by owner_user_id
      )
      select
        su.id as user_id,
        su.name as user_name,
        su.department_name,
        coalesce(wd.total_won_amount, 0)::text as won_amount,
        coalesce(wd.total_won_count, 0)::text as won_deals_count,
        coalesce(act.total_activities, 0)::text as activities_count,
        coalesce(nopp.total_new_opps, 0)::text as new_opps_count
      from sales_users su
      left join won_deals wd on wd.owner_user_id = su.id
      left join activities_stat act on act.user_id = su.id
      left join new_opps_stat nopp on nopp.owner_user_id = su.id
      order by coalesce(wd.total_won_amount, 0) desc, coalesce(act.total_activities, 0) desc, su.name asc
    `);

    const items: SalesLeaderboardItem[] = result.rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      userName: row.user_name,
      departmentName: row.department_name,
      wonAmount: Number(row.won_amount || 0),
      wonDealsCount: Number(row.won_deals_count || 0),
      activitiesCount: Number(row.activities_count || 0),
      newOppsCount: Number(row.new_opps_count || 0),
      isCurrentUser: row.user_id === tenant.userId,
    }));

    const topGun = items.length > 0 && items[0].wonAmount > 0 ? items[0] : null;

    // 计算当前登录销售的目标完成率与提成阶梯
    const currentItem = items.find((i) => i.isCurrentUser) || {
      rank: items.length + 1,
      wonAmount: 0,
      activitiesCount: 0,
    };

    // 动态查询当前登录销售在真实数据库中配置的目标配额 (sales_quotas)
    const ym = zonedYearMonth();
    const currentYear = ym.year;
    const currentMonthNum = ym.month;
    const currentMonthKey = `${currentYear}-M${String(currentMonthNum).padStart(2, "0")}`;

    const quotaRes = await tx.execute<{ target_amount_cents: string }>(sql`
      select target_amount_cents
      from public.sales_quotas
      where tenant_id = ${tenant.tenantId}
        and user_id = ${tenant.userId}
        and year = ${currentYear}
        and period_type = 'MONTHLY'
        and period_key = ${currentMonthKey}
      limit 1
    `);

    const targetQuota = quotaRes.rows.length > 0 ? Number(quotaRes.rows[0].target_amount_cents) : 20000000;
    const wonAmt = currentItem.wonAmount;
    // 达成率与提成阶梯分母按周期折算：月度目标/月阶梯 → 按日占月比例或周口径折算
    // 换算规则：日榜分母 = 月度目标 / 当月天数；周榜分母 = 月度目标 *7 / 当月天数（按周占月比例）
    const daysInMonth = new Date(currentYear, currentMonthNum, 0).getDate();
    let periodTargetQuota = targetQuota;
    let periodTierFactor = 1;
    if (period === "DAILY") {
      periodTargetQuota = Math.round(targetQuota / daysInMonth);
      periodTierFactor = 1 / daysInMonth;
    } else if (period === "WEEKLY") {
      periodTargetQuota = Math.round((targetQuota * 7) / daysInMonth);
      periodTierFactor = 7 / daysInMonth;
    }
    const attainmentRate = periodTargetQuota > 0 ? Math.round((wonAmt / periodTargetQuota) * 100) : 0;

    // 阶梯提成测算模型（按周期折算后阈值）：
    // 月度 Tier 1: 0 - 10万 (3%), Tier 2: 10万 - 20万 (6%), Tier 3: 20万 - 50万 (10%), Tier 4: 50万以上 (15%)
    // 日/周榜阈值按 periodTierFactor 折算
    const tier1 = Math.round(10000000 * periodTierFactor);
    const tier2 = Math.round(20000000 * periodTierFactor);
    const tier3 = Math.round(50000000 * periodTierFactor);
    let currentTierName = "基础档 (3%)";
    let currentCommissionRate = 3;
    let nextTierName = "达标档 (6%)";
    let nextCommissionRate = 6;
    let nextTierGapAmount = Math.max(tier1 - wonAmt, 0);

    if (wonAmt >= tier3) {
      currentTierName = "荣耀顶峰 (15%)";
      currentCommissionRate = 15;
      nextTierName = "已达最高档";
      nextCommissionRate = 15;
      nextTierGapAmount = 0;
    } else if (wonAmt >= tier2) {
      currentTierName = "冲刺档 (10%)";
      currentCommissionRate = 10;
      nextTierName = "荣耀顶峰 (15%)";
      nextCommissionRate = 15;
      nextTierGapAmount = tier3 - wonAmt;
    } else if (wonAmt >= tier1) {
      currentTierName = "达标档 (6%)";
      currentCommissionRate = 6;
      nextTierName = "冲刺档 (10%)";
      nextCommissionRate = 10;
      nextTierGapAmount = tier2 - wonAmt;
    }

    return {
      period,
      items,
      topGun,
      currentUserGamification: {
        rank: currentItem.rank,
        wonAmount: wonAmt,
        targetQuota,
        attainmentRate,
        activitiesCount: currentItem.activitiesCount,
        currentTierName,
        currentCommissionRate,
        nextTierName,
        nextCommissionRate,
        nextTierGapAmount,
      },
    };
  });
}
