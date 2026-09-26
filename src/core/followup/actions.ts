"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult } from "@/core/shared/result";
import { activitySchema } from "./types";
import { logActivityService, rescheduleTaskService } from "./service";
import { parseQuickFollowupText, type ParsedFollowupSuggestion } from "./assistant";

export async function logActivity(input: unknown) {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) { const issue = parsed.error.issues[0]; return { ok: false as const, code: "VALIDATION_ERROR" as const, message: issue.message, field: issue.path.join(".") }; }
  try { const data = await logActivityService(await requireSession(), parsed.data); revalidatePath("/today", "layout"); revalidatePath("/leads", "layout"); revalidatePath("/customers", "layout"); revalidatePath("/opportunities", "layout"); return { ok: true as const, data }; }
  catch (error) { return toResult<{ activityId: string }>(error); }
}

export async function rescheduleTask(input: unknown) {
  const parsed = z.object({ taskId: z.string().uuid(), dueAt: z.coerce.date().refine((date) => date > new Date(), "改约时间不能早于现在") }).safeParse(input);
  if (!parsed.success) { const issue = parsed.error.issues[0]; return { ok: false as const, code: "VALIDATION_ERROR" as const, message: issue.message, field: issue.path.join(".") }; }
  try { const data = await rescheduleTaskService(await requireSession(), parsed.data.taskId, parsed.data.dueAt); revalidatePath("/today", "layout"); revalidatePath("/leads", "layout"); revalidatePath("/customers", "layout"); revalidatePath("/opportunities", "layout"); return { ok: true as const, data }; }
  catch (error) { return toResult<{ taskId: string }>(error); }
}

export async function parseQuickFollowup(input: unknown) {
  const parsed = z.object({ text: z.string().max(1000) }).safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false as const, code: "VALIDATION_ERROR" as const, message: issue.message, field: issue.path.join(".") };
  }
  try {
    await requireSession();
    const data = parseQuickFollowupText(parsed.data.text);
    return { ok: true as const, data };
  } catch (error) {
    return toResult<ParsedFollowupSuggestion>(error);
  }
}

