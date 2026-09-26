import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildQuotaPeriodKey,
  detectQuotaPeriodFromDateRange,
  parsePeriodKeyParts,
  quotaPeriodDateRange,
  resolveQuotaPeriod,
  timestamptzPeriodRangeSql,
} from "@/core/shared/period";
import { computeWinRatePercent } from "@/core/analytics/service";

/**
 * W11-4 / W11-5 周期口径唯一实现的单元回归：
 * period_key 格式、周期起止绝对时刻、窗口→周期反推、timestamptz 边界 SQL、赢单率统一算法。
 * 这些是纯函数，直接调用真实实现断言输出（不读源码字符串）。
 */

describe("W11-4 sales_quotas period_key 格式唯一实现", () => {
  it("MONTHLY / QUARTERLY / YEARLY 键格式与 quota 看板写入格式完全一致", () => {
    expect(buildQuotaPeriodKey(2026, "MONTHLY", 9)).toBe("2026-M09");
    expect(buildQuotaPeriodKey(2026, "MONTHLY", 12)).toBe("2026-M12");
    expect(buildQuotaPeriodKey(2026, "QUARTERLY", 9)).toBe("2026-Q3");
    expect(buildQuotaPeriodKey(2026, "QUARTERLY", 1)).toBe("2026-Q1");
    expect(buildQuotaPeriodKey(2026, "YEARLY", 5)).toBe("2026");
  });

  it("resolveQuotaPeriod 缺省取业务时区当月的 M 键（UTC 月末的上海次月凌晨不得错期）", () => {
    // 2026-08-31T20:00Z = 上海 2026-09-01 04:00 → 应判 9 月
    const r = resolveQuotaPeriod({ periodType: "MONTHLY", at: new Date("2026-08-31T20:00:00Z") });
    expect(r).toEqual({ year: 2026, periodType: "MONTHLY", periodKey: "2026-M09" });
  });

  it("parsePeriodKeyParts 兼容唯一键格式与历史宽松写法", () => {
    expect(parsePeriodKeyParts("2026-M09")).toEqual({ month: 9 });
    expect(parsePeriodKeyParts("M09")).toEqual({ month: 9 });
    expect(parsePeriodKeyParts("09")).toEqual({ month: 9 });
    expect(parsePeriodKeyParts("9")).toEqual({ month: 9 });
    expect(parsePeriodKeyParts("2026-Q3")).toEqual({ quarter: 3 });
    expect(parsePeriodKeyParts("Q3")).toEqual({ quarter: 3 });
  });

  it("quotaPeriodDateRange 返回业务时区口径的左闭右开绝对时刻", () => {
    const month = quotaPeriodDateRange(2026, "MONTHLY", "2026-M09");
    expect(month.start.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(month.end.toISOString()).toBe("2026-09-30T16:00:00.000Z");

    const quarter = quotaPeriodDateRange(2026, "QUARTERLY", "2026-Q3");
    expect(quarter.start.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(quarter.end.toISOString()).toBe("2026-09-30T16:00:00.000Z");

    const year = quotaPeriodDateRange(2026, "YEARLY", "2026");
    expect(year.start.toISOString()).toBe("2025-12-31T16:00:00.000Z");
    expect(year.end.toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });
});

describe("W11-4 统计窗口 → 配额周期反推（不再只判 MONTHLY/YEARLY）", () => {
  it("自然月 / 自然季 / 自然年窗口分别反推出 MONTHLY / QUARTERLY / YEARLY", () => {
    expect(detectQuotaPeriodFromDateRange("2026-09-01", "2026-09-30")).toEqual({
      year: 2026, periodType: "MONTHLY", periodKey: "2026-M09",
    });
    expect(detectQuotaPeriodFromDateRange("2026-07-01", "2026-09-30")).toEqual({
      year: 2026, periodType: "QUARTERLY", periodKey: "2026-Q3",
    });
    expect(detectQuotaPeriodFromDateRange("2026-01-01", "2026-12-31")).toEqual({
      year: 2026, periodType: "YEARLY", periodKey: "2026",
    });
    // 2 月只有 28 天（2026 非闰年）也算完整自然月
    expect(detectQuotaPeriodFromDateRange("2026-02-01", "2026-02-28")?.periodKey).toBe("2026-M02");
  });

  it("滚动窗口（不对齐任何自然周期）返回 null，调用方据此显式标记未配置目标", () => {
    expect(detectQuotaPeriodFromDateRange("2026-09-10", "2026-10-09")).toBeNull();
    expect(detectQuotaPeriodFromDateRange("2026-09-01", "2026-09-29")).toBeNull();
    expect(detectQuotaPeriodFromDateRange("2026-08-01", "2026-10-31")).toBeNull();
    expect(detectQuotaPeriodFromDateRange("bad", "2026-09-30")).toBeNull();
  });
});

describe("W11-5 timestamptz 周期边界 SQL（Asia/Shanghai 墙钟）", () => {
  it("下界/上界都显式 at time zone Asia/Shanghai，不再用会话时区隐式转换", () => {
    const dialect = new PgDialect();
    const q = dialect.sqlToQuery(timestamptzPeriodRangeSql("created_at", "2026-09-01", "2026-09-30"));
    expect(q.sql).toContain("created_at >= (($1::date::timestamp) at time zone 'Asia/Shanghai')");
    expect(q.sql).toContain("created_at < ((($2::date) + interval '1 day') at time zone 'Asia/Shanghai')");
    expect(q.params).toEqual(["2026-09-01", "2026-09-30"]);
    // 严禁退回 created_at >= $1::date 的旧写法（UTC 会话下月初 8 小时会漏）
    expect(q.sql).not.toMatch(/created_at >= \(\$1::date\)/);
    // 严禁写成 date AT TIME ZONE：PG 会把 date 先提升为 timestamptz 再转墙钟，方向相反、
    // 下界偏晚 8 小时（已在真库验证：'2026-09-01'::date at time zone 'Asia/Shanghai'
    // 在 UTC 会话返回 2026-09-01 08:00:00，而 ::timestamp 版本返回 2026-08-31 16:00:00+00）
    expect(q.sql).not.toMatch(/created_at >= \(\$1::date at time zone/);
  });

  it("指定列名（含表别名）时保持原样注入", () => {
    const dialect = new PgDialect();
    const q = dialect.sqlToQuery(timestamptzPeriodRangeSql("o.created_at", "2026-01-01", "2026-12-31"));
    expect(q.sql).toContain("o.created_at >=");
    expect(q.sql).toContain("'Asia/Shanghai'");
    expect(q.params).toEqual(["2026-01-01", "2026-12-31"]);
  });
});

describe("W11-2 赢单率统一算法 won/(won+lost)", () => {
  it("在途不进分母：20 赢 / 30 输 / 50 在途 → 40%", () => {
    expect(computeWinRatePercent(20, 30)).toBe(40);
  });

  it("零分母返回 0（不存在「无结单但有赢单额则 100%」的兜底）", () => {
    expect(computeWinRatePercent(0, 0)).toBe(0);
    expect(computeWinRatePercent(5, 0)).toBe(100);
    expect(computeWinRatePercent(0, 5)).toBe(0);
  });
});
