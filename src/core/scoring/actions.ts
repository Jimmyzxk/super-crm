"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { scoreFields, scoreOperators } from "./rules";
import { createScoreRuleService, deleteScoreRuleService, getScoreFeedbackStatsService, listScoreRulesService, reorderScoreRulesService, submitScoreFeedbackService, updateScoreRuleService } from "./service";

const ruleSchema = z.object({
  label: z.string().trim().min(1).max(30),
  field: z.enum(scoreFields),
  operator: z.enum(scoreOperators),
  value: z.string().trim().max(200).nullable(),
  weight: z.number().int().min(-100).max(100),
  enabled: z.boolean(),
});
const ruleIdSchema = z.object({ ruleId: z.string().uuid() });

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

async function run<T>(fn: () => Promise<T>, refresh = false): Promise<Result<T>> {
  try {
    const data = await fn();
    if (refresh) { revalidatePath("/settings"); revalidatePath("/leads", "layout"); }
    return { ok: true, data };
  } catch (error) { return toResult<T>(error); }
}

export async function submitScoreFeedback(input: unknown) {
  const parsed = z.object({ leadId: z.string().uuid(), verdict: z.enum(["ACCURATE", "INACCURATE"]) }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  return run(async () => submitScoreFeedbackService(await requireSession(), parsed.data.leadId, parsed.data.verdict), true);
}

export async function listScoreRules() { return run(async () => listScoreRulesService(await requireSession())); }
export async function getScoreFeedbackStats() { return run(async () => getScoreFeedbackStatsService(await requireSession())); }
export async function createScoreRule(input: unknown) {
  const parsed = ruleSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => createScoreRuleService(await requireSession(), parsed.data), true);
}
export async function updateScoreRule(input: unknown) {
  const parsed = ruleIdSchema.merge(ruleSchema).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  const { ruleId, ...data } = parsed.data;
  return run(async () => updateScoreRuleService(await requireSession(), ruleId, data), true);
}
export async function deleteScoreRule(input: unknown) {
  const parsed = ruleIdSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => deleteScoreRuleService(await requireSession(), parsed.data.ruleId), true);
}
export async function reorderScoreRules(input: unknown) {
  const parsed = z.object({ ruleIds: z.array(z.string().uuid()).min(1) }).safeParse(input); if (!parsed.success) return invalid(parsed.error);
  return run(async () => reorderScoreRulesService(await requireSession(), parsed.data.ruleIds), true);
}
