/**
 * 业务时区统一口径：所有"月/周/年边界"与"当期年月判定"一律按
 * 中国时区（Asia/Shanghai）计算绝对时刻。
 *
 * 为什么：此前配额/排行榜用 new Date(y, m, 1)（依赖服务器本地时区）、
 * SQL 用 date_trunc('month', now())（依赖数据库会话时区）——部署到
 * UTC 容器时月初会偏 8 小时，"每月 1 日 0-8 点"的窗口内统计错期。
 * 统一收敛到本模块后，业务口径与部署环境彻底解耦。
 *
 * 实现说明：Intl.DateTimeFormat 的 timeZone 参数是绝对语义（不受
 * process.env.TZ 影响），formatToParts 可反解任意时区的墙钟分量，
 * 据此构造 UTC 绝对时刻；offset 用两轮逼近修正边界日的夏令时跳变
 * （上海无夏令时，但实现保持通用，换时区常量即可复用）。
 */

export const BUSINESS_TZ = "Asia/Shanghai";

const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** 业务时区下的墙钟分量（24 小时制） */
function wallClock(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number } {
  const parts = wallClockFormatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24, // 24:00 会被格式化为 "24"，归一为 0
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: date.getUTCDay(), // 由调用方仅在需要 ISO 周时另行计算
  };
}

function offsetMs(date: Date): number {
  const w = wallClock(date);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - date.getTime();
}

/** 将业务时区墙钟 (y, m, d, [hh, mm]) 转为 UTC 绝对时刻（两轮逼近修正偏移） */
export function zonedWallClockToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = new Date(target - offsetMs(new Date(target)));
  const secondOffset = offsetMs(result);
  if (secondOffset !== offsetMs(new Date(target))) {
    result = new Date(target - secondOffset);
  }
  return result;
}

/** 当前时刻在业务时区下的墙钟分量（日粒度展示/解析用） */
export function zonedWallClock(at: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number } {
  const w = wallClock(at);
  return { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute };
}

/** 业务时区某月月初 00:00 的绝对时刻。month 为 1-12。 */
export function zonedMonthStart(year: number, month: number): Date {
  return zonedWallClockToUtc(year, month, 1);
}

/** 业务时区某年年初 1-01 00:00 的绝对时刻 */
export function zonedYearStart(year: number): Date {
  return zonedWallClockToUtc(year, 1, 1);
}

/** 给定时刻所在 ISO 周（周一）起点 00:00 的绝对时刻 */
export function zonedWeekStart(at: Date = new Date()): Date {
  const w = wallClock(at);
  // ISO 周一为一周之始：周日(0)归到上周一，其余回退 (weekday-1) 天
  const jsWeekday = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    weekday: "short",
  }).format(at);
  const weekdayIndex: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const back = weekdayIndex[jsWeekday] ?? 0;
  return zonedWallClockToUtc(w.year, w.month, w.day - back);
}

/** 给定时刻在业务时区下所属的年月（用于"当期"判定，如当月配额键） */
export function zonedYearMonth(at: Date = new Date()): { year: number; month: number } {
  const w = wallClock(at);
  return { year: w.year, month: w.month };
}
