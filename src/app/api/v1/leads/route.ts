import { NextResponse } from "next/server";
import { apiLeadSchema } from "@/core/leads/types";
import { BusinessError } from "@/core/shared/result";
import { createApiLeadService, getRequestClientIp, lookupLeadSourceToken } from "@/core/leads/service";

function errorResponse(code: string, message: string, status: number, field?: string) {
  return NextResponse.json({ code, message, ...(field ? { field } : {}) }, { status });
}

function businessErrorResponse(error: BusinessError) {
  const status = error.code === "UNAUTHENTICATED" ? 401
    : error.code === "FORBIDDEN" ? 403
      : error.code === "IDEMPOTENCY_CONFLICT" || error.code === "CONFLICT" ? 409
        : error.code === "RATE_LIMITED" ? 429
          : error.code === "VALIDATION_ERROR" ? 400 : 500;
  return errorResponse(error.code, error.message, status, error.field);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!bearer) return errorResponse("UNAUTHENTICATED", "来源密钥无效", 401);

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) return errorResponse("VALIDATION_ERROR", "请提供 Idempotency-Key", 400, "Idempotency-Key");
  if (idempotencyKey.length > 100) return errorResponse("VALIDATION_ERROR", "幂等键不超过 100 字", 400, "Idempotency-Key");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "请求体必须是合法 JSON", 400);
  }
  const parsed = apiLeadSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return errorResponse("VALIDATION_ERROR", issue.message, 400, issue.path.join(".") || undefined);
  }

  try {
    const source = await lookupLeadSourceToken(bearer);
    if (!source || source.revokedAt || source.tenantStatus !== "ACTIVE") {
      return errorResponse("UNAUTHENTICATED", "来源密钥无效或已撤销", 401);
    }
    const result = await createApiLeadService(source, idempotencyKey, parsed.data, {
      clientIp: getRequestClientIp(request),
    });
    return NextResponse.json(
      { leadId: result.leadId, duplicateSuspected: result.duplicateSuspected },
      // 撞单拦截（leadId 为 null）按"已受理未新建"返回 200，区别于新建的 201
      { status: result.replay || result.leadId === null ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof BusinessError) return businessErrorResponse(error);
    console.error("lead API intake failed", error instanceof Error ? error.message : "unknown error");
    return errorResponse("INTERNAL_ERROR", "系统出错了，请稍后重试", 500);
  }
}
