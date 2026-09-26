"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  createSalesPlaybookDraftService,
  getRecommendedPlaybookService,
  publishSalesPlaybookService,
  submitPlaybookFeedbackService,
} from "./service";
import { playbookFeedbackSchema, publishSalesPlaybookSchema, salesPlaybookDraftSchema, type SalesPlaybookFeedback, type SalesPlaybookRecommendation } from "./types";


function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

export async function createSalesPlaybookDraft(input: unknown) {
  const parsed = salesPlaybookDraftSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const data = await createSalesPlaybookDraftService(await requireSession(), parsed.data);
    revalidatePath("/playbooks", "layout");
    return { ok: true as const, data };
  } catch (error) {
    return toResult(error);
  }
}

export async function publishSalesPlaybook(input: unknown) {
  const parsed = publishSalesPlaybookSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const data = await publishSalesPlaybookService(await requireSession(), parsed.data);
    revalidatePath("/playbooks", "layout");
    revalidatePath("/opportunities", "layout");
    return { ok: true as const, data };
  } catch (error) {
    return toResult(error);
  }
}

export async function submitPlaybookFeedback(input: unknown): Promise<Result<SalesPlaybookFeedback>> {
  const parsed = playbookFeedbackSchema.safeParse(input);
  if (!parsed.success) return invalid<SalesPlaybookFeedback>(parsed.error);
  try {
    const data = await submitPlaybookFeedbackService(await requireSession(), parsed.data);
    revalidatePath("/opportunities", "layout");
    return { ok: true as const, data };
  } catch (error) {
    return toResult(error);
  }
}

export async function recommendPlaybookForOpportunity(opportunityId: string): Promise<Result<SalesPlaybookRecommendation | null>> {
  try {
    const data = await getRecommendedPlaybookService(await requireSession(), opportunityId);
    return { ok: true as const, data };
  } catch (error) {
    return toResult<SalesPlaybookRecommendation | null>(error);
  }
}

