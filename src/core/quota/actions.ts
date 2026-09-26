"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  batchUpsertSalesQuotas,
  getSalesQuotaAttainmentDashboard,
  listSalesQuotas,
  upsertSalesQuota,
} from "./service";
import {
  batchUpsertQuotasInputSchema,
  upsertQuotaInputSchema,
  type BatchUpsertQuotasInput,
  type QuotaPeriodType,
  type SalesQuotaItem,
  type TeamQuotaDashboardData,
  type UpsertQuotaInput,
} from "./types";

async function run<T>(fn: () => Promise<T>, refresh = false): Promise<Result<T>> {
  try {
    const data = await fn();
    if (refresh) {
      revalidatePath("/quotas", "layout");
      revalidatePath("/today", "layout");
      revalidatePath("/analytics", "layout");
    }
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function listSalesQuotasAction(params: {
  year?: number;
  periodType?: QuotaPeriodType;
  periodKey?: string;
  departmentId?: string;
  userId?: string;
} = {}): Promise<Result<SalesQuotaItem[]>> {
  return run(async () => listSalesQuotas(await requireSession(), params));
}

export async function upsertSalesQuotaAction(
  rawInput: UpsertQuotaInput,
): Promise<Result<SalesQuotaItem>> {
  const parsed = upsertQuotaInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
  }
  return run(async () => upsertSalesQuota(await requireSession(), parsed.data), true);
}

export async function batchUpsertSalesQuotasAction(
  rawInput: BatchUpsertQuotasInput,
): Promise<Result<{ count: number }>> {
  const parsed = batchUpsertQuotasInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
  }
  return run(async () => batchUpsertSalesQuotas(await requireSession(), parsed.data), true);
}

export async function getSalesQuotaAttainmentDashboardAction(params: {
  year?: number;
  periodType?: QuotaPeriodType;
  periodKey?: string;
  departmentId?: string;
} = {}): Promise<Result<TeamQuotaDashboardData>> {
  return run(async () => getSalesQuotaAttainmentDashboard(await requireSession(), params));
}
