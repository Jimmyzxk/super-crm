import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { scanTaskNotificationsService } from "@/core/notification/service";
import { scanSalesInsightsService } from "@/core/insight/service";

function isValidCronSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const provHash = createHash("sha256").update(provided, "utf8").digest();
  const expHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(provHash, expHash);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");
  if (!isValidCronSecret(provided, expected)) {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "定时任务密钥无效" }, { status: 401 });
  }

  try {
    const now = new Date();
    const notifications = await scanTaskNotificationsService(now);
    const insights = await scanSalesInsightsService(now);
    if (notifications.elapsedMs > 30_000) console.warn("notification scan exceeded 30 seconds", notifications);
    if (insights.elapsedMs > 30_000) console.warn("sales insight scan exceeded 30 seconds", insights);
    return NextResponse.json({ notifications, insights });
  } catch (error) {
    console.error("scheduled scan failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "定时扫描失败" }, { status: 500 });
  }
}
