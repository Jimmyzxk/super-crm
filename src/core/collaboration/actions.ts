"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  getCustomerCollaborationSettingsService,
  getInterventionWinRateAnalyticsService,
  listDealInterventionsService,
  requestManagerInterventionService,
  resolveManagerInterventionService,
  updateCustomerCollaborationSettingsService,
} from "./service";
import type {
  CustomerCollaborationSettings,
  DealInterventionItem,
  InterventionStatus,
  InterventionWinRateAnalytics,
  RequestInterventionInput,
  ResolveInterventionInput,
  UpdateCustomerCollaborationSettingsInput,
} from "./types";

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function requestManagerInterventionAction(
  input: RequestInterventionInput,
): Promise<Result<DealInterventionItem>> {
  return run(async () => {
    const session = await requireSession();
    return requestManagerInterventionService(session, input);
  });
}

export async function resolveManagerInterventionAction(
  input: ResolveInterventionInput,
): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "MANAGER" && session.role !== "ADMIN") {
      throw new Error("仅业务主管或管理员有权录入协同指导并解决介入");
    }
    return resolveManagerInterventionService(session, input);
  });
}

export async function listDealInterventionsAction(params?: {
  opportunityId?: string;
  status?: InterventionStatus;
  assignedManagerId?: string;
}): Promise<Result<DealInterventionItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listDealInterventionsService(session, params);
  });
}

export async function getInterventionWinRateAnalyticsAction(): Promise<Result<InterventionWinRateAnalytics>> {
  return run(async () => {
    const session = await requireSession();
    return getInterventionWinRateAnalyticsService(session);
  });
}

export async function getCustomerCollaborationSettingsAction(): Promise<Result<CustomerCollaborationSettings>> {
  return run(async () => {
    const session = await requireSession();
    return getCustomerCollaborationSettingsService(session);
  });
}

export async function updateCustomerCollaborationSettingsAction(
  input: UpdateCustomerCollaborationSettingsInput,
): Promise<Result<CustomerCollaborationSettings>> {
  return run(async () => {
    const session = await requireSession();
    const result = await updateCustomerCollaborationSettingsService(session, input);
    revalidatePath("/settings");
    revalidatePath("/customers", "layout");
    revalidatePath("/opportunities", "layout");
    return result;
  });
}

