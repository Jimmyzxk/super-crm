import { z } from "zod";
import { startOfLocalDay } from "@/core/shared/date";

const phone = z.string().trim().regex(/^1[3-9][0-9]{9}$/, "请输入正确的手机号");
const email = z.string().trim().max(100, "邮箱不超过 100 字").email("请输入正确的邮箱");
const optionalNullableEmail = email.nullable().optional();
const optionalNullableText = (limit: number, message: string) => z.string().trim().max(limit, message).nullable().optional();
const safeAmount = z.preprocess((value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value, z.number().superRefine((value, ctx) => {
  if (!Number.isSafeInteger(value)) ctx.addIssue({ code: "custom", message: "金额必须是安全整数（单位：分）" });
  if (value < 0) ctx.addIssue({ code: "custom", message: "预计金额不能小于 0" });
}));
const nonEmpty = (message: string, max: number) => z.string().trim().min(1, message).max(max);

export const customerSizeSchema = z.enum(["1-20", "21-100", "101-500", "501-1000", "1000+"]);

export const customerTypeSchema = z.enum(["ENTERPRISE", "INDIVIDUAL"]);
export type CustomerType = z.infer<typeof customerTypeSchema>;

export const contactRoleTagSchema = z.enum(["DECISION_MAKER", "TECH_EVALUATOR", "PROCUREMENT", "USER", "FINANCE", "OTHER"]);
export type ContactRoleTag = z.infer<typeof contactRoleTagSchema>;

export const customerCreateDirectSchema = z.object({
  customerType: customerTypeSchema.default("ENTERPRISE").optional(),
  name: nonEmpty("请输入客户名称", 100),
  industry: z.string().trim().max(50).optional(),
  region: z.string().trim().max(50).optional(),
  size: customerSizeSchema.optional(),
  contactName: z.string().trim().max(50).optional(),
  contactPhone: z.string().trim().regex(/^1[3-9][0-9]{9}$/, "请输入正确的手机号").optional(),
  contactEmail: email.optional(),
  contactTitle: z.string().trim().max(50).optional(),
  contactRoleTag: contactRoleTagSchema.default("DECISION_MAKER").optional(),
});
export type CustomerCreateDirectInput = z.infer<typeof customerCreateDirectSchema>;

import { opportunityLineItemInputSchema } from "@/core/opportunity/types";

export const convertLeadSchema = z.object({
  leadId: z.string().uuid(),
  customerType: customerTypeSchema.default("ENTERPRISE").optional(),
  customerName: nonEmpty("请输入客户名称", 100),
  industry: z.string().trim().max(50).optional(),
  region: z.string().trim().max(50).optional(),
  size: customerSizeSchema.optional(),
  contactName: nonEmpty("请输入联系人姓名", 50),
  contactPhone: phone,
  contactEmail: email.optional(),
  contactTitle: z.string().trim().max(50).optional(),
  contactRoleTag: contactRoleTagSchema.default("OTHER").optional(),
  linkToExistingCustomerId: z.string().uuid().optional(),
  opportunityName: nonEmpty("请输入商机名称", 100),
  expectedAmount: safeAmount,
  expectedCloseAt: z.coerce.date().refine((value) => value >= startOfToday(), "预计成交时间不能早于今天"),
  demandNote: nonEmpty("请输入需求说明", 500),
  lineItems: z.array(opportunityLineItemInputSchema).optional(),
});

export const customerUpdateSchema = z.object({
  customerId: z.string().uuid(),
  customerType: customerTypeSchema.optional(),
  name: nonEmpty("请输入客户名称", 100).optional(),
  industry: z.string().trim().max(50).nullable().optional(),
  region: z.string().trim().max(50).nullable().optional(),
  size: customerSizeSchema.nullable().optional(),
});

export const contactCreateSchema = z.object({
  customerId: z.string().uuid(),
  name: nonEmpty("请输入联系人姓名", 50),
  phone,
  email: email.optional(),
  title: z.string().trim().max(50).optional(),
  roleTag: contactRoleTagSchema.default("OTHER").optional(),
  isPrimary: z.boolean().optional(),
});

export const contactUpdateSchema = z.object({
  contactId: z.string().uuid(),
  name: nonEmpty("请输入联系人姓名", 50).optional(),
  phone: phone.optional(),
  email: optionalNullableEmail,
  title: optionalNullableText(50, "职位不超过 50 字"),
  roleTag: contactRoleTagSchema.optional(),
});

export const contactIdSchema = z.object({ contactId: z.string().uuid() });
export const primaryContactSchema = z.object({ customerId: z.string().uuid(), contactId: z.string().uuid() });

function startOfToday(): Date {
  return startOfLocalDay();
}

export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export type CustomerListItem = {
  id: string;
  customerType: CustomerType;
  name: string;
  industry: string | null;
  region: string | null;
  size: string | null;
  ownerName: string;
  opportunityCount: number;
  activeOpportunityCount: number;
  wonOpportunityCount: number;
  operatingStatus: "推进中" | "已成交" | "待立项";
  progressingStage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | null;
  primaryOpportunityId: string | null;
  nextTaskDueAt: string | null;
  primaryContactName: string | null;
  primaryContactPhone: string | null;
  recentInteractionAt: string | null;
};

export type CustomerList = { items: CustomerListItem[]; nextCursor: string | null };

export type CustomerStatus = "all" | "active" | "stalled" | "no-active";
export type CustomerSort = "recent" | "created";
export type CustomerTimelineItem = { id: string; type: string; outcome: string | null; summary: string; occurredAt: string; userName: string };
export type CustomerTimelinePage = { items: CustomerTimelineItem[]; nextLimit: number | null };

export const customerDetailCollectionSchema = z.enum(["sourceLeadNames", "contacts", "opportunities", "openTasks"]);
export type CustomerDetailCollection = z.infer<typeof customerDetailCollectionSchema>;

export type CustomerDetailSourceLead = {
  id: string;
  name: string;
  phone?: string;
  companyName?: string | null;
  title?: string | null;
  intendedProduct?: string | null;
  intendedProductCategory?: string | null;
  budget?: string | null;
  note?: string | null;
  source?: string | null;
  status?: string;
  createdAt?: string;
  convertedAt?: string;
  opportunityName?: string | null;
  opportunityId?: string | null;
};
export type CustomerDetailContact = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  title: string | null;
  roleTag: ContactRoleTag;
  isPrimary: boolean;
};
export type CustomerDetailOpportunity = {
  id: string;
  name: string;
  stage: string;
  ownerName?: string;
  ownerUserId?: string;
  intendedProduct?: string | null;
  expectedAmount: string | null;
  expectedCloseAt: string | null;
  openTaskType: string | null;
  openTaskDueAt: string | null;
};
export type CustomerDetailOpenTask = { id: string; type: string; dueAt: string; subjectType: string };

export type CustomerDetailCollectionItems = {
  sourceLeadNames: CustomerDetailSourceLead;
  contacts: CustomerDetailContact;
  opportunities: CustomerDetailOpportunity;
  openTasks: CustomerDetailOpenTask;
};

export type CustomerDetailCollectionPage<K extends CustomerDetailCollection = CustomerDetailCollection> = {
  items: CustomerDetailCollectionItems[K][];
  nextCursor: string | null;
};

export type CustomerDetailContract = {
  id: string;
  contractNo: string;
  title: string;
  totalAmount: number;
  status: string;
  signDate: string | null;
};

export type CustomerDetailOrder = {
  id: string;
  orderNo: string;
  title: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  createdAt: string;
};

export type CustomerDetailProject = {
  id: string;
  projectCode: string;
  name: string;
  healthStatus: string;
  progressPercent: number;
  status: string;
};

export type CustomerDetailCommerce = {
  contracts: CustomerDetailContract[];
  orders: CustomerDetailOrder[];
  projects: CustomerDetailProject[];
};

export type CustomerDetail = {
  customer: CustomerListItem & { createdAt: string; sourceLeadNames: string[] };
  sourceLeads: CustomerDetailSourceLead[];
  contacts: CustomerDetailContact[];
  opportunities: CustomerDetailOpportunity[];
  activities: Array<{ id: string; type: string; outcome: string | null; summary: string; occurredAt: string; userName: string }>;
  openTasks: CustomerDetailOpenTask[];
  commerce?: CustomerDetailCommerce;
  truncation: {
    sourceLeadNames: { limit: number; hasMore: boolean; nextCursor: string | null };
    contacts: { limit: number; hasMore: boolean; nextCursor: string | null };
    opportunities: { limit: number; hasMore: boolean; nextCursor: string | null };
    openTasks: { limit: number; hasMore: boolean; nextCursor: string | null };
  };
};
