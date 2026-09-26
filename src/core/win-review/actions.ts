"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { getWinReviewService, reviewWinReviewService } from "./service";

const getSchema = z.object({ opportunityId: z.string().uuid() });
const reviewSchema = z.object({ winReviewId: z.string().uuid(), status: z.enum(["REVIEWED", "REJECTED"]), reason: z.string().trim().min(1, "请填写审核理由").max(500) });

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

export async function getWinReview(input: unknown) {
  const parsed = getSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  try { return { ok: true as const, data: await getWinReviewService(await requireSession(), parsed.data.opportunityId) }; }
  catch (error) { return toResult(error); }
}

export async function reviewWinReview(input: unknown) {
  const parsed = reviewSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  try {
    const data = await reviewWinReviewService(await requireSession(), parsed.data);
    revalidatePath("/opportunities", "layout");
    return { ok: true as const, data };
  } catch (error) { return toResult(error); }
}
