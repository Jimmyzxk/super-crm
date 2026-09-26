"use server";

import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  clearAnalyticsDemoDataService,
  generateAnalyticsDemoDataService,
} from "./seed";
import {
  getExecutiveForecastService,
  getSalesRadarService,
  getTeamEfficiencyService,
  listAnalyticsTeamMembersService,
} from "./service";
import type {
  AnalyticsFilterParams,
  ExecutiveForecastData,
  SalesRadarData,
  TeamFunnelData,
  TeamMemberOption,
} from "./types";

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function getSalesRadarAction(
  params?: AnalyticsFilterParams
): Promise<Result<SalesRadarData>> {
  return run(async () => getSalesRadarService(await requireSession(), params));
}

export async function getTeamEfficiencyAction(
  params?: AnalyticsFilterParams
): Promise<Result<TeamFunnelData>> {
  return run(async () => getTeamEfficiencyService(await requireSession(), params));
}

export async function getExecutiveForecastAction(
  params?: AnalyticsFilterParams
): Promise<Result<ExecutiveForecastData>> {
  return run(async () => getExecutiveForecastService(await requireSession(), params));
}

export async function listAnalyticsTeamMembersAction(): Promise<Result<TeamMemberOption[]>> {
  return run(async () => listAnalyticsTeamMembersService(await requireSession()));
}

export async function generateAnalyticsDemoDataAction(): Promise<Result<{ success: boolean; message: string }>> {
  return run(async () => generateAnalyticsDemoDataService(await requireSession()));
}

export async function clearAnalyticsDemoDataAction(): Promise<Result<{ success: boolean; message: string }>> {
  return run(async () => clearAnalyticsDemoDataService(await requireSession()));
}
