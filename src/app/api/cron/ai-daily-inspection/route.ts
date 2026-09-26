import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyAiInspectionService } from "@/core/insight/daily-inspection";

function isValidCronSecret(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const provHash = createHash("sha256").update(provided, "utf8").digest();
  const expHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(provHash, expHash);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret") || (
    request.headers.get("authorization")?.startsWith("Bearer ")
      ? request.headers.get("authorization")?.slice(7)
      : null
  );

  if (!isValidCronSecret(provided, expected)) {
    return NextResponse.json(
      { code: "UNAUTHENTICATED", message: "AI 每日巡检定时任务密钥无效" },
      { status: 401 },
    );
  }

  try {
    const result = await runDailyAiInspectionService(new Date());
    if (result.elapsedMs > 30_000) {
      console.warn("AI daily inspection scan exceeded 30 seconds", result);
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("AI daily inspection scheduled scan failed:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "AI 每日巡检执行失败" },
      { status: 500 },
    );
  }
}
