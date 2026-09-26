import { describe, expect, it } from "vitest";
import { parseLeadCsvBase64 } from "@/core/leads/csv";
import { activitySchema } from "@/core/followup/types";
import { createLeadSchema, discardSchema } from "@/core/leads/types";

describe("阶段 1 输入与 CSV 规则", () => {
  it("字段验证返回产品规格中的中文文案", () => {
    expect(createLeadSchema.safeParse({ contactName: "", contactPhone: "123" }).error?.issues[0].message).toBe("请填写联系人姓名");
    expect(createLeadSchema.safeParse({ contactName: "李明", contactPhone: "123" }).error?.issues[0].message).toBe("请填写正确的手机号");
    expect(discardSchema.safeParse({ leadId: crypto.randomUUID(), reason: "OTHER" }).error?.issues[0].message).toBe("请选择其他时请填写补充说明");
  });

  it("NOTE 不要求结果，其它方式必须有结果", () => {
    expect(activitySchema.safeParse({ leadId: crypto.randomUUID(), type: "NOTE", summary: "内部备注" }).success).toBe(true);
    expect(activitySchema.safeParse({ leadId: crypto.randomUUID(), type: "CALL", summary: "电话记录" }).success).toBe(false);
  });

  it("解析 UTF-8 BOM、引号逗号并拒绝科学计数法手机号", () => {
    const csv = '\uFEFF姓名,手机号,公司,邮箱,职位,备注\n李明,13812345678,"星海,智能",,,首次沟通\n王芳,1.381E+10,,,,';
    const result = parseLeadCsvBase64(Buffer.from(csv, "utf8").toString("base64"));
    expect(result.valid[0].data).toMatchObject({ contactName: "李明", companyName: "星海,智能" });
    expect(result.errors[0]).toMatchObject({ row: 3, message: "手机号不能使用科学计数法" });
  });

  it("解析 GBK 编码的中文 CSV", () => {
    const result = parseLeadCsvBase64("0NXD+yzK1rv6usUKwO7D9ywxMzgxMjM0NTY3OAo=");
    expect(result).toEqual({ valid: [{ row: 2, data: { contactName: "李明", contactPhone: "13812345678" } }], errors: [] });
  });
});
