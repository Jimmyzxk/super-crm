/**
 * 周期（配额周期 / 统计窗口）统一口径。
 *
 * 为什么收敛到本模块：
 * 1. sales_quotas.period_key 的字符串格式是"配额唯一键"的一部分，历史上
 *    analytics 用硬编码常量当目标、BI 用 `substring(0,7)` 生成 key，三处各写
 *    一份格式导致 BI 的 `period_key = '2026-09'` 永远匹配不到 quota 表里真实
 *    存的 `2026-M09`，达成率恒为 0。格式只能有一份实现。
 * 2. timestamptz 列的周期边界在 UTC 会话下会整体偏 8 小时，必须显式
 *    `at time zone 'Asia/Shanghai'`，同样不允许各写各的。
 *
 * 业务时区常量来自 shared/tz（Asia/Shanghai），所有边界按该时区墙钟计算。
 */

import { sql, type SQL } from "drizzle-orm";
import { BUSINESS_TZ, zonedMonthStart, zonedYearMonth, zonedYearStart } from "./tz";

export type QuotaPeriodType = "MONTHLY" | "QUARTERLY" | "YEARLY";

/**
 * 生成 sales_quotas.period_key（唯一键组成部分，格式变更即历史数据失联）：
 * - MONTHLY  → `2026-M09`
 * - QUARTERLY→ `2026-Q3`
 * - YEARLY   → `2026`
 * month 为 1-12；QUARTERLY 忽略 month 参数。
 */
export function buildQuotaPeriodKey(year: number, periodType: QuotaPeriodType, month: number): string {
  if (periodType === "MONTHLY") {
    const m = Math.min(12, Math.max(1, Math.trunc(month)));
    return `${year}-M${String(m).padStart(2, "0")}`;
  }
  if (periodType === "QUARTERLY") {
    const q = Math.min(4, Math.max(1, Math.ceil(Math.min(12, Math.max(1, Math.trunc(month))) / 3)));
    return `${year}-Q${q}`;
  }
  return `${year}`;
}

/** 解析 period_key 中的月/季度序号（宽松：兼容 `2026-M09` / `M09` / `09` / `9` / `Q3` / `3`） */
export function parsePeriodKeyParts(periodKey: string): { month?: number; quarter?: number } {
  if (/Q/i.test(periodKey)) {
    const m = periodKey.match(/(?:^|[-_Q])([1-4])$/i);
    const quarter = m ? parseInt(m[1], 10) : 1;
    return { quarter };
  }
  const m = periodKey.match(/(?:^|[-_M])(\d{1,2})$/i);
  if (!m) return {};
  const month = parseInt(m[1], 10);
  if (month < 1 || month > 12) return {};
  return { month };
}

/**
 * 解析配额周期的起止绝对时刻（左闭右开，end 为周期次日/次季/次年起点）。
 * 与 getSalesQuotaAttainmentDashboard 的成交口径共用同一实现，避免两页周期漂移。
 */
export function quotaPeriodDateRange(
  year: number,
  periodType: QuotaPeriodType,
  periodKey: string,
): { start: Date; end: Date } {
  if (periodType === "MONTHLY") {
    const { month } = parsePeriodKeyParts(periodKey);
    const m = month ?? 1;
    // 业务时区口径的月初绝对时刻（月份溢出由 Date.UTC 天然进位到次年 1 月）
    return { start: zonedMonthStart(year, m), end: zonedMonthStart(year, m + 1) };
  }
  if (periodType === "QUARTERLY") {
    const { quarter } = parsePeriodKeyParts(periodKey);
    const q = quarter ?? 1;
    const startMonth = (q - 1) * 3 + 1; // 1-based
    return { start: zonedMonthStart(year, startMonth), end: zonedMonthStart(year, startMonth + 3) };
  }
  return { start: zonedYearStart(year), end: zonedYearStart(year + 1) };
}

/** 解析"当期"配额周期：默认按业务时区的当前月 */
export function resolveQuotaPeriod(params?: {
  year?: number;
  periodType?: QuotaPeriodType;
  periodKey?: string;
  at?: Date;
}): { year: number; periodType: QuotaPeriodType; periodKey: string } {
  const ym = zonedYearMonth(params?.at ?? new Date());
  const year = params?.year ?? ym.year;
  const periodType: QuotaPeriodType = params?.periodType ?? "MONTHLY";
  const periodKey = params?.periodKey ?? buildQuotaPeriodKey(year, periodType, ym.month);
  return { year, periodType, periodKey };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 由显式统计窗口（YYYY-MM-DD 起止）反推其对应的配额周期。
 * 仅当窗口与某个自然周期**完全对齐**时返回该周期；任意滚动窗口（如近 30 天）
 * 不对应任何配额桶，返回 periodType=null —— 调用方据此显式展示"未配置目标"，
 * 绝不用硬编码常量伪造一个目标值。
 */
export function detectQuotaPeriodFromDateRange(
  startDate: string,
  endDate: string,
): { year: number; periodType: QuotaPeriodType; periodKey: string } | null {
  if (!DATE_ONLY.test(startDate) || !DATE_ONLY.test(endDate)) return null;
  const startYear = Number(startDate.slice(0, 4));
  const startMonth = Number(startDate.slice(5, 7));
  const startDay = Number(startDate.slice(8, 10));
  const endYear = Number(endDate.slice(0, 4));
  const endMonth = Number(endDate.slice(5, 7));
  const endDay = Number(endDate.slice(8, 10));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return null;

  // 自然年：01-01 ~ 12-31
  if (
    startYear === endYear &&
    startMonth === 1 && startDay === 1 &&
    endMonth === 12 && endDay === 31
  ) {
    return { year: startYear, periodType: "YEARLY", periodKey: buildQuotaPeriodKey(startYear, "YEARLY", 1) };
  }

  // 自然季：季度首月 1 日 ~ 同季度末月最后一日
  if (startYear === endYear) {
    const q = Math.ceil(startMonth / 3);
    const qStartMonth = (q - 1) * 3 + 1;
    const qEndMonth = qStartMonth + 2;
    if (
      startMonth === qStartMonth && startDay === 1 &&
      endMonth === qEndMonth && endDay === lastDayOfMonth(endYear, qEndMonth)
    ) {
      return { year: startYear, periodType: "QUARTERLY", periodKey: buildQuotaPeriodKey(startYear, "QUARTERLY", startMonth) };
    }
  }

  // 自然月：1 日 ~ 当月最后一日
  if (startYear === endYear && endMonth === startMonth && startDay === 1 && endDay === lastDayOfMonth(endYear, startMonth)) {
    return { year: startYear, periodType: "MONTHLY", periodKey: buildQuotaPeriodKey(startYear, "MONTHLY", startMonth) };
  }

  return null;
}

/**
 * timestamptz 列的业务周期区间 SQL 条件（左闭右开，按业务时区墙钟）。
 *
 * 为什么必须显式 at time zone：
 * created_at 等是 timestamptz，`col >= $1::date` 会把 DATE 按**会话时区**隐式
 * 当作午夜；在 UTC 会话里 `2026-09-01 00:30 +08:00`（= 08-31T16:30Z）会被判为
 * `2026-08-31 00:00Z < x < 2026-09-01 00:00Z` 之外，月初 8 小时的记录被漏掉。
 *
 * 为什么下界必须写成 `$1::date::timestamp at time zone '...'`，而不能只写
 * `$1::date at time zone '...'`：
 * PG 对 `date AT TIME ZONE zone` 的运算符解析会先把 date **隐式提升为
 * timestamptz**（按会话时区解释），再转成该时区的墙钟 timestamp 返回 —— 方向正好
 * 相反：`'2026-09-01'::date at time zone 'Asia/Shanghai'` 在 UTC 会话里返回
 * `2026-09-01 08:00:00`（naive），与 timestamptz 列比较时等价于 09-01T08:00Z，
 * 下界偏晚 8 小时。显式 `::timestamp` 后才得到正确的 `2026-08-31 16:00:00+00`。
 * 上界天然正确：`date + interval '1 day'` 的结果类型就是 timestamp。
 */
export function timestamptzPeriodRangeSql(colName: string, startDate: string, endDate: string): SQL {
  const col = sql.raw(colName);
  // BUSINESS_TZ 是模块常量（非用户输入），以字面量注入，保证生成的 SQL 文本可审计比对
  const tz = sql.raw(`'${BUSINESS_TZ}'`);
  return sql`and ${col} >= ((${startDate}::date::timestamp) at time zone ${tz})
      and ${col} < (((${endDate}::date) + interval '1 day') at time zone ${tz})`;
}
