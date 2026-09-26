import { describe, expect, it } from "vitest";
import { formatDateOnly } from "@/core/shared/date";

/**
 * formatDateOnly 的两种输入形态必须都正确处理。
 *
 * 回归背景：原实现只匹配 `YYYY-MM-DD`，遇到完整时间戳（服务端返回的是
 * timestamptz 序列化结果）会走 fallback 把原始字符串原样返回——商机列表的
 * 「下一步待办」因此在界面上显示 `2026-09-19 17:36:09.814+00` 而不是 `09/20`。
 * 同时必须按业务时区折算，否则 UTC 晚间的时间戳会显示成前一天。
 */
describe("formatDateOnly", () => {
  it("纯日期输入直接取月日，不做时区换算", () => {
    expect(formatDateOnly("2026-08-30")).toBe("08/30");
    expect(formatDateOnly("2026-01-05")).toBe("01/05");
    expect(formatDateOnly("2026-12-31")).toBe("12/31");
  });

  it("完整时间戳按业务时区折算为月日（不再原样返回）", () => {
    // UTC 17:36 在上海是次日 01:36，必须显示 09/20
    expect(formatDateOnly("2026-09-19T17:36:09.814+00:00")).toBe("09/20");
    // 带 Z 后缀的 ISO 串同理
    expect(formatDateOnly("2026-09-19T17:36:09.814Z")).toBe("09/20");
    // 上海当天早上的时间戳不跨日
    expect(formatDateOnly("2026-09-19T01:00:00+08:00")).toBe("09/19");
  });

  it("边界：上海零点前后归属正确的日期", () => {
    // 上海 2026-09-20 00:00 = UTC 2026-09-19 16:00
    expect(formatDateOnly("2026-09-19T16:00:00Z")).toBe("09/20");
    // 上海 2026-09-19 23:59 = UTC 2026-09-19 15:59
    expect(formatDateOnly("2026-09-19T15:59:00Z")).toBe("09/19");
  });

  it("非法输入原样返回，不抛错", () => {
    expect(formatDateOnly("not-a-date")).toBe("not-a-date");
    expect(formatDateOnly("")).toBe("");
  });
});
