import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getTenantStatusWithoutTenant, withTenant } from "@/core/tenant";
import type { TenantTransaction } from "@/core/tenant";
import { issueSession } from "./session";
import { normalizeEmail, type AuthResult, type Role } from "./types";

const DUMMY_PASSWORD_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6r9H8Vh1K";

type AuthUser = {
  id: string;
  tenant_id: string;
  password_hash: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  session_version: number;
  locked_until: Date | string | null;
};

type AuthenticationData = {
  userId: string;
  tenantId: string;
  role: Role;
  token: string;
};

async function insertAuthAudit(
  tx: TenantTransaction,
  user: AuthUser,
  action: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await tx.execute(sql`
    insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${user.tenant_id}, ${user.id}, ${action}, 'user', ${user.id}, ${JSON.stringify(detail)}::jsonb)
  `);
}

async function recordFailedLogin(user: AuthUser): Promise<void> {
  await withTenant(user.tenant_id, async (tx) => {
    const result = await tx.execute<{ failed_login_count: number; locked_until: Date | string | null }>(sql`
      update public.users
      set failed_login_count = failed_login_count + 1,
          locked_until = case
            when failed_login_count + 1 >= 5 then now() + interval '15 minutes'
            else locked_until
          end,
          updated_at = now()
      where id = ${user.id} and tenant_id = ${user.tenant_id}
      returning failed_login_count, locked_until
    `);
    const row = result.rows[0];
    if (row && Number(row.failed_login_count) >= 5 && row.locked_until && new Date(row.locked_until) > new Date()) {
      await insertAuthAudit(tx, user, "auth.login_locked", { reason: "failed_login_threshold" });
    }
  });
}

export async function authenticate(input: {
  email: string;
  password: string;
}): Promise<AuthResult<AuthenticationData>> {
  const email = normalizeEmail(input.email);
  if (!email || !input.password) {
    return { ok: false, code: "VALIDATION_ERROR", message: "请输入邮箱和密码" };
  }

  try {
    const result = await db.execute(sql`
      select * from public.auth_lookup_user(${email})
    `);
    const user = result.rows[0] as AuthUser | undefined;

    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      return { ok: false, code: "RATE_LIMITED", message: "登录失败次数过多，请 15 分钟后再试" };
    }

    const passwordMatches = await bcrypt.compare(
      input.password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      if (user) {
        await recordFailedLogin(user);
      }
      return { ok: false, code: "UNAUTHENTICATED", message: "邮箱或密码不正确" };
    }

    if (user.status !== "ACTIVE") {
      return { ok: false, code: "UNAUTHENTICATED", message: "该账号已停用，请联系管理员" };
    }

    const tenantStatus = await getTenantStatusWithoutTenant(user.tenant_id);
    if (tenantStatus !== "ACTIVE") {
      return { ok: false, code: "UNAUTHENTICATED", message: "该企业账号已停用" };
    }

    await withTenant(user.tenant_id, async (tx) => {
      await tx.execute(sql`
        update public.users
        set failed_login_count = 0, locked_until = null, updated_at = now()
        where id = ${user.id} and tenant_id = ${user.tenant_id}
      `);
      await insertAuthAudit(tx, user, "auth.login", { role: user.role });
    });

    const token = await issueSession({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      sessionVersion: user.session_version,
    });

    return {
      ok: true,
      data: { userId: user.id, tenantId: user.tenant_id, role: user.role, token },
    };
  } catch {
    return { ok: false, code: "INTERNAL_ERROR", message: "系统出错了，请稍后重试" };
  }
}
