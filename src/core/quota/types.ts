import { z } from "zod";

export const quotaPeriodTypeSchema = z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]);
export type QuotaPeriodType = z.infer<typeof quotaPeriodTypeSchema>;

export interface SalesQuotaItem {
  id: string;
  tenantId: string;
  userId: string;
  userName: string;
  userEmail: string;
  departmentId: string | null;
  departmentName: string | null;
  year: number;
  periodType: QuotaPeriodType;
  periodKey: string;
  targetAmountCents: number;
  targetDealsCount: number;
  targetLeadsCount: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaAttainmentSummary {
  userId: string;
  userName: string;
  departmentName: string | null;
  year: number;
  periodType: QuotaPeriodType;
  periodKey: string;
  targetAmountCents: number;
  wonAmountCents: number;
  attainmentRate: number; // e.g. 85.5%
  quotaGapCents: number; // max(0, target - won)
  targetDealsCount: number;
  wonDealsCount: number;
  openPipelineAmountCents: number; // 在途商机预期金额
  pipelineCoverageRatio: number; // openPipeline / quotaGap (e.g. 3.2x)
}

export const upsertQuotaInputSchema = z.object({
  userId: z.string().uuid(),
  year: z.number().int().min(2020).max(2050),
  periodType: quotaPeriodTypeSchema,
  periodKey: z.string().min(1).max(20),
  targetAmountCents: z.number().int().min(0),
  targetDealsCount: z.number().int().min(0).default(0),
  targetLeadsCount: z.number().int().min(0).default(0).optional(),
  note: z.string().max(500).optional(),
});
export type UpsertQuotaInput = z.infer<typeof upsertQuotaInputSchema>;

export const batchUpsertQuotasInputSchema = z.object({
  quotas: z.array(upsertQuotaInputSchema).min(1).max(500),
});
export type BatchUpsertQuotasInput = z.infer<typeof batchUpsertQuotasInputSchema>;

export interface TeamQuotaDashboardData {
  year: number;
  periodType: QuotaPeriodType;
  periodKey: string;
  teamTargetAmountCents: number;
  teamWonAmountCents: number;
  teamAttainmentRate: number;
  teamQuotaGapCents: number;
  teamOpenPipelineAmountCents: number;
  teamPipelineCoverageRatio: number;
  members: QuotaAttainmentSummary[];
}
