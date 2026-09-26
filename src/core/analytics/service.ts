import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { resolveQuotaPeriod, type QuotaPeriodType } from "@/core/shared/period";

/** 团队级聚合与演示数据涉及全租户经营数据，仅主管/管理员可读可操作（页面分流之外的服务端兜底） */
function requireManagerOrAdmin(ctx: TenantContext): void {
  if (ctx.role !== "MANAGER" && ctx.role !== "ADMIN") {
    throw new BusinessError("FORBIDDEN", "你没有权限查看团队级经营数据");
  }
}
import {
  STAGE_PROBABILITIES,
  type AgingBucket,
  type AnalyticsFilterParams,
  type AnalyticsPeriod,
  type ExecutiveForecastData,
  type ForecastTiers,
  type IndustryMetric,
  type PipelineVelocityMetric,
  type RevenueTrendPoint,
  type RevOpsSlaMetrics,
  type SalesRadarData,
  type TeamFunnelData,
  type TeamMemberOption,
  type TeamTierDistribution,
} from "./types";

const lostReasonLabels: Record<string, string> = {
  NO_BUDGET: "预算不足/缩减",
  COMPETITOR: "选择了竞品",
  TIMING: "采购时机不成熟/暂缓",
  FEATURE_GAP: "功能/架构不匹配",
  AUTHORITY: "关键决策人变更",
  OTHER: "其他原因",
};

const stageNames: Record<string, string> = {
  DISCOVERY: "发现需求",
  PROPOSAL: "方案报价",
  NEGOTIATION: "商务谈判",
  WON: "赢单结单",
  LOST: "输单归档",
};

function formatSourceLabel(src: string): string {
  if (src === "manual") return "销售自拓录入";
  if (src === "import") return "批量导入";
  if (src.startsWith("api:")) return "外部 API 对接";
  if (src.startsWith("form:")) return "营销表单获客";
  return src || "未知来源";
}

/** 目标金额及其可溯源信息：未配置时 targetAmount=0 且 isTargetConfigured=false */
type QuotaTargetResult = {
  targetAmount: number;
  isTargetConfigured: boolean;
  year: number | null;
  periodType: QuotaPeriodType | null;
  periodKey: string | null;
};

type QuotaTargetsByUser = {
  byUser: Map<string, number>;
  teamTotal: number;
  isTargetConfigured: boolean;
  year: number | null;
  periodType: QuotaPeriodType | null;
  periodKey: string | null;
};

/**
 * 赢单率统一口径：won / (won + lost)。
 * 在途（DISCOVERY/PROPOSAL/NEGOTIATION）不进分母；零分母一律返回 0。
 * 历史缺陷：个人页/团队页用 won/(won+lost)，行业矩阵与 BI 插件用 won/total
 * （含在途），同一批商机在两处显示不同赢单率；且存在"无结单但有赢单额则 100%"
 * 的兜底，使两页规则不一致。现三处（个人/团队/行业矩阵）+ BI 全部同口径。
 */
export function computeWinRatePercent(wonCount: number, lostCount: number): number {
  const finished = wonCount + lostCount;
  if (finished <= 0) return 0;
  return (wonCount / finished) * 100;
}

/**
 * 动态生成时间周期筛选 SQL 条件。
 *
 * 时区口径与数据类型处理规范（Asia/Shanghai）：
 * 1. DATE 列（如 o.actual_close_at）：
 *    直接将上海时间下的月初截断转为 DATE：(date_trunc(..., now() at time zone 'Asia/Shanghai'))::date
 *    禁止再次 at time zone 'Asia/Shanghai'，否则转成 timestamptz 后在 UTC 会话中被 ::date 截断会取得前一天（上月末日期），导致下界偏移一天！
 * 2. TIMESTAMPTZ 列（如 a.occurred_at）：
 *    需精确比对到上海零点对应的绝对时刻（带时区）。
 *    注意必须写成 `::date::timestamp at time zone '...'`：`date AT TIME ZONE zone`
 *    的运算符解析会先把 date 隐式提升为 timestamptz（按会话时区解释）再转墙钟返回，
 *    方向相反，会让下界偏晚 8 小时（UTC 会话下月初 00:00-08:00 的记录被漏掉）。
 */
export function getPeriodSqlFilter(
  period?: AnalyticsPeriod,
  colName = "o.actual_close_at",
  colType?: "date" | "timestamptz",
) {
  if (period === "all") {
    return sql``;
  }
  if (period === "last30d") {
    return sql`and ${sql.raw(colName)} >= (now() - interval '30 days')`;
  }

  const truncPart = period === "quarter" ? "quarter" : period === "year" ? "year" : "month";
  const isTimestamptz = colType === "timestamptz" || (!colType && colName.includes("occurred_at"));

  if (isTimestamptz) {
    // timestamptz 列：比对上海对应周期第一天零点对应的 timestamptz 绝对时间戳
    return sql`and ${sql.raw(colName)} >= (date_trunc(${sql.raw(`'${truncPart}'`)}, now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai')`;
  }

  // DATE 列：直接转为上海墙钟 DATE，不二次转换以避免 UTC 会话 ::date 偏移一天
  return sql`and ${sql.raw(colName)} >= (date_trunc(${sql.raw(`'${truncPart}'`)}, now() at time zone 'Asia/Shanghai'))::date`;
}

/**
 * 销售目标唯一数据源 = sales_quotas（由 core/quota 读写）。
 *
 * 历史缺陷：此处曾用硬编码 `50 万元基准 × 周期倍率 × 人数倍率` 伪造目标，
 * 个人页恒显示 50 万、团队大盘恒显示 150 万，与管理员在「销售目标」页真实配置的
 * 配额完全脱节。现在改为直接查询 sales_quotas。
 *
 * 口径约定：
 * - 月/季/年周期：取该周期 period_key 下的配额之和（个人视角=本人，团队视角=全体在职销售）。
 * - 近 30 天 / 全部历史：不存在对应的配额桶，返回 0 且 isTargetConfigured=false，
 *   下游据此显示「未设置目标」，绝不用常量伪造达成率。
 * - 停用/软删用户不计入团队目标（与 quota 看板的"在职销售"成员口径一致）。
 */
async function loadQuotaTargetsByUser(
  tx: TenantTransaction,
  tenantId: string,
  params?: AnalyticsFilterParams,
): Promise<QuotaTargetsByUser> {
  const period = params?.period ?? "month";
  const periodType: QuotaPeriodType | null =
    period === "quarter" ? "QUARTERLY" : period === "year" ? "YEARLY" : period === "month" ? "MONTHLY" : null;
  if (!periodType) {
    return { byUser: new Map(), teamTotal: 0, isTargetConfigured: false, year: null, periodType: null, periodKey: null };
  }

  const { year, periodKey } = resolveQuotaPeriod({ periodType });
  const res = await tx.execute<{ userId: string; targetAmount: string | number }>(sql`
    select q.user_id as "userId", coalesce(q.target_amount_cents, 0)::bigint as "targetAmount"
    from sales_quotas q
    join users u on u.tenant_id = q.tenant_id and u.id = q.user_id
    where q.tenant_id = ${tenantId}
      and q.year = ${year}
      and q.period_type = ${periodType}
      and q.period_key = ${periodKey}
      -- users 表无软删列，停用（status='DISABLED'）即视为离岗，不计入团队目标与分母
      and u.status = 'ACTIVE'
  `);
  const byUser = new Map<string, number>();
  let teamTotal = 0;
  for (const r of res.rows) {
    const amt = Number(r.targetAmount || 0);
    byUser.set(r.userId, amt);
    teamTotal += amt;
  }
  return {
    byUser,
    teamTotal,
    isTargetConfigured: teamTotal > 0,
    year,
    periodType,
    periodKey,
  };
}

async function loadQuotaTarget(
  tx: TenantTransaction,
  tenantId: string,
  params: AnalyticsFilterParams | undefined,
  scope: { kind: "user"; userId?: string } | { kind: "team" },
): Promise<QuotaTargetResult> {
  const all = await loadQuotaTargetsByUser(tx, tenantId, params);
  if (scope.kind === "team") {
    return {
      targetAmount: all.teamTotal,
      isTargetConfigured: all.isTargetConfigured,
      year: all.year,
      periodType: all.periodType,
      periodKey: all.periodKey,
    };
  }
  const userId = scope.userId;
  const targetAmount = userId ? all.byUser.get(userId) ?? 0 : 0;
  return {
    targetAmount,
    isTargetConfigured: targetAmount > 0,
    year: all.year,
    periodType: all.periodType,
    periodKey: all.periodKey,
  };
}

// 辅助计算商机库龄结构
function buildAgingBuckets(rows: Array<{ ageDays: number; amount: number }>): AgingBucket[] {
  let c1 = 0, a1 = 0;
  let c2 = 0, a2 = 0;
  let c3 = 0, a3 = 0;
  let c4 = 0, a4 = 0;

  for (const r of rows) {
    if (r.ageDays <= 7) {
      c1++;
      a1 += r.amount;
    } else if (r.ageDays <= 15) {
      c2++;
      a2 += r.amount;
    } else if (r.ageDays <= 30) {
      c3++;
      a3 += r.amount;
    } else {
      c4++;
      a4 += r.amount;
    }
  }

  const totalCount = Math.max(1, c1 + c2 + c3 + c4);

  return [
    { bucketKey: "0-7d", label: "0-7天 (新鲜活跃)", count: c1, amount: a1, percentage: Math.round((c1 / totalCount) * 1000) / 10 },
    { bucketKey: "8-15d", label: "8-15天 (正常推进)", count: c2, amount: a2, percentage: Math.round((c2 / totalCount) * 1000) / 10 },
    { bucketKey: "16-30d", label: "16-30天 (预警滞留)", count: c3, amount: a3, percentage: Math.round((c3 / totalCount) * 1000) / 10 },
    { bucketKey: "30d+", label: "30天以上 (严重老化)", count: c4, amount: a4, percentage: Math.round((c4 / totalCount) * 1000) / 10 },
  ];
}

// 辅助计算销售速率 (Pipeline Velocity = (N * S * W) / T)
function computeVelocity(activeDealsCount: number, avgDealSize: number, winRatePercent: number, cycleDays: number): PipelineVelocityMetric {
  if (activeDealsCount === 0 || avgDealSize === 0) {
    return {
      activeDealsCount: 0,
      avgDealSize: 0,
      winRate: Math.round(winRatePercent * 10) / 10,
      avgCycleDays: Math.max(1, cycleDays),
      velocityDailyAmount: 0,
      velocityMonthlyAmount: 0,
    };
  }

  const wDecimal = Math.max(0.01, Math.min(1.0, winRatePercent / 100));
  const safeCycle = Math.max(1, cycleDays);
  const dailyVelocity = Math.round((activeDealsCount * avgDealSize * wDecimal) / safeCycle);
  const monthlyVelocity = dailyVelocity * 30;

  return {
    activeDealsCount,
    avgDealSize,
    winRate: Math.round(winRatePercent * 10) / 10,
    avgCycleDays: safeCycle,
    velocityDailyAmount: dailyVelocity,
    velocityMonthlyAmount: monthlyVelocity,
  };
}

// 辅助生成近 6 个月趋势数据
function generateMonthlyTrends(
  wonRows: Array<{ monthKey: string; wonAmount: string; wonCount: string }>,
  newRows: Array<{ monthKey: string; newCount: string }>
): RevenueTrendPoint[] {
  const now = new Date();
  const points: RevenueTrendPoint[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    const label = `${d.getMonth() + 1}月`;

    const won = wonRows.find((r) => r.monthKey === key);
    const created = newRows.find((r) => r.monthKey === key);

    points.push({
      periodKey: key,
      label,
      wonAmount: Number(won?.wonAmount || 0),
      wonCount: Number(won?.wonCount || 0),
      newDealsCount: Number(created?.newCount || 0),
    });
  }

  return points;
}

// 获取团队成员下拉列表
export async function listAnalyticsTeamMembersService(ctx: TenantContext): Promise<TeamMemberOption[]> {
  requireManagerOrAdmin(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{ id: string; name: string; role: string }>(sql`
      select id, name, role::text as role
      from users
      where tenant_id = ${ctx.tenantId} and status = 'ACTIVE'
      order by name asc
    `);
    return res.rows;
  });
}

// -------------------------------------------------------------
// 1. 销售个人罗盘服务 (面向一线销售，完全动态计算)
// -------------------------------------------------------------
export async function getSalesRadarService(
  ctx: TenantContext,
  params?: AnalyticsFilterParams
): Promise<SalesRadarData> {
  const targetUserId = (ctx.role === "MANAGER" || ctx.role === "ADMIN") && params?.ownerUserId
    ? params.ownerUserId
    : ctx.userId;

  const periodWonFilter = getPeriodSqlFilter(params?.period, "o.actual_close_at");

  return withTenant(ctx.tenantId, async (tx) => {
    const [wonMonthRes, winRateRes, activeOppsRes, leadsCountRes, tasksCountRes, wonTrendsRes, newTrendsRes] = await Promise.all([
      tx.execute<{ amount: string; count: string }>(sql`
        select
          coalesce(sum(o.actual_amount), 0)::text as amount,
          count(*)::text as count
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.stage = 'WON'
          and o.deleted_at is null
          ${periodWonFilter}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        wonTotal: string;
        lostTotal: string;
        avgWonAmount: string;
        avgCycleDays: string;
        avgPipelineAmount: string;
      }>(sql`
        select
          count(*) filter (where o.stage = 'WON')::text as "wonTotal",
          count(*) filter (where o.stage = 'LOST')::text as "lostTotal",
          coalesce(avg(o.actual_amount) filter (where o.stage = 'WON'), 0)::text as "avgWonAmount",
          coalesce(avg(extract(epoch from (o.actual_close_at at time zone 'Asia/Shanghai' - o.created_at)) / 86400) filter (where o.stage = 'WON'), 0)::text as "avgCycleDays",
          coalesce(avg(o.expected_amount) filter (where o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')), 0)::text as "avgPipelineAmount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.deleted_at is null
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        count: string;
        pipelineAmount: string;
        weightedAmount: string;
        commitAmount: string;
        aging0_7_count: string;
        aging0_7_amount: string;
        aging8_15_count: string;
        aging8_15_amount: string;
        aging16_30_count: string;
        aging16_30_amount: string;
        aging30p_count: string;
        aging30p_amount: string;
      }>(sql`
        select
          count(*)::text as count,
          coalesce(sum(coalesce(o.expected_amount,0)),0)::text as "pipelineAmount",
          coalesce(sum(case when o.stage='DISCOVERY' then coalesce(o.expected_amount,0)*0.2 when o.stage='PROPOSAL' then coalesce(o.expected_amount,0)*0.5 when o.stage='NEGOTIATION' then coalesce(o.expected_amount,0)*0.8 else 0 end),0)::text as "weightedAmount",
          coalesce(sum(case when o.stage='NEGOTIATION' then coalesce(o.expected_amount,0)*0.8 else 0 end),0)::text as "commitAmount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) <=7)::text as "aging0_7_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) <=7),0)::text as "aging0_7_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 8 and 15)::text as "aging8_15_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 8 and 15),0)::text as "aging8_15_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 16 and 30)::text as "aging16_30_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 16 and 30),0)::text as "aging16_30_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) >30)::text as "aging30p_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) >30),0)::text as "aging30p_amount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.deleted_at is null
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{ count: string }>(sql`
        select count(*)::text as count
        from leads
        where tenant_id = ${ctx.tenantId}
          and owner_user_id = ${targetUserId}
          and status in ('NEW', 'CONTACTED', 'QUALIFIED')
          and deleted_at is null
      `),
      tx.execute<{ overdueCount: string; todayCount: string }>(sql`
        select
          count(*) filter (where due_at < now())::text as "overdueCount",
          count(*) filter (where due_at >= now() and due_at < (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai') + interval '1 day')::text as "todayCount"
        from tasks
        where tenant_id = ${ctx.tenantId}
          and assignee_user_id = ${targetUserId}
          and status = 'OPEN'
      `),
      // 近6个月赢单月度趋势 (完全基于真实数据库流水)
      tx.execute<{ monthKey: string; wonAmount: string; wonCount: string }>(sql`
        select
          to_char(o.actual_close_at, 'YYYY-MM') as "monthKey",
          coalesce(sum(o.actual_amount), 0)::text as "wonAmount",
          count(*)::text as "wonCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.stage = 'WON'
          and o.actual_close_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
      // 近6个月新建商机月度趋势
      tx.execute<{ monthKey: string; newCount: string }>(sql`
        select
          to_char(o.created_at, 'YYYY-MM') as "monthKey",
          count(*)::text as "newCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.created_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
    ]);

    const wonMonthAmount = Number(wonMonthRes.rows[0]?.amount || 0);
    const wonCount = Number(winRateRes.rows[0]?.wonTotal || 0);
    const lostCount = Number(winRateRes.rows[0]?.lostTotal || 0);
    const personalWinRate = computeWinRatePercent(wonCount, lostCount);
    const avgDealSize = wonCount > 0
      ? Math.round(Number(winRateRes.rows[0]?.avgWonAmount || 0))
      : Math.round(Number(winRateRes.rows[0]?.avgPipelineAmount || 0));
    const avgCycleDays = wonCount > 0 ? Math.max(1, Math.round(Number(winRateRes.rows[0]?.avgCycleDays || 1))) : 1;

    // 计算三档预测与库龄结构（SQL 聚合，避免全量拉行）
    const agg = activeOppsRes.rows[0];
    const pipelineAmount = Number(agg?.pipelineAmount || 0);
    const weightedPipelineAmount = Math.round(Number(agg?.weightedAmount || 0));
    const commitPipelineAmount = Math.round(Number(agg?.commitAmount || 0));
    const activeCount = Number(agg?.count || 0);
    // 直接拼桶（已聚合，避免全量拉行）
    const pipelineAging: AgingBucket[] = (() => {
      const c1 = Number(agg?.aging0_7_count || 0), a1 = Number(agg?.aging0_7_amount || 0);
      const c2 = Number(agg?.aging8_15_count || 0), a2 = Number(agg?.aging8_15_amount || 0);
      const c3 = Number(agg?.aging16_30_count || 0), a3 = Number(agg?.aging16_30_amount || 0);
      const c4 = Number(agg?.aging30p_count || 0), a4 = Number(agg?.aging30p_amount || 0);
      const total = Math.max(1, c1+c2+c3+c4);
      return [
        { bucketKey: "0-7d", label: "0-7天 (新鲜活跃)", count: c1, amount: a1, percentage: Math.round((c1/total)*1000)/10 },
        { bucketKey: "8-15d", label: "8-15天 (正常推进)", count: c2, amount: a2, percentage: Math.round((c2/total)*1000)/10 },
        { bucketKey: "16-30d", label: "16-30天 (预警滞留)", count: c3, amount: a3, percentage: Math.round((c3/total)*1000)/10 },
        { bucketKey: "30d+", label: "30天以上 (严重老化)", count: c4, amount: a4, percentage: Math.round((c4/total)*1000)/10 },
      ];
    })();

    const quotaTarget = await loadQuotaTarget(tx, ctx.tenantId, params, { kind: "user", userId: targetUserId });
    const dynamicTarget = quotaTarget.targetAmount;
    const targetGap = Math.max(0, dynamicTarget - wonMonthAmount);
    const coverageRatio = targetGap > 0 ? Math.round((pipelineAmount / targetGap) * 10) / 10 : (pipelineAmount > 0 ? 3.0 : 0);

    const forecast: ForecastTiers = {
      targetAmount: dynamicTarget,
      wonAmount: wonMonthAmount,
      commitAmount: wonMonthAmount + commitPipelineAmount,
      weightedAmount: wonMonthAmount + weightedPipelineAmount,
      bestCaseAmount: wonMonthAmount + pipelineAmount,
      coverageRatio,
      targetGap,
      isTargetConfigured: quotaTarget.isTargetConfigured,
      quotaPeriodType: quotaTarget.periodType,
      quotaPeriodKey: quotaTarget.periodKey,
    };

    const velocity = computeVelocity(activeCount, avgDealSize, personalWinRate, avgCycleDays);
    const monthlyTrends = generateMonthlyTrends(wonTrendsRes.rows, newTrendsRes.rows);

    // 提成预估 (5% 基础提成)
    const estimatedCommission = Math.round(wonMonthAmount * 0.05);

    // 停滞商机与重点大单
    const [stalledResult, topOppsResult] = await Promise.all([
      tx.execute<{
        id: string;
        name: string;
        customerId: string;
        customerName: string;
        stage: string;
        expectedAmount: string;
        stalledDays: string;
        lastFollowupAt: string | null;
      }>(sql`
        select
          o.id,
          o.name,
          c.id as "customerId",
          c.name as "customerName",
          o.stage::text as stage,
          coalesce(o.expected_amount, 0)::text as "expectedAmount",
          greatest(1, floor(extract(epoch from (now() - coalesce(o.stage_entered_at, o.updated_at))) / 86400))::text as "stalledDays",
          (
            select max(occurred_at)::text
            from activities a
            where a.tenant_id = o.tenant_id and a.opportunity_id = o.id
          ) as "lastFollowupAt"
        from opportunities o
        join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.deleted_at is null
          and (now() - coalesce(o.stage_entered_at, o.updated_at)) > interval '14 days'
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        order by coalesce(o.expected_amount, 0) desc, o.updated_at asc
        limit 5
      `),
      tx.execute<{
        id: string;
        name: string;
        customerName: string;
        stage: string;
        expectedAmount: string;
        expectedCloseAt: string | null;
      }>(sql`
        select
          o.id,
          o.name,
          c.name as "customerName",
          o.stage::text as stage,
          coalesce(o.expected_amount, 0)::text as "expectedAmount",
          o.expected_close_at::text as "expectedCloseAt"
        from opportunities o
        join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
        where o.tenant_id = ${ctx.tenantId}
          and o.owner_user_id = ${targetUserId}
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.deleted_at is null
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        order by coalesce(o.expected_amount, 0) desc
        limit 5
      `),
    ]);

    return {
      forecast,
      velocity,
      estimatedCommission,
      activeOpportunitiesCount: activeCount,
      myActiveLeadsCount: Number(leadsCountRes.rows[0]?.count || 0),
      overdueTasksCount: Number(tasksCountRes.rows[0]?.overdueCount || 0),
      todayTasksCount: Number(tasksCountRes.rows[0]?.todayCount || 0),
      pipelineAging,
      monthlyTrends,
      stalledOpportunities: stalledResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        customerId: r.customerId,
        customerName: r.customerName,
        stage: r.stage,
        expectedAmount: Number(r.expectedAmount),
        stalledDays: Number(r.stalledDays),
        lastFollowupAt: r.lastFollowupAt,
      })),
      topOpportunities: topOppsResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        customerName: r.customerName,
        stage: r.stage,
        expectedAmount: Number(r.expectedAmount),
        expectedCloseAt: r.expectedCloseAt,
      })),
    };
  });
}

// -------------------------------------------------------------
// 2. 团队效能与漏斗诊断服务 (面向主管与经理，完全动态计算)
// -------------------------------------------------------------
export async function getTeamEfficiencyService(
  ctx: TenantContext,
  params?: AnalyticsFilterParams
): Promise<TeamFunnelData> {
  requireManagerOrAdmin(ctx);
  const periodWonFilter = getPeriodSqlFilter(params?.period, "o.actual_close_at", "date");
  const periodActivityFilter = getPeriodSqlFilter(params?.period, "a.occurred_at", "timestamptz");

  return withTenant(ctx.tenantId, async (tx) => {
    // A. 团队全局成单周期、赢单率与活跃商机
    const [teamWonStatsRes, activeDealsRes, slaStatsRes, wonTrendsRes, newTrendsRes] = await Promise.all([
      tx.execute<{
        wonCount: string;
        lostCount: string;
        avgDealSize: string;
        avgCycleDays: string;
        avgPipelineAmount: string;
      }>(sql`
        select
          count(*) filter (where o.stage = 'WON')::text as "wonCount",
          count(*) filter (where o.stage = 'LOST')::text as "lostCount",
          coalesce(avg(o.actual_amount) filter (where o.stage = 'WON'), 0)::text as "avgDealSize",
          coalesce(avg(extract(epoch from (o.actual_close_at at time zone 'Asia/Shanghai' - o.created_at)) / 86400) filter (where o.stage = 'WON'), 0)::text as "avgCycleDays",
          coalesce(avg(o.expected_amount) filter (where o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')), 0)::text as "avgPipelineAmount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{ count: string }>(sql`
        select count(*)::text as count
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        totalFirstRespTasks: string;
        ontimeFirstRespTasks: string;
        activitiesInPeriod: string;
        avgFirstRespHours: string;
        totalOpenTasks: string;
        overdueOpenTasks: string;
      }>(sql`
        select
          count(*) filter (where t.type = 'FIRST_RESPONSE')::text as "totalFirstRespTasks",
          count(*) filter (where t.type = 'FIRST_RESPONSE' and (t.status = 'DONE' or t.due_at >= now()))::text as "ontimeFirstRespTasks",
          (
            select count(*)::text
            from activities a
            where a.tenant_id = ${ctx.tenantId}
              ${periodActivityFilter}
              ${params?.ownerUserId ? sql`and a.user_id = ${params.ownerUserId}` : sql``}
          ) as "activitiesInPeriod",
          (
            select coalesce(avg(extract(epoch from (a.occurred_at - l.created_at)) / 3600), 0)::text
            from activities a
            join leads l on l.tenant_id = a.tenant_id and l.id = a.lead_id
            where a.tenant_id = ${ctx.tenantId}
              ${params?.ownerUserId ? sql`and a.user_id = ${params.ownerUserId}` : sql``}
          ) as "avgFirstRespHours",
          count(*) filter (where t.status = 'OPEN')::text as "totalOpenTasks",
          count(*) filter (where t.status = 'OPEN' and t.due_at < now())::text as "overdueOpenTasks"
        from tasks t
        where t.tenant_id = ${ctx.tenantId}
          ${params?.ownerUserId ? sql`and t.assignee_user_id = ${params.ownerUserId}` : sql``}
      `),
      // 近6个月赢单趋势
      tx.execute<{ monthKey: string; wonAmount: string; wonCount: string }>(sql`
        select
          to_char(o.actual_close_at, 'YYYY-MM') as "monthKey",
          coalesce(sum(o.actual_amount), 0)::text as "wonAmount",
          count(*)::text as "wonCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage = 'WON'
          and o.actual_close_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
      // 近6个月新建趋势
      tx.execute<{ monthKey: string; newCount: string }>(sql`
        select
          to_char(o.created_at, 'YYYY-MM') as "monthKey",
          count(*)::text as "newCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.created_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
    ]);

    const wonCount = Number(teamWonStatsRes.rows[0]?.wonCount || 0);
    const lostCount = Number(teamWonStatsRes.rows[0]?.lostCount || 0);
    const winRate = computeWinRatePercent(wonCount, lostCount);
    const avgDealSize = wonCount > 0
      ? Math.round(Number(teamWonStatsRes.rows[0]?.avgDealSize || 0))
      : Math.round(Number(teamWonStatsRes.rows[0]?.avgPipelineAmount || 0));
    const avgCycleDays = wonCount > 0 ? Math.max(1, Math.round(Number(teamWonStatsRes.rows[0]?.avgCycleDays || 1))) : 1;
    const activeDealsCount = Number(activeDealsRes.rows[0]?.count || 0);

    const velocity = computeVelocity(activeDealsCount, avgDealSize, winRate, avgCycleDays);
    const monthlyTrends = generateMonthlyTrends(wonTrendsRes.rows, newTrendsRes.rows);

    // B. 真实 SLA 质检指标
    const totalResp = Number(slaStatsRes.rows[0]?.totalFirstRespTasks || 0);
    const ontimeResp = Number(slaStatsRes.rows[0]?.ontimeFirstRespTasks || 0);
    const totalOpen = Number(slaStatsRes.rows[0]?.totalOpenTasks || 0);
    const overdueOpen = Number(slaStatsRes.rows[0]?.overdueOpenTasks || 0);
    const realAvgHours = Math.round(Number(slaStatsRes.rows[0]?.avgFirstRespHours || 0) * 10) / 10;

    const sla: RevOpsSlaMetrics = {
      firstResponseSlaRate: totalResp > 0 ? Math.round((ontimeResp / totalResp) * 1000) / 10 : 100,
      avgFirstResponseHours: realAvgHours,
      followupFrequency30d: Number(slaStatsRes.rows[0]?.activitiesInPeriod || 0),
      overdueTaskRate: totalOpen > 0 ? Math.round((overdueOpen / totalOpen) * 1000) / 10 : 0,
    };

    // C. 7 步全链路 L2C 转化漏斗与流失损耗 (Drop-off)
    const [leadsTotalRes, contactedRes, qualifiedRes, convertedRes, proposalRes, negotiationRes, wonRes] = await Promise.all([
      tx.execute<{ count: string }>(sql`select count(*)::text as count from leads where tenant_id = ${ctx.tenantId} and deleted_at is null ${params?.ownerUserId ? sql`and owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(*)::text as count from leads where tenant_id = ${ctx.tenantId} and status in ('CONTACTED', 'QUALIFIED', 'CONVERTED') and deleted_at is null ${params?.ownerUserId ? sql`and owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(*)::text as count from leads where tenant_id = ${ctx.tenantId} and status in ('QUALIFIED', 'CONVERTED') and deleted_at is null ${params?.ownerUserId ? sql`and owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(*)::text as count from leads where tenant_id = ${ctx.tenantId} and status = 'CONVERTED' and deleted_at is null ${params?.ownerUserId ? sql`and owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(distinct o.id)::text as count from opportunities o join opportunity_stage_history h on h.opportunity_id = o.id where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and h.to_stage in ('PROPOSAL', 'NEGOTIATION', 'WON') ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(distinct o.id)::text as count from opportunities o join opportunity_stage_history h on h.opportunity_id = o.id where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and h.to_stage in ('NEGOTIATION', 'WON') ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}`),
      tx.execute<{ count: string }>(sql`select count(*)::text as count from opportunities where tenant_id = ${ctx.tenantId} and stage = 'WON' and deleted_at is null ${params?.ownerUserId ? sql`and owner_user_id = ${params.ownerUserId}` : sql``}`),
    ]);

    const stepRaw = [
      { stepKey: "LEAD_INBOUND", stepName: "线索进线", count: Number(leadsTotalRes.rows[0]?.count || 0) },
      { stepKey: "LEAD_CONTACTED", stepName: "初步跟进", count: Number(contactedRes.rows[0]?.count || 0) },
      { stepKey: "LEAD_QUALIFIED", stepName: "需求确认", count: Number(qualifiedRes.rows[0]?.count || 0) },
      { stepKey: "CUSTOMER_CONVERTED", stepName: "转客户立项", count: Number(convertedRes.rows[0]?.count || 0) },
      { stepKey: "OPP_PROPOSAL", stepName: "方案报价", count: Number(proposalRes.rows[0]?.count || 0) },
      { stepKey: "OPP_NEGOTIATION", stepName: "商务谈判", count: Number(negotiationRes.rows[0]?.count || 0) },
      { stepKey: "OPP_WON", stepName: "签约赢单", count: Number(wonRes.rows[0]?.count || 0) },
    ];

    const baseCount = Math.max(1, stepRaw[0].count);
    const funnelSteps = stepRaw.map((step, idx) => {
      const prevCount = idx === 0 ? step.count : Math.max(1, stepRaw[idx - 1].count);
      const dropCount = idx === 0 ? 0 : Math.max(0, stepRaw[idx - 1].count - step.count);
      return {
        stepKey: step.stepKey,
        stepName: step.stepName,
        count: step.count,
        dropCount,
        dropAmount: dropCount * avgDealSize,
        conversionRateFromPrevious: step.count === 0 ? 0 : Math.min(100, Math.round((step.count / prevCount) * 1000) / 10),
        conversionRateFromStart: step.count === 0 ? 0 : Math.min(100, Math.round((step.count / baseCount) * 1000) / 10),
      };
    });

    // D. 各商机阶段停留周期与沉淀资金
    const stagesVelocityResult = await tx.execute<{
      stage: string;
      activeCount: string;
      activeAmount: string;
      avgDays: string;
    }>(sql`
      select
        o.stage::text,
        count(*)::text as "activeCount",
        coalesce(sum(o.expected_amount), 0)::text as "activeAmount",
        coalesce(avg(extract(epoch from (now() - coalesce(o.stage_entered_at, o.created_at))) / 86400), 1)::text as "avgDays"
      from opportunities o
      left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = ${ctx.tenantId}
        and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
        and o.deleted_at is null
        ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
        ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
        ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      group by o.stage
    `);

    const stageVelocities = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"].map((st) => {
      const found = stagesVelocityResult.rows.find((r) => r.stage === st);
      return {
        stage: st,
        stageName: stageNames[st] || st,
        avgDays: Math.round(Number(found?.avgDays || 1) * 10) / 10,
        activeCount: Number(found?.activeCount || 0),
        activeAmount: Number(found?.activeAmount || 0),
      };
    });

    // E. 团队成员人效矩阵与阶梯分布（合并为 GROUP BY 单条，避免 N*子查询）
    const membersResult = await tx.execute<{
      userId: string;
      userName: string;
      role: string;
      activeLeadsCount: string;
      activeOpportunitiesCount: string;
      monthWonAmount: string;
      monthWonCount: string;
      recentActivitiesCount: string;
      overdueTasksCount: string;
    }>(sql`
      with won_agg as (
        select
          o.owner_user_id as user_id,
          coalesce(sum(o.actual_amount),0)::text as won_amount,
          count(*)::text as won_count
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId} and o.stage='WON' and o.deleted_at is null
          ${periodWonFilter}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by o.owner_user_id
      ),
      lead_agg as (
        select owner_user_id as user_id, count(*)::text as cnt
        from leads
        where tenant_id = ${ctx.tenantId} and status in ('NEW','CONTACTED','QUALIFIED') and deleted_at is null
        group by owner_user_id
      ),
      opp_agg as (
        select owner_user_id as user_id, count(*)::text as cnt
        from opportunities
        where tenant_id = ${ctx.tenantId} and stage in ('DISCOVERY','PROPOSAL','NEGOTIATION') and deleted_at is null
        group by owner_user_id
      ),
      act_agg as (
        select user_id, count(*)::text as cnt
        from activities a
        where a.tenant_id = ${ctx.tenantId} ${periodActivityFilter}
        group by user_id
      ),
      task_agg as (
        select assignee_user_id as user_id, count(*)::text as cnt
        from tasks
        where tenant_id = ${ctx.tenantId} and status='OPEN' and due_at < now()
        group by assignee_user_id
      )
      select
        u.id as "userId",
        u.name as "userName",
        u.role::text as role,
        coalesce(lead_agg.cnt,'0') as "activeLeadsCount",
        coalesce(opp_agg.cnt,'0') as "activeOpportunitiesCount",
        coalesce(won_agg.won_amount,'0') as "monthWonAmount",
        coalesce(won_agg.won_count,'0') as "monthWonCount",
        coalesce(act_agg.cnt,'0') as "recentActivitiesCount",
        coalesce(task_agg.cnt,'0') as "overdueTasksCount"
      from users u
      left join lead_agg on lead_agg.user_id = u.id
      left join opp_agg on opp_agg.user_id = u.id
      left join won_agg on won_agg.user_id = u.id
      left join act_agg on act_agg.user_id = u.id
      left join task_agg on task_agg.user_id = u.id
      where u.tenant_id = ${ctx.tenantId}
        and u.status = 'ACTIVE'
        ${params?.ownerUserId ? sql`and u.id = ${params.ownerUserId}` : sql``}
      order by coalesce(won_agg.won_amount::bigint,0) desc, u.name asc
    `);

    // 每个组员按 sales_quotas 中**本人**的当期配额计算达成率（历史实现对所有人套用同一个
    // 硬编码目标，无法区分高低配额的销售）；未配置配额者 isTargetConfigured=false、达成率 0。
    const quotaTargets = await loadQuotaTargetsByUser(tx, ctx.tenantId, params);
    let topTier = 0;
    let midTier = 0;
    let rampTier = 0;
    let totalWonSum = 0;
    let totalTargetSum = 0;
    let configuredRepCount = 0;

    const memberMetrics = membersResult.rows.map((r) => {
      const wonAmt = Number(r.monthWonAmount || 0);
      totalWonSum += wonAmt;
      const repTarget = quotaTargets.byUser.get(r.userId) ?? 0;
      const hasTarget = repTarget > 0;
      if (hasTarget) {
        totalTargetSum += repTarget;
        configuredRepCount++;
      }
      const quotaAttainment = hasTarget ? Math.round((wonAmt / repTarget) * 100) : 0;

      if (quotaAttainment >= 100) topTier++;
      else if (quotaAttainment >= 60) midTier++;
      else rampTier++;

      return {
        userId: r.userId,
        userName: r.userName,
        role: r.role,
        activeLeadsCount: Number(r.activeLeadsCount),
        activeOpportunitiesCount: Number(r.activeOpportunitiesCount),
        monthWonAmount: wonAmt,
        monthWonCount: Number(r.monthWonCount),
        quotaAttainment,
        isTargetConfigured: hasTarget,
        targetAmount: repTarget,
        recentActivitiesCount: Number(r.recentActivitiesCount),
        overdueTasksCount: Number(r.overdueTasksCount),
      };
    });

    const repCount = Math.max(1, memberMetrics.length);
    const tierDistribution: TeamTierDistribution = {
      topTierCount: topTier,
      midTierCount: midTier,
      rampTierCount: rampTier,
      // 团队平均达成率分母只取"已配置配额"的销售，与 quota 看板团队达成率口径一致
      avgQuotaAttainment: configuredRepCount > 0 ? Math.round((totalWonSum / totalTargetSum) * 100) : 0,
      avgRepWonAmount: Math.round(totalWonSum / repCount),
      isTargetConfigured: quotaTargets.isTargetConfigured,
    };

    // F. 渠道质量与 ROI 对比
    const sourceResult = await tx.execute<{
      source: string;
      totalLeads: string;
      qualifiedCount: string;
      convertedCount: string;
      wonAmount: string;
    }>(sql`
      select
        l.source,
        count(distinct l.id)::text as "totalLeads",
        count(distinct l.id) filter (where l.status in ('QUALIFIED', 'CONVERTED'))::text as "qualifiedCount",
        count(distinct l.id) filter (where l.status = 'CONVERTED')::text as "convertedCount",
        coalesce(sum(case when o.stage = 'WON' and o.deleted_at is null then o.actual_amount else 0 end), 0)::text as "wonAmount"
      from leads l
      left join lead_conversions lc on lc.tenant_id = l.tenant_id and lc.lead_id = l.id
      left join opportunities o on o.tenant_id = l.tenant_id and o.id = lc.opportunity_id
      where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null
        ${params?.ownerUserId ? sql`and l.owner_user_id = ${params.ownerUserId}` : sql``}
      group by l.source
      order by count(distinct l.id) desc
      limit 6
    `);

    const sourceQualities = sourceResult.rows.map((r) => {
      const tot = Number(r.totalLeads || 0);
      const conv = Number(r.convertedCount || 0);
      return {
        source: r.source,
        sourceName: formatSourceLabel(r.source),
        totalLeads: tot,
        qualifiedCount: Number(r.qualifiedCount || 0),
        convertedCount: conv,
        wonAmount: Number(r.wonAmount || 0),
        conversionRate: tot > 0 ? Math.round((conv / tot) * 1000) / 10 : 0,
      };
    });

    return {
      velocity,
      sla,
      tierDistribution,
      monthlyTrends,
      funnelSteps,
      stageVelocities,
      memberMetrics,
      sourceQualities,
    };
  });
}

// -------------------------------------------------------------
// 3. 经营大盘与营收预测服务 (面向管理层与高管，完全动态计算)
// -------------------------------------------------------------
export async function getExecutiveForecastService(
  ctx: TenantContext,
  params?: AnalyticsFilterParams
): Promise<ExecutiveForecastData> {
  requireManagerOrAdmin(ctx);
  const periodWonFilter = getPeriodSqlFilter(params?.period, "o.actual_close_at");

  return withTenant(ctx.tenantId, async (tx) => {
    // A. 统计所选周期赢单与全局商机
    const [quarterWonRes, pipelineRes, cycleRes, customerTypeRes, industryRes, lostAttributionRes, wonTrendsRes, newTrendsRes] = await Promise.all([
      tx.execute<{ amount: string; count: string }>(sql`
        select
          coalesce(sum(o.actual_amount), 0)::text as amount,
          count(*)::text as count
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage = 'WON'
          and o.deleted_at is null
          ${periodWonFilter}
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        count: string;
        pipelineAmount: string;
        weightedAmount: string;
        commitAmount: string;
        aging0_7_count: string;
        aging0_7_amount: string;
        aging8_15_count: string;
        aging8_15_amount: string;
        aging16_30_count: string;
        aging16_30_amount: string;
        aging30p_count: string;
        aging30p_amount: string;
      }>(sql`
        select
          count(*)::text as count,
          coalesce(sum(coalesce(o.expected_amount,0)),0)::text as "pipelineAmount",
          coalesce(sum(case when o.stage='DISCOVERY' then coalesce(o.expected_amount,0)*0.2 when o.stage='PROPOSAL' then coalesce(o.expected_amount,0)*0.5 when o.stage='NEGOTIATION' then coalesce(o.expected_amount,0)*0.8 else 0 end),0)::text as "weightedAmount",
          coalesce(sum(case when o.stage='NEGOTIATION' then coalesce(o.expected_amount,0)*0.8 else 0 end),0)::text as "commitAmount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) <=7)::text as "aging0_7_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) <=7),0)::text as "aging0_7_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 8 and 15)::text as "aging8_15_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 8 and 15),0)::text as "aging8_15_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 16 and 30)::text as "aging16_30_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) between 16 and 30),0)::text as "aging16_30_amount",
          count(*) filter (where floor(extract(epoch from (now()-o.created_at))/86400) >30)::text as "aging30p_count",
          coalesce(sum(coalesce(o.expected_amount,0)) filter (where floor(extract(epoch from (now()-o.created_at))/86400) >30),0)::text as "aging30p_amount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        wonCount: string;
        lostCount: string;
        avgDealSize: string;
        avgCycleDays: string;
        avgPipelineAmount: string;
      }>(sql`
        select
          count(*) filter (where o.stage = 'WON')::text as "wonCount",
          count(*) filter (where o.stage = 'LOST')::text as "lostCount",
          coalesce(avg(o.actual_amount) filter (where o.stage = 'WON'), 0)::text as "avgDealSize",
          coalesce(avg(extract(epoch from (o.actual_close_at at time zone 'Asia/Shanghai' - o.created_at)) / 86400) filter (where o.stage = 'WON'), 0)::text as "avgCycleDays",
          coalesce(avg(o.expected_amount) filter (where o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')), 0)::text as "avgPipelineAmount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
      `),
      tx.execute<{
        customerType: string;
        wonAmount: string;
        wonCount: string;
        avgDealSize: string;
      }>(sql`
        select
          coalesce(c.customer_type::text, 'ENTERPRISE') as "customerType",
          coalesce(sum(o.actual_amount), 0)::text as "wonAmount",
          count(o.id)::text as "wonCount",
          coalesce(avg(o.actual_amount), 0)::text as "avgDealSize"
        from opportunities o
        join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
        where o.tenant_id = ${ctx.tenantId}
          and o.stage = 'WON'
          and o.deleted_at is null
          ${periodWonFilter}
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by c.customer_type
      `),
      tx.execute<{
        industry: string | null;
        totalDeals: string;
        wonCount: string;
        lostCount: string;
        wonAmount: string;
        avgDealSize: string;
      }>(sql`
        select
          c.industry,
          count(o.id)::text as "totalDeals",
          count(o.id) filter (where o.stage = 'WON')::text as "wonCount",
          count(o.id) filter (where o.stage = 'LOST')::text as "lostCount",
          coalesce(sum(o.actual_amount) filter (where o.stage = 'WON'), 0)::text as "wonAmount",
          coalesce(avg(o.actual_amount) filter (where o.stage = 'WON'), 0)::text as "avgDealSize"
        from opportunities o
        join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id and c.deleted_at is null
        where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
        group by c.industry
        order by count(o.id) desc
        limit 6
      `),
      tx.execute<{
        lostReason: string | null;
        count: string;
        lostAmount: string;
      }>(sql`
        select
          o.lost_reason::text as "lostReason",
          count(*)::text as count,
          coalesce(sum(o.expected_amount), 0)::text as "lostAmount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage = 'LOST'
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by o.lost_reason
        order by count(*) desc
      `),
      // 全局6个月趋势
      tx.execute<{ monthKey: string; wonAmount: string; wonCount: string }>(sql`
        select
          to_char(o.actual_close_at, 'YYYY-MM') as "monthKey",
          coalesce(sum(o.actual_amount), 0)::text as "wonAmount",
          count(*)::text as "wonCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.stage = 'WON'
          and o.actual_close_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
      tx.execute<{ monthKey: string; newCount: string }>(sql`
        select
          to_char(o.created_at, 'YYYY-MM') as "monthKey",
          count(*)::text as "newCount"
        from opportunities o
        left join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
        where o.tenant_id = ${ctx.tenantId}
          and o.created_at >= now() - interval '6 months'
          and o.deleted_at is null
          ${params?.ownerUserId ? sql`and o.owner_user_id = ${params.ownerUserId}` : sql``}
          ${params?.customerType ? sql`and c.customer_type = ${params.customerType}` : sql``}
          ${params?.industry ? sql`and c.industry = ${params.industry}` : sql``}
        group by "monthKey"
        order by "monthKey" asc
      `),
    ]);

    const periodWonAmount = Number(quarterWonRes.rows[0]?.amount || 0);
    const globalWonCount = Number(cycleRes.rows[0]?.wonCount || 0);
    const globalLostCount = Number(cycleRes.rows[0]?.lostCount || 0);
    const globalWinRate = computeWinRatePercent(globalWonCount, globalLostCount);
    const avgDealSize = globalWonCount > 0
      ? Math.round(Number(cycleRes.rows[0]?.avgDealSize || 0))
      : Math.round(Number(cycleRes.rows[0]?.avgPipelineAmount || 0));
    const avgSalesCycleDays = globalWonCount > 0 ? Math.max(1, Math.round(Number(cycleRes.rows[0]?.avgCycleDays || 1))) : 1;

    // 计算三档预测与库龄（SQL 聚合）
    const execAgg = pipelineRes.rows[0];
    const periodPipelineAmount = Number(execAgg?.pipelineAmount || 0);
    const periodWeightedForecast = Math.round(Number(execAgg?.weightedAmount || 0));
    const periodCommitAmount = Math.round(Number(execAgg?.commitAmount || 0));
    const execActiveCount = Number(execAgg?.count || 0);
    const pipelineAging: AgingBucket[] = (() => {
      const c1 = Number(execAgg?.aging0_7_count || 0), a1 = Number(execAgg?.aging0_7_amount || 0);
      const c2 = Number(execAgg?.aging8_15_count || 0), a2 = Number(execAgg?.aging8_15_amount || 0);
      const c3 = Number(execAgg?.aging16_30_count || 0), a3 = Number(execAgg?.aging16_30_amount || 0);
      const c4 = Number(execAgg?.aging30p_count || 0), a4 = Number(execAgg?.aging30p_amount || 0);
      const total = Math.max(1, c1+c2+c3+c4);
      return [
        { bucketKey: "0-7d", label: "0-7天 (新鲜活跃)", count: c1, amount: a1, percentage: Math.round((c1/total)*1000)/10 },
        { bucketKey: "8-15d", label: "8-15天 (正常推进)", count: c2, amount: a2, percentage: Math.round((c2/total)*1000)/10 },
        { bucketKey: "16-30d", label: "16-30天 (预警滞留)", count: c3, amount: a3, percentage: Math.round((c3/total)*1000)/10 },
        { bucketKey: "30d+", label: "30天以上 (严重老化)", count: c4, amount: a4, percentage: Math.round((c4/total)*1000)/10 },
      ];
    })();

    // 团队大盘目标 = 该租户当期**全体在职销售**的 sales_quotas 配额之和（历史实现为
    // 硬编码 50 万 × 3 = 150 万，与真实配置完全脱节）
    const teamQuotaTarget = await loadQuotaTarget(tx, ctx.tenantId, params, { kind: "team" });
    const dynamicTarget = teamQuotaTarget.targetAmount;
    const targetGap = Math.max(0, dynamicTarget - periodWonAmount);
    const forecastCoverageRatio = targetGap > 0 ? Math.round((periodPipelineAmount / targetGap) * 10) / 10 : (periodPipelineAmount > 0 ? 3.2 : 0);

    const forecast: ForecastTiers = {
      targetAmount: dynamicTarget,
      wonAmount: periodWonAmount,
      commitAmount: periodWonAmount + periodCommitAmount,
      weightedAmount: periodWonAmount + periodWeightedForecast,
      bestCaseAmount: periodWonAmount + periodPipelineAmount,
      coverageRatio: forecastCoverageRatio,
      targetGap,
      isTargetConfigured: teamQuotaTarget.isTargetConfigured,
      quotaPeriodType: teamQuotaTarget.periodType,
      quotaPeriodKey: teamQuotaTarget.periodKey,
    };

    const velocity = computeVelocity(execActiveCount, avgDealSize, globalWinRate, avgSalesCycleDays);
    const monthlyTrends = generateMonthlyTrends(wonTrendsRes.rows, newTrendsRes.rows);

    // 客户主体类型贡献
    let enterpriseWonAmount = 0;
    let enterpriseWonCount = 0;
    let enterpriseAvgDealSize = 0;
    let individualWonAmount = 0;
    let individualWonCount = 0;
    let individualAvgDealSize = 0;

    for (const ct of customerTypeRes.rows) {
      if (ct.customerType === "INDIVIDUAL") {
        individualWonAmount = Number(ct.wonAmount);
        individualWonCount = Number(ct.wonCount);
        individualAvgDealSize = Math.round(Number(ct.avgDealSize));
      } else {
        enterpriseWonAmount = Number(ct.wonAmount);
        enterpriseWonCount = Number(ct.wonCount);
        enterpriseAvgDealSize = Math.round(Number(ct.avgDealSize));
      }
    }

    // 行业细分表现
    const industryMetrics: IndustryMetric[] = industryRes.rows.map((ind) => {
      const tot = Number(ind.totalDeals || 0);
      const won = Number(ind.wonCount || 0);
      const lost = Number(ind.lostCount || 0);
      return {
        industry: ind.industry || "未指定行业",
        label: ind.industry || "通用及其他行业",
        totalDeals: tot,
        wonCount: won,
        lostCount: lost,
        wonAmount: Number(ind.wonAmount || 0),
        // 与个人页/团队页/BI 插件同口径：在途不进分母，零分母为 0
        winRate: Math.round(computeWinRatePercent(won, lost) * 10) / 10,
        avgDealSize: Math.round(Number(ind.avgDealSize || 0)),
      };
    });

    // 输单归因
    const totalLostCount = lostAttributionRes.rows.reduce((acc, cur) => acc + Number(cur.count), 0);
    const lossAttributions = lostAttributionRes.rows.map((r) => {
      const reasonKey = r.lostReason || "OTHER";
      const count = Number(r.count);
      return {
        reason: reasonKey,
        reasonLabel: lostReasonLabels[reasonKey] || "其他原因",
        count,
        lostAmount: Number(r.lostAmount),
        percentage: totalLostCount > 0 ? Math.round((count / totalLostCount) * 1000) / 10 : 0,
      };
    });

    return {
      forecast,
      velocity,
      avgDealSize,
      avgSalesCycleDays,
      winRate: Math.round(globalWinRate * 10) / 10,
      pipelineAging,
      monthlyTrends,
      industryMetrics,
      customerTypeContribution: {
        enterpriseWonAmount,
        enterpriseWonCount,
        enterpriseAvgDealSize,
        individualWonAmount,
        individualWonCount,
        individualAvgDealSize,
      },
      lossAttributions,
    };
  });
}
