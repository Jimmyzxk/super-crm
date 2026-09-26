import { describe, expect, it } from "vitest";
import { contactUpdateSchema, convertLeadSchema } from "@/core/customer/types";
import { createOpportunitySchema, loseOpportunitySchema, winOpportunitySchema } from "@/core/opportunity/types";
import { isConvertPhoneValid } from "@/core/customer/convert";
import { formatDateOnly, parseLocalDate, startOfLocalDay } from "@/core/shared/date";
import { zonedWallClockToUtc } from "@/core/shared/tz";
import { decodeDetailCollectionCursor, decodePoolCursor, encodeDetailCollectionCursor, encodePoolCursor, nextTimelineLimit } from "@/core/shared/pagination";

describe("阶段 4 客户与商机输入契约", () => {
  it("联系人更新允许单字段更新和显式清空可空字段", () => {
    expect(contactUpdateSchema.safeParse({ contactId: crypto.randomUUID(), phone: "13812345678" }).success).toBe(true);
    expect(contactUpdateSchema.safeParse({ contactId: crypto.randomUUID(), email: null, title: null }).success).toBe(true);
    expect(contactUpdateSchema.safeParse({ contactId: crypto.randomUUID() }).success).toBe(true);
  });

  it("金额必须是非负安全整数，拒绝小数和超过 JS 安全范围的数字", () => {
    const base = {
      customerId: crypto.randomUUID(), primaryContactId: crypto.randomUUID(), name: "设备采购",
    };
    expect(createOpportunitySchema.safeParse({ ...base, expectedAmount: Number.MAX_SAFE_INTEGER }).success).toBe(true);
    expect(createOpportunitySchema.safeParse({ ...base, expectedAmount: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(createOpportunitySchema.safeParse({ ...base, expectedAmount: 1.2 }).success).toBe(false);
    expect(convertLeadSchema.safeParse({
      leadId: crypto.randomUUID(), customerName: "客户", contactName: "联系人", contactPhone: "13812345678",
      opportunityName: "商机", expectedAmount: Number.MAX_SAFE_INTEGER, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求",
    }).success).toBe(true);
  });

  it("只允许非终态初始阶段，赢单必须提供安全整数，丢单 OTHER 必须说明", () => {
    const base = { customerId: crypto.randomUUID(), primaryContactId: crypto.randomUUID(), name: "商机" };
    expect(createOpportunitySchema.safeParse({ ...base, stage: "WON" }).success).toBe(false);
    expect(winOpportunitySchema.safeParse({ opportunityId: crypto.randomUUID(), actualAmount: Number.MAX_SAFE_INTEGER, actualCloseAt: new Date() }).success).toBe(true);
    expect(winOpportunitySchema.safeParse({ opportunityId: crypto.randomUUID(), actualAmount: Number.MAX_SAFE_INTEGER + 1, actualCloseAt: new Date() }).success).toBe(false);
    expect(winOpportunitySchema.safeParse({ opportunityId: crypto.randomUUID(), actualAmount: -1, actualCloseAt: new Date() }).success).toBe(false);
    expect(loseOpportunitySchema.safeParse({ opportunityId: crypto.randomUUID(), reason: "OTHER" }).success).toBe(false);
    expect(loseOpportunitySchema.safeParse({ opportunityId: crypto.randomUUID(), reason: "OTHER", note: "预算已取消" }).success).toBe(true);
  });

  it("转化关联允许命中手机号，新建时必须更换命中手机号", () => {
    expect(isConvertPhoneValid(true, "13812345678", "13812345678")).toBe(true);
    expect(isConvertPhoneValid(false, "13812345678", "13812345678")).toBe(false);
    expect(isConvertPhoneValid(false, "13912345678", "13812345678")).toBe(true);
  });

  it("日期使用业务时区（Asia/Shanghai）的午夜", () => {
    // parseLocalDate/startOfLocalDay 固定按业务时区解释墙钟时间，不跟随宿主时区；
    // 故断言用同一口径计算期望值，而非 new Date(y, m, d)（后者依赖运行环境时区，
    // 在 UTC 机器上会差 8 小时）。
    const expectedMidnight = zonedWallClockToUtc(2026, 8, 14);
    const today = zonedWallClockToUtc(2026, 8, 14, 23, 59);
    expect(parseLocalDate("2026-08-14").getTime()).toBe(expectedMidnight.getTime());
    expect(startOfLocalDay(today).getTime()).toBe(parseLocalDate("2026-08-14").getTime());
    expect(parseLocalDate("2026-08-13").getTime()).toBeLessThan(parseLocalDate("2026-08-14").getTime());
  });

  it("日期字段只按本地日历显示月日", () => {
    expect(formatDateOnly("2026-08-30")).toBe("08/30");
    expect(formatDateOnly("2026-08-14")).toBe("08/14");
  });

  it("时间线累计加载在 100 条处停止", () => {
    expect(nextTimelineLimit(20, true)).toBe(40);
    expect(nextTimelineLimit(100, true)).toBeNull();
    expect(nextTimelineLimit(20, false)).toBeNull();
  });

  it("池游标接受规范 Base64URL、合法 UUID 与可空 value", () => {
    const cursors = [
      { sort: "recent", value: null, id: "550e8400-e29b-41d4-a716-446655440000" },
      { sort: "recent", value: "2026-08-17T00:00:00.000Z", id: "550E8400-E29B-41D4-A716-446655440000" },
    ];

    for (const cursor of cursors) {
      expect(decodePoolCursor(encodePoolCursor(cursor), "recent")).toEqual(cursor);
    }
  });

  it("池游标的 base64、JSON、sort、value 和 id 非法时统一报 INVALID_CURSOR", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const encode = (cursor: unknown) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    const invalidCursors = [
      "A",
      Buffer.from("{", "utf8").toString("base64url"),
      encode({ sort: "created", value: "2026-08-17T00:00:00.000Z", id: validId }),
      encode({ sort: "recent", value: 0, id: validId }),
      encode({ sort: "recent", value: null, id: "not-a-uuid" }),
    ];

    for (const cursor of invalidCursors) {
      expect(() => decodePoolCursor(cursor, "recent")).toThrowError("INVALID_CURSOR");
    }
  });

  it("客户详情游标拒绝非法时间和错误集合", () => {
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const valid = encodeDetailCollectionCursor({ collection: "contacts", value: "2026-08-17T00:00:00.000Z", id: validId, isPrimary: false });
    expect(decodeDetailCollectionCursor(valid, "contacts")).toMatchObject({ collection: "contacts", id: validId });
    const encode = (cursor: unknown) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    expect(() => decodeDetailCollectionCursor(encode({ collection: "contacts", value: "not-a-date", id: validId, isPrimary: false }), "contacts")).toThrowError("INVALID_CURSOR");
    expect(() => decodeDetailCollectionCursor(valid, "opportunities")).toThrowError("INVALID_CURSOR");
  });

});
