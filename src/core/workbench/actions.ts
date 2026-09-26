"use server";

import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  getSalesLeaderboardService,
  type LeaderboardPeriod,
  type SalesLeaderboardData,
} from "./leaderboard";

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function getSalesLeaderboardAction(
  period: LeaderboardPeriod = "MONTHLY",
): Promise<Result<SalesLeaderboardData>> {
  return run(async () => {
    const session = await requireSession();
    return getSalesLeaderboardService(session, period);
  });
}
