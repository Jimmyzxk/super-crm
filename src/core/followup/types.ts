import { z } from "zod";

export const activitySchema = z.object({
  leadId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  opportunityId: z.string().uuid().optional(),
  type: z.enum(["CALL", "MEETING", "VISIT", "MESSAGE", "NOTE"]),
  outcome: z.enum(["CONNECTED", "NO_ANSWER", "REFUSED", "INTERESTED"]).optional(),
  summary: z.string().trim().min(1, "请填写跟进摘要").max(200, "跟进摘要不超过 200 字"),
  occurredAt: z.coerce.date().optional(),
  nextFollowUpAt: z.coerce.date().optional(),
}).superRefine((value, ctx) => {
  if ([value.leadId, value.customerId, value.opportunityId].filter(Boolean).length !== 1) {
    ctx.addIssue({ code: "custom", path: ["leadId"], message: "跟进必须关联一个对象" });
  }
  if (value.type !== "NOTE" && !value.outcome) ctx.addIssue({ code: "custom", path: ["outcome"], message: "请选择跟进结果" });
  if (value.nextFollowUpAt && value.nextFollowUpAt <= new Date()) ctx.addIssue({ code: "custom", path: ["nextFollowUpAt"], message: "下次跟进时间不能早于现在" });
});
