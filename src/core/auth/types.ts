export type Role = "ADMIN" | "MANAGER" | "SALES";
export type AuthResult<T> = { ok: true; data: T } | { ok: false; code: "VALIDATION_ERROR" | "UNAUTHENTICATED" | "RATE_LIMITED" | "INTERNAL_ERROR"; message: string; field?: string };
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export type SessionClaims = {
  userId: string;
  tenantId: string;
  role: Role;
  sessionVersion: number;
};
