import { z } from "zod";
import { startOfLocalDay } from "@/core/shared/date";

export const stages = ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
export type OpportunityStage = typeof stages[number];
export const activeStages = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"] as const;
export const lostReasons = ["PRICE", "COMPETITOR", "NO_BUDGET", "NO_DECISION", "TIMING", "OTHER"] as const;

const dateNotPast = z.coerce.date().refine((value) => value >= startOfToday(), "预计成交时间不能早于今天");
const optionalDate = dateNotPast.optional();
const safeAmount = z.preprocess((value) => typeof value === "string" && value.trim() !== "" ? Number(value) : value, z.number().superRefine((value, ctx) => {
  if (!Number.isSafeInteger(value)) ctx.addIssue({ code: "custom", message: "金额必须是安全整数（单位：分）" });
  if (value < 0) ctx.addIssue({ code: "custom", message: "金额不能小于 0" });
}));
const optionalAmount = safeAmount.optional();

export const opportunityLineItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().int().min(0), // 分
  discountRate: z.number().int().min(1).max(100).default(100),
  customNotes: z.string().trim().max(200).optional(),
});
export type OpportunityLineItemInput = z.infer<typeof opportunityLineItemInputSchema>;

export const createOpportunitySchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().trim().min(1, "请输入商机名称").max(100),
  stage: z.enum(activeStages).optional().default("DISCOVERY"),
  primaryContactId: z.string().uuid(),
  intendedProductId: z.string().uuid().optional().nullable(),
  intendedProduct: z.string().trim().max(100).optional().nullable(),
  expectedAmount: optionalAmount,
  expectedCloseAt: optionalDate,
  demandNote: z.string().trim().max(500).optional(),
  lineItems: z.array(opportunityLineItemInputSchema).optional(),
});

const stageChange = z.object({
  opportunityId: z.string().uuid(),
  fromStage: z.enum(activeStages),
  toStage: z.enum(activeStages),
  note: z.string().trim().min(1, "请填写阶段说明").max(200),
  expectedAmount: optionalAmount,
  expectedCloseAt: optionalDate,
});

export const advanceStageSchema = stageChange;
export const revertStageSchema = stageChange;
export const winOpportunitySchema = z.object({
  opportunityId: z.string().uuid(),
  actualAmount: safeAmount,
  actualCloseAt: z.coerce.date(),
  note: z.string().trim().max(200).optional(),
});
export const loseOpportunitySchema = z.object({
  opportunityId: z.string().uuid(),
  reason: z.enum(lostReasons),
  note: z.string().trim().max(200).optional(),
}).superRefine((value, ctx) => {
  if (value.reason === "OTHER" && !value.note?.trim()) ctx.addIssue({ code: "custom", path: ["note"], message: "请选择其他原因时请填写说明" });
});

export const updateOpportunitySchema = z.object({
  opportunityId: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  primaryContactId: z.string().uuid().optional(),
  intendedProductId: z.string().uuid().optional().nullable(),
  intendedProduct: z.string().trim().max(100).optional().nullable(),
  expectedAmount: optionalAmount,
  expectedCloseAt: optionalDate,
  demandNote: z.string().trim().max(500).optional(),
});

function startOfToday(): Date {
  return startOfLocalDay();
}

export type CreateOpportunityInput = z.input<typeof createOpportunitySchema>;
export type StageChangeInput = z.infer<typeof stageChange>;

export type OpportunityFilter = "active" | "stalled" | "month" | "won" | "lost";
export const opportunityFilters: OpportunityFilter[] = ["active", "stalled", "month", "won", "lost"];

export type OpportunityListItem = {
  id: string;
  name: string;
  stage: OpportunityStage;
  customerId: string;
  customerName: string;
  ownerName: string;
  ownerUserId?: string;
  customerOwnerName?: string | null;
  intendedProductId?: string | null;
  intendedProduct?: string | null;
  intendedProductCategory?: string | null;
  expectedAmount: string | null;
  expectedCloseAt: string | null;
  stageEnteredAt: string;
  primaryContactName: string | null;
  openTaskId: string | null;
  openTaskType: string | null;
  openTaskDueAt: string | null;
  isStalled: boolean;
};

export type OpportunityList = { items: OpportunityListItem[]; nextCursor: string | null };

export type OpportunityDetail = {
  opportunity: OpportunityListItem & {
    ownerUserId?: string;
    customerOwnerName?: string | null;
    primaryContactId: string | null;
    contactPhone: string | null;
    contactTitle: string | null;
    demandNote: string | null;
    actualAmount: string | null;
    actualCloseAt: string | null;
    lostReason: string | null;
    lostNote: string | null;
    sourceLead?: { id: string; name: string; phone?: string | null; convertedAt?: string | null } | null;
  };
  stageHistory: Array<{ id: string; fromStage: OpportunityStage | null; toStage: OpportunityStage; note: string | null; operatorName: string; createdAt: string }>;
  activities: Array<{ id: string; type: string; outcome: string | null; summary: string; occurredAt: string; userName: string }>;
  openTask: { id: string; type: string; dueAt: string } | null;
};
