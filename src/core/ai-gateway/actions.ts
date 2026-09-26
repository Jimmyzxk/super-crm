"use server";

import { requireSession } from "@/core/auth/session";
import { testLlmConnectivityService } from "./client";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function testLlmConnectivityAction(input: {
  provider: string;
  apiKey: string;
  apiEndpoint?: string | null;
  modelName?: string;
}): Promise<
  ActionResult<{
    success: boolean;
    latencyMs: number;
    model: string;
    responsePreview: string;
    errorMessage?: string;
    /** 目标主机是否命中 AI_GATEWAY_ALLOW_HOSTS 白名单（未命中即零外发） */
    allowListMatched: boolean;
    /** 租户 AI 总开关状态：false 表示"AI 已关闭下仍发生了显式外呼"，已在审计留痕 */
    aiCopilotEnabled: boolean;
  }>
> {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") {
      return { ok: false, message: "仅系统管理员可执行模型连通性测试" };
    }
    const result = await testLlmConnectivityService(session, input);
    if (!result.success) {
      return {
        ok: false,
        message: result.errorMessage || "连接测试失败",
      };
    }
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "连接测试发生异常",
    };
  }
}
