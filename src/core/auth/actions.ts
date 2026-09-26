"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { jwtVerify } from "jose";
import { authenticate } from "./service";
import { withTenant } from "@/core/tenant";
import type { AuthResult, Role } from "./types";

function sessionSecret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthResult<{ userId: string; tenantId: string; role: Role }>> {
  const result = await authenticate(input);
  if (!result.ok) {
    return result;
  }

  const { token, ...data } = result.data;
  (await cookies()).set("salescrm_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return { ok: true, data };
}

export async function logout(): Promise<never> {
  let preserveCookie = false;
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("salescrm_session")?.value;
    if (token) {
      let claims: { userId: string; tenantId: string; sessionVersion: number } | null = null;
      try {
        const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
        const candidate = payload as { userId?: string; tenantId?: string; sessionVersion?: number };
        if (candidate.userId && candidate.tenantId && typeof candidate.sessionVersion === "number") {
          claims = {
            userId: candidate.userId,
            tenantId: candidate.tenantId,
            sessionVersion: candidate.sessionVersion,
          };
        }
      } catch {}

      if (claims) {
        const validClaims = claims;
        try {
          await withTenant(validClaims.tenantId, async (tx) => {
            const cur = await tx.execute<{ session_version: number }>(sql`
              select session_version from public.users
              where id = ${validClaims.userId}::uuid and tenant_id = ${validClaims.tenantId}::uuid
              limit 1
              for update
            `);
            const current = cur.rows[0]?.session_version;
            if (current !== undefined && current === validClaims.sessionVersion) {
              await tx.execute(sql`
                update public.users
                set session_version = session_version + 1, updated_at = now()
                where id = ${validClaims.userId}::uuid and tenant_id = ${validClaims.tenantId}::uuid
              `);
              await tx.execute(sql`
                insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
                values (${validClaims.tenantId}::uuid, ${validClaims.userId}::uuid, 'auth.logout', 'user', ${validClaims.userId}::uuid, ${JSON.stringify({ sessionVersion: validClaims.sessionVersion })}::jsonb)
              `);
            }
          });
        } catch (error) {
          preserveCookie = true;
          throw error;
        }
      }
    }
  } catch (error) {
    console.error("logout error", error);
    if (preserveCookie) throw error;
  } finally {
    if (!preserveCookie) {
      try {
        (await cookies()).delete("salescrm_session");
      } catch {}
    }
  }
  redirect("/login");
}
