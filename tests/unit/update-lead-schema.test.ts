import { describe, expect, it } from "vitest";
import { updateLeadSchema } from "@/core/leads/types";

describe("updateLeadSchema 意向产品字段边界", () => {
  const base = {
    leadId: "1e9b48ab-8e41-4952-bc2a-ae33fd33ce14",
    contactName: "黄伟东",
    contactPhone: "13588889900",
  };

  it("null 与 undefined 均合法（清空/不动）", () => {
    expect(updateLeadSchema.safeParse({ ...base, intendedProductId: null }).success).toBe(true);
    expect(updateLeadSchema.safeParse({ ...base, intendedProductId: undefined }).success).toBe(true);
  });

  it("空字符串被拒（UI 必须先转 null）", () => {
    const r = updateLeadSchema.safeParse({ ...base, intendedProductId: "" });
    expect(r.success).toBe(false);
  });

  it("完整编辑表单 payload（含预算）合法", () => {
    const r = updateLeadSchema.safeParse({
      ...base,
      contactEmail: "weidong.huang@zhikong-micro.com",
      companyName: "深圳智控微电子有限公司",
      title: "研发与业务副总裁",
      intendedProductId: null,
      intendedProduct: null,
      budget: "250000",
      note: "计划引入 CRM 闭环套件。",
    });
    expect(r.success).toBe(true);
  });
});
