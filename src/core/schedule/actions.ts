"use server";

import { z, ZodError } from "zod";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  completeSalesScheduleService,
  createSalesScheduleService,
  deleteSalesScheduleService,
  listSalesSchedulesService,
  updateSalesScheduleService,
} from "./service";
import type {
  CreateScheduleInput,
  SalesScheduleItem,
  ScheduleStatus,
  UpdateScheduleInput,
} from "./types";

const scheduleTypeSchema = z.enum(["CALL", "MEETING", "VISIT", "PROPOSAL_DEMO", "FOLLOW_UP"]);
const scheduleStatusSchema = z.enum(["PENDING", "COMPLETED", "CANCELLED"]);

const listSalesSchedulesSchema = z
  .object({
    userId: z.string().uuid("用户ID格式不正确").optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: scheduleStatusSchema.optional(),
  })
  .optional();

const createScheduleSchema = z.object({
  title: z.string().min(1, "日程标题不能为空").max(100, "日程标题长度不能超过100字"),
  scheduleType: scheduleTypeSchema,
  leadId: z.string().uuid("线索ID格式不正确").nullable().optional(),
  customerId: z.string().uuid("客户ID格式不正确").nullable().optional(),
  opportunityId: z.string().uuid("商机ID格式不正确").nullable().optional(),
  startAt: z.union([z.string(), z.date()]),
  endAt: z.union([z.string(), z.date()]).nullable().optional(),
  note: z.string().nullable().optional(),
});

const updateScheduleSchema = z.object({
  id: z.string().uuid("日程ID格式不正确"),
  title: z.string().min(1, "日程标题不能为空").max(100, "日程标题长度不能超过100字").optional(),
  scheduleType: scheduleTypeSchema.optional(),
  startAt: z.union([z.string(), z.date()]).optional(),
  endAt: z.union([z.string(), z.date()]).nullable().optional(),
  note: z.string().nullable().optional(),
  status: scheduleStatusSchema.optional(),
});

const scheduleIdSchema = z.string().uuid("日程ID格式不正确");

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      const issue = error.issues[0];
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: issue?.message || "输入参数格式不正确",
        field: issue?.path.join("."),
      };
    }
    return toResult<T>(error);
  }
}

export async function listSalesSchedulesAction(params?: {
  userId?: string;
  startDate?: string;
  endDate?: string;
  status?: ScheduleStatus;
}): Promise<Result<SalesScheduleItem[]>> {
  return run(async () => {
    const session = await requireSession();
    const validated = listSalesSchedulesSchema.parse(params);
    return listSalesSchedulesService(session, validated);
  });
}

export async function createSalesScheduleAction(
  input: CreateScheduleInput,
): Promise<Result<SalesScheduleItem>> {
  return run(async () => {
    const session = await requireSession();
    const validated = createScheduleSchema.parse(input);
    return createSalesScheduleService(session, validated as CreateScheduleInput);
  });
}

export async function completeSalesScheduleAction(
  scheduleId: string,
): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    const id = scheduleIdSchema.parse(scheduleId);
    return completeSalesScheduleService(session, id);
  });
}

export async function updateSalesScheduleAction(
  input: UpdateScheduleInput,
): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    const validated = updateScheduleSchema.parse(input);
    return updateSalesScheduleService(session, validated as UpdateScheduleInput);
  });
}

export async function deleteSalesScheduleAction(
  scheduleId: string,
): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    const id = scheduleIdSchema.parse(scheduleId);
    return deleteSalesScheduleService(session, id);
  });
}
