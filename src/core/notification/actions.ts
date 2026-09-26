"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { markAllNotificationsReadService, markNotificationReadService } from "./service";

function invalid<T>(error: z.ZodError): Result<T> {
  const issue = error.issues[0];
  return { ok: false, code: "VALIDATION_ERROR", message: issue.message, field: issue.path.join(".") || undefined };
}

export async function markNotificationRead(input: unknown) {
  const parsed = z.object({ notificationId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const data = await markNotificationReadService(await requireSession(), parsed.data.notificationId);
    revalidatePath("/inbox", "layout");
    return { ok: true as const, data };
  } catch (error) {
    return toResult(error);
  }
}

export async function markAllNotificationsRead() {
  try {
    const data = await markAllNotificationsReadService(await requireSession());
    revalidatePath("/inbox", "layout");
    return { ok: true as const, data };
  } catch (error) {
    return toResult(error);
  }
}
