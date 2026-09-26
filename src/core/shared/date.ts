/**
 * 用户可见的日期/日期时间解析与展示，统一按业务时区（Asia/Shanghai）解释：
 * 用户在中国选 "2026-08-24"，无论部署环境的 TZ 是什么，都解释为上海墙钟
 * 的 2026-08-24 00:00（绝对时刻 2026-08-23T16:00Z）。
 * 此前按服务器本地时区解释，部署到 UTC 容器会整体偏 8 小时。
 */
import { zonedWallClock, zonedWallClockToUtc } from "./tz";

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

export function dateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const w = zonedWallClock(date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function localDateValue(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const w = zonedWallClock(date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return zonedWallClockToUtc(year, month, day);
}

export function parseLocalDateTime(value: string): Date {
  const [date, time = "00:00"] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return zonedWallClockToUtc(year, month, day, hour, minute);
}

export function startOfLocalDay(value = new Date()): Date {
  const w = zonedWallClock(value);
  return zonedWallClockToUtc(w.year, w.month, w.day);
}

export function sqlDate(value?: string | Date | null): string | null {
  if (!value) return null;
  const res = localDateValue(value);
  return res || null;
}

export function getShanghaiDateString(value: string | Date | null = new Date()): string {
  return localDateValue(value);
}

export function addShanghaiDays(days: number, fromDate: Date = new Date()): string {
  return localDateValue(new Date(fromDate.getTime() + days * 86400000));
}

/**
 * 格式化为 MM/DD。接受两种输入：
 * - 纯日期 `YYYY-MM-DD`：直接取月日（无时区语义，不应做时区换算）
 * - 完整时间戳（含 T 或时区偏移）：按业务时区折算到当地日期再取月日。
 *   若不做折算，UTC 时间戳在上海凌晨会被显示成前一天（如 17:36Z 应为次日）。
 */
export function formatDateOnly(value: string): string {
  const pureDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (pureDate) return `${pureDate[2]}/${pureDate[3]}`;

  const dateOnly = localDateValue(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  return match ? `${match[2]}/${match[3]}` : value;
}
