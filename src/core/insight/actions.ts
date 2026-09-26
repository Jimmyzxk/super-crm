"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { acceptSalesInsightService, dismissSalesInsightService, getSalesInsightsService } from "./service";
import type { InsightListItem, InsightSubjectType } from "./types";


const subjectSchema = z.object({ subjectType: z.enum(["lead", "opportunity"]), subjectId: z.string().uuid() });
const subjectIdSchema = z.object({ insightId: z.string().uuid() });
const dismissSchema = subjectIdSchema.extend({ reason: z.enum(["NOT_APPLICABLE", "ALREADY_HANDLED", "WRONG_INFORMATION", "OTHER"]) });
const acceptSchema = subjectIdSchema.extend({ dueAt: z.coerce.date().refine((date) => date > new Date(), "建议时间必须在未来") });

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

function refresh(subjectType: InsightSubjectType): void {
  revalidatePath(subjectType === "lead" ? "/leads" : "/opportunities", "layout");
  revalidatePath("/today", "layout");
}

export async function getSalesInsights(input: unknown): Promise<Result<InsightListItem[]>> {
  const parsed = subjectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const data = await getSalesInsightsService(await requireSession(), {
      type: parsed.data.subjectType,
      id: parsed.data.subjectId,
    });
    return { ok: true as const, data };
  }
  catch (error) { return toResult<InsightListItem[]>(error); }
}


export async function acceptSalesInsight(input: unknown) {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try { const data = await acceptSalesInsightService(await requireSession(), parsed.data.insightId, parsed.data.dueAt); refresh("lead"); refresh("opportunity"); return { ok: true as const, data }; }
  catch (error) { return toResult(error); }
}

export async function dismissSalesInsight(input: unknown) {
  const parsed = dismissSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try { const data = await dismissSalesInsightService(await requireSession(), parsed.data.insightId, parsed.data.reason); revalidatePath("/today", "layout"); revalidatePath("/leads", "layout"); revalidatePath("/opportunities", "layout"); return { ok: true as const, data }; }
  catch (error) { return toResult(error); }
}
