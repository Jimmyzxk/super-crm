"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  advanceStageService, createOpportunityService, getOpportunityDetailService,
  getOpportunityTimelineService, loseOpportunityService, revertStageService,
  transferOpportunityService, updateOpportunityService, winOpportunityService,
} from "./service";

import { advanceStageSchema, createOpportunitySchema, loseOpportunitySchema, revertStageSchema, updateOpportunitySchema, winOpportunitySchema } from "./types";

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

async function run<T>(fn: () => Promise<T>, refresh = false): Promise<Result<T>> {
  try { const data = await fn(); if (refresh) { revalidatePath("/opportunities", "layout"); revalidatePath("/customers", "layout"); } return { ok: true, data }; }
  catch (error) { return toResult<T>(error); }
}

export async function createOpportunity(input: unknown) {
  const parsed = createOpportunitySchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => createOpportunityService(await requireSession(), parsed.data), true);
}

export async function advanceStage(input: unknown) {
  const parsed = advanceStageSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => advanceStageService(await requireSession(), parsed.data), true);
}

export async function revertStage(input: unknown) {
  const parsed = revertStageSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => revertStageService(await requireSession(), parsed.data), true);
}

export async function winOpportunity(input: unknown) {
  const parsed = winOpportunitySchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => winOpportunityService(await requireSession(), parsed.data), true);
}

export async function loseOpportunity(input: unknown) {
  const parsed = loseOpportunitySchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => loseOpportunityService(await requireSession(), parsed.data), true);
}

export async function updateOpportunity(input: unknown) {
  const parsed = updateOpportunitySchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => updateOpportunityService(await requireSession(), parsed.data), true);
}

export async function transferOpportunity(input: unknown) {
  const parsed = z
    .object({
      opportunityId: z.string().uuid(),
      toOwnerUserId: z.string().uuid(),
      reason: z.string().max(100).optional(),
      note: z.string().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(
    async () =>
      transferOpportunityService(
        await requireSession(),
        parsed.data.opportunityId,
        parsed.data.toOwnerUserId,
        { reason: parsed.data.reason, note: parsed.data.note },
      ),
    true,
  );
}

export async function getOpportunityDetail(opportunityId: string) {
  return run(async () => getOpportunityDetailService(await requireSession(), opportunityId));
}

export async function getOpportunityTimeline(opportunityId: string, limit = 50) {
  return run(async () => getOpportunityTimelineService(await requireSession(), opportunityId, limit));
}

