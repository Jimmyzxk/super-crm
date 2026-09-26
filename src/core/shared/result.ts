export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "COLLISION"
  | "DUPLICATE_PHONE"
  | "VALIDATION_ERROR"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; field?: string };

export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
  }
}

export function toResult<T>(error: unknown): Result<T> {
  if (error instanceof BusinessError) {
    return { ok: false, code: error.code, message: error.message, field: error.field };
  }
  if (isDuplicateContactPhone(error)) {
    return { ok: false, code: "DUPLICATE_PHONE", message: "该手机号已存在", field: "contactPhone" };
  }
  if (error instanceof Error && error.message === "UNAUTHENTICATED") {
    return { ok: false, code: "UNAUTHENTICATED", message: "请先登录" };
  }
  console.error(error);
  return { ok: false, code: "INTERNAL_ERROR", message: "系统出错了，请稍后重试" };
}

function isDuplicateContactPhone(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as { code?: string; constraint?: string; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "contacts_tenant_phone_unique") return true;
    current = candidate.cause;
  }
  return false;
}
