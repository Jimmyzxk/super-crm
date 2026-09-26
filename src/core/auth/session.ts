import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { users, tenants, securityComplianceConfigs } from "@/db/schema";
import { withTenant, type TenantContext } from "@/core/tenant";
import type { SessionClaims } from "./types";

export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

const claimsSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  role: z.enum(["ADMIN", "MANAGER", "SALES"]),
  sessionVersion: z.number().int().positive(),
});

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function issueSession(data: SessionClaims): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function resolveSession(token: string): Promise<TenantContext> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const claims = claimsSchema.parse(payload);

    return await withTenant(claims.tenantId, async (tx) => {
      const [record] = await tx
        .select({
          userId: users.id,
          role: users.role,
          userStatus: users.status,
          sessionVersion: users.sessionVersion,
          tenantStatus: tenants.status,
          sessionTimeoutMinutes: securityComplianceConfigs.sessionTimeoutMinutes,
        })
        .from(users)
        .innerJoin(tenants, eq(users.tenantId, tenants.id))
        .leftJoin(securityComplianceConfigs, eq(tenants.id, securityComplianceConfigs.tenantId))
        .where(and(eq(users.id, claims.userId), eq(users.tenantId, claims.tenantId)));

      if (
        !record ||
        record.userStatus !== "ACTIVE" ||
        record.tenantStatus !== "ACTIVE" ||
        record.sessionVersion !== claims.sessionVersion
      ) {
        throw new UnauthenticatedError();
      }

      // 动态会话超时时间检验 (根据租户安全合规配置)
      const timeoutMinutes = record.sessionTimeoutMinutes ?? 120;
      const iat = payload.iat ?? 0;
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (iat > 0 && nowSeconds - iat > timeoutMinutes * 60) {
        throw new UnauthenticatedError();
      }

      return { tenantId: claims.tenantId, userId: record.userId, role: record.role };
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      throw error;
    }
    throw new UnauthenticatedError();
  }
}

import { cache } from "react";

export const requireSession = cache(async function requireSession(): Promise<TenantContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get("salescrm_session")?.value;
  if (!token) {
    throw new UnauthenticatedError();
  }
  const ctx = await resolveSession(token);
  // 会话滑动续期：requireSession 路径对剩余寿命不足一半的有效会话自动签发新 JWT cookie（HttpOnly 属性与现状一致）
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const claims = claimsSchema.parse(payload);
    const iat = (payload.iat as number) ?? 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    // 取租户配置的超时时间（复用 resolveSession 中已校验的逻辑，单独轻量查询避免重复 withTenant 开销过大）
    let timeoutMinutes = 120;
    try {
      const rec = await withTenant(claims.tenantId, async (tx) => {
        const [row] = await tx.select({ sessionTimeoutMinutes: securityComplianceConfigs.sessionTimeoutMinutes }).from(users).innerJoin(tenants, eq(users.tenantId, tenants.id)).leftJoin(securityComplianceConfigs, eq(tenants.id, securityComplianceConfigs.tenantId)).where(and(eq(users.id, claims.userId), eq(users.tenantId, claims.tenantId)));
        return row;
      });
      if (rec?.sessionTimeoutMinutes) timeoutMinutes = rec.sessionTimeoutMinutes;
    } catch {}
    const elapsed = iat > 0 ? nowSeconds - iat : 0;
    const remaining = timeoutMinutes * 60 - elapsed;
    if (iat > 0 && remaining > 0 && remaining < (timeoutMinutes * 60) / 2) {
      const newToken = await issueSession({ userId: claims.userId, tenantId: claims.tenantId, role: claims.role, sessionVersion: claims.sessionVersion });
      // 与登录态一致：HttpOnly, SameSite Lax, Secure in prod, 7d, path /
      try {
        cookieStore.set("salescrm_session", newToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 24 * 7,
          path: "/",
        });
      } catch {}
    }
  } catch {
    // 滑动续期失败不影响主流程
  }
  return ctx;
});
