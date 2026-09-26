import { describe, expect, it } from "vitest";
import { BUSINESS_TZ, zonedMonthStart, zonedWeekStart, zonedYearStart, zonedYearMonth } from "@/core/shared/tz";

/**
 * 时区口径统一回归：业务"月初/周一/年初/当月"一律按中国时区（Asia/Shanghai）
 * 计算绝对时刻，与服务器本地时区、数据库会话时区解耦。
 * 各断言的期望值均为「上海墙钟时刻对应的 UTC 绝对时刻」（+08:00）。
 */
describe("业务时区边界计算 (Asia/Shanghai 口径)", () => {
  it("8 月初 = UTC 7-31 16:00", () => {
    expect(zonedMonthStart(2026, 8).toISOString()).toBe("2026-07-31T16:00:00.000Z");
  });

  it("1 月初跨年 = UTC 上一年 12-31 16:00", () => {
    expect(zonedMonthStart(2026, 1).toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  it("12 月初 = UTC 11-30 16:00", () => {
    expect(zonedMonthStart(2026, 12).toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });

  it("月初次月推进 = 9 月初为 UTC 8-31 16:00", () => {
    expect(zonedMonthStart(2026, 9).toISOString()).toBe("2026-08-31T16:00:00.000Z");
  });

  it("周一（ISO 周）起点：2026-08-24 周一 → UTC 8-23 16:00", () => {
    expect(zonedWeekStart(new Date("2026-08-24T03:00:00Z")).toISOString()).toBe("2026-08-23T16:00:00.000Z");
  });

  it("周日归位到上周一：2026-08-23 周日 → 同一周一", () => {
    expect(zonedWeekStart(new Date("2026-08-23T03:00:00Z")).toISOString()).toBe("2026-08-16T16:00:00.000Z");
  });

  it("年初 = UTC 上一年 12-31 16:00", () => {
    expect(zonedYearStart(2027).toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });

  it("当月判定：UTC 月末 20:00（上海次月 1 日凌晨）属次月", () => {
    // 2026-08-31T20:00Z = 上海 2026-09-01 04:00 → 业务口径应判 9 月
    const ym = zonedYearMonth(new Date("2026-08-31T20:00:00Z"));
    expect(ym).toEqual({ year: 2026, month: 9 });
  });

  it("当月判定：UTC 月初 02:00（上海仍为本月）属本月", () => {
    // 2026-08-01T02:00Z = 上海 2026-08-01 10:00 → 8 月
    const ym = zonedYearMonth(new Date("2026-08-01T02:00:00Z"));
    expect(ym).toEqual({ year: 2026, month: 8 });
  });

  it("当月判定：UTC 1-01 02:00 跨年属新年份", () => {
    // 2027-01-01T02:00Z = 上海 2027-01-01 10:00 → 2027 年 1 月
    const ym = zonedYearMonth(new Date("2027-01-01T02:00:00Z"));
    expect(ym).toEqual({ year: 2027, month: 1 });
  });

  it("结果与运行环境本地时区无关（America/New_York 下同一绝对时刻同判）", async () => {
    // Intl API 的 timeZone 参数是绝对语义；此用例验证实现未偷用本地 getMonth()
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const script = `
      import { zonedYearMonth } from "./src/core/shared/tz";
      console.log(JSON.stringify(zonedYearMonth(new Date("2026-08-31T20:00:00Z"))));
    `;
    const { stdout } = await run("npx", ["tsx", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: "America/New_York" },
    });
    expect(JSON.parse(stdout.trim())).toEqual({ year: 2026, month: 9 });
  });

  it("业务时区常量显式声明", () => {
    expect(BUSINESS_TZ).toBe("Asia/Shanghai");
  });
});

describe("shared/date 业务时区口径（用户输入解析与展示）", () => {
  it("TZ=UTC 环境下解析/展示/当天零点均按上海墙钟（部署到 UTC 容器不偏 8 小时）", async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const script = `
      import { parseLocalDate, parseLocalDateTime, localDateValue, startOfLocalDay, dateInputValue } from "./src/core/shared/date";
      const eq = (a, b, label) => { if (a !== b) { console.error(label + " 实际=" + a + " 期望=" + b); process.exit(1); } };
      eq(parseLocalDate("2026-08-24").toISOString(), "2026-08-23T16:00:00.000Z", "parseLocalDate");
      eq(parseLocalDateTime("2026-08-24T09:30").toISOString(), "2026-08-24T01:30:00.000Z", "parseLocalDateTime");
      eq(localDateValue(new Date("2026-08-23T16:00:00Z")), "2026-08-24", "localDateValue");
      eq(startOfLocalDay(new Date("2026-08-23T16:00:00Z")).toISOString(), "2026-08-23T16:00:00.000Z", "startOfLocalDay");
      eq(dateInputValue(new Date("2026-08-23T16:00:00Z")), "2026-08-24T00:00", "dateInputValue");
      console.log("OK");
    `;
    const { stdout } = await run("npx", ["tsx", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: "UTC" },
    });
    expect(stdout.trim()).toBe("OK");
  });
});

describe("analytics 周期 SQL 筛选条件时区口径 (getPeriodSqlFilter)", () => {
  it("DATE 列使用单重上海时间截断，不带双重时区转换以避免 UTC 会话 ::date 偏移一天", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { getPeriodSqlFilter } = await import("@/core/analytics/service");
    const dialect = new PgDialect();
    const filter = getPeriodSqlFilter("month", "o.actual_close_at", "date");
    const queryStr = dialect.sqlToQuery(filter).sql;

    expect(queryStr).toContain("o.actual_close_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai'))::date");
    expect(queryStr).not.toContain("at time zone 'Asia/Shanghai')::date at time zone 'Asia/Shanghai'");
  });

  it("TIMESTAMPTZ 列比对到上海时区零点对应的绝对时间戳", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { getPeriodSqlFilter } = await import("@/core/analytics/service");
    const dialect = new PgDialect();
    const filter = getPeriodSqlFilter("month", "a.occurred_at", "timestamptz");
    const queryStr = dialect.sqlToQuery(filter).sql;

    // 下界必须写成 ::date::timestamp at time zone：PG 对 `date AT TIME ZONE` 的解析会先把
    // date 隐式提升为 timestamptz 再转墙钟（方向相反，下界偏晚 8 小时），已在真库验证
    expect(queryStr).toContain("a.occurred_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai')");
  });
});

