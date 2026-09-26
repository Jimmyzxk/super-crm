import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runPublicPoolRecycleForAllTenantsService } from "@/core/public-pool/service";

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
    // 租户枚举与审计 actor 解析由 core 默认实现承担——
    // route 层不允许直接持有 DB 连接（分层约束）
    const summaries = await runPublicPoolRecycleForAllTenantsService();

    const failed = summaries.filter((s) => s.status === "FAILED");
    if (failed.length > 0) {
      console.error("public pool auto recycle partial failure", JSON.stringify(failed));
    }
    return NextResponse.json({ ok: true, summaries });
  } catch (error) {
    console.error("public pool auto recycle cron failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ code: "INTERNAL_ERROR", message: "公海自动回收定时任务执行失败" }, { status: 500 });
  }
}
