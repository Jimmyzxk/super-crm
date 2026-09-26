import { z } from "zod";

const optionalText = (limit: number, message: string) =>
  z.string().trim().max(limit, message).optional().transform((value) => value || undefined);

export const leadFieldsSchema = z.object({
  contactName: z.string().trim().min(1, "请填写联系人姓名").max(50, "联系人姓名不超过 50 字"),
  contactPhone: z.string().trim().regex(/^1[3-9]\d{9}$/, "请填写正确的手机号"),
  contactEmail: optionalText(100, "邮箱不超过 100 字").refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "邮箱格式不正确",
  ),
  companyName: optionalText(100, "公司名称不超过 100 字"),
  title: optionalText(50, "职位不超过 50 字"),
  intendedProductId: z.string().uuid().optional().nullable().transform((v) => v || undefined),
  intendedProduct: optionalText(100, "意向产品不超过 100 字"),
  budget: optionalText(50, "预估预算不超过 50 字"),
  channel: optionalText(50, "渠道标识不超过 50 字"),
  utmSource: optionalText(50, "utm_source 不超过 50 字"),
  utmMedium: optionalText(50, "utm_medium 不超过 50 字"),
  utmCampaign: optionalText(50, "utm_campaign 不超过 50 字"),
  note: optionalText(500, "备注不超过 500 字"),
});

export const leadCollisionTypeSchema = z.enum([
  "NONE",
  "ACTIVE_PRIVATE_LEAD",
  "SELF_LEAD",
  "PUBLIC_POOL_LEAD",
  "EXISTING_CUSTOMER_CONTACT",
  "DISCARDED_LEAD",
]);
export type LeadCollisionType = z.infer<typeof leadCollisionTypeSchema>;

export type LeadCollisionInfo = {
  collisionType: LeadCollisionType;
  message: string;
  leadId?: string;
  customerId?: string;
  customerName?: string;
  contactName?: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  isSelfOwner?: boolean;
  canReactivate?: boolean;
  canClaim?: boolean;
};

export const createLeadSchema = leadFieldsSchema.extend({
  confirmDuplicate: z.boolean().optional(),
  reactivateLeadId: z.string().uuid().optional(),
  claimPublicLeadId: z.string().uuid().optional(),
});
export const updateLeadSchema = z.object({
  leadId: z.string().uuid(),
  contactName: z.string().trim().min(1, "请填写联系人姓名").max(50, "联系人姓名不超过 50 字").optional(),
  contactPhone: z.string().trim().regex(/^1[3-9]\d{9}$/, "请填写正确的手机号").optional(),
  contactEmail: z.string().trim().max(100, "邮箱不超过 100 字").refine(
    (value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "邮箱格式不正确",
  ).nullable().optional(),
  companyName: z.string().trim().max(100, "公司名称不超过 100 字").nullable().optional(),
  title: z.string().trim().max(50, "职位不超过 50 字").nullable().optional(),
  intendedProductId: z.string().uuid().nullable().optional(),
  intendedProduct: z.string().trim().max(100, "意向产品不超过 100 字").nullable().optional(),
  budget: z.string().trim().max(50, "预估预算不超过 50 字").nullable().optional(),
  channel: z.string().trim().max(50, "渠道标识不超过 50 字").nullable().optional(),
  utmSource: z.string().trim().max(50, "utm_source 不超过 50 字").nullable().optional(),
  utmMedium: z.string().trim().max(50, "utm_medium 不超过 50 字").nullable().optional(),
  utmCampaign: z.string().trim().max(50, "utm_campaign 不超过 50 字").nullable().optional(),
  note: z.string().trim().max(500, "备注不超过 500 字").nullable().optional(),
});
export const discardSchema = z.object({
  leadId: z.string().uuid(),
  reason: z.enum(["NO_NEED", "NO_BUDGET", "WRONG_CONTACT", "INVALID_INFO", "COMPETITOR", "OTHER"]),
  note: z.string().trim().max(200, "补充说明不超过 200 字").optional(),
}).refine((value) => value.reason !== "OTHER" || Boolean(value.note), {
  message: "请选择其他时请填写补充说明",
  path: ["note"],
});

export const apiLeadSchema = leadFieldsSchema.extend({
  externalId: optionalText(200, "外部记录号不超过 200 字"),
  sourceLabel: optionalText(100, "来源标签不超过 100 字"),
  utm_source: optionalText(50, "utm_source 不超过 50 字"),
  utm_medium: optionalText(50, "utm_medium 不超过 50 字"),
  utm_campaign: optionalText(50, "utm_campaign 不超过 50 字"),
}).strict();

export type LeadInput = z.infer<typeof leadFieldsSchema>;
export type ApiLeadInput = z.infer<typeof apiLeadSchema>;
export type LeadUpdateInput = Omit<z.infer<typeof updateLeadSchema>, "leadId">;
export type LeadRow = {
  id: string; contactName: string; contactPhone: string; contactEmail: string | null;
  companyName: string | null; title: string | null;
  intendedProductId: string | null;
  intendedProduct: string | null;
  intendedProductCode?: string | null;
  intendedProductCategory?: string | null;
  intendedProductUnitPrice?: number | null;
  intendedProductPricingModel?: string | null;
  intendedProductUnit?: string | null;
  budget: string | null;
  channel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  note: string | null; source: string;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "DISCARDED";
  score: number | null; scoreReason: string | null; isPossibleDuplicate: boolean;
  ownerUserId: string | null; ownerName: string | null; dueAt: string | null;
  taskId: string | null; createdAt: string;
};

export type LeadImportErrorItem = {
  rowNumber: number;
  contactMasked: string;
  reason: string;
};

export type LeadImportResult = {
  created: number;
  skipped: number;
  failed: number;
  errors: LeadImportErrorItem[];
};


