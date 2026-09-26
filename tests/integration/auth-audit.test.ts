import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;
process.env.SESSION_SECRET ||= "12345678901234567890123456789012";

let cookieValue: string | undefined;
const mockGet = vi.fn(() => cookieValue ? { value: cookieValue } : undefined);
const mockDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mockGet, delete: mockDelete })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const owner = new pg.Client({ connectionString: migrationUrl });
let tenantId: string;
let userId: string;

beforeAll(async () => {
  await owner.connect();
  const tenant = await owner.query<{ id: string }>("insert into tenants (name) values ('登出审计测试租户') returning id");
  tenantId = tenant.rows[0].id;
  const passwordHash = await bcrypt.hash("Password123", 12);
  const user = await owner.query<{ id: string }>(
    `insert into users (tenant_id, email, password_hash, name, role, status)
     values ($1, $2, $3, '登出审计用户', 'SALES', 'ACTIVE') returning id`,
    [tenantId, `logout-audit-${Date.now()}@example.com`, passwordHash],
  );
  userId = user.rows[0].id;
});

afterAll(async () => {
  if (tenantId) {
    await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
    await owner.query("delete from users where tenant_id = $1", [tenantId]);
    await owner.query("delete from tenants where id = $1", [tenantId]);
  }
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await owner.end();
});

describe("认证审计", () => {
  it("登出写入 auth.logout 且记录正确的操作者", async () => {
    const { issueSession } = await import("@/core/auth/session");
    const { logout } = await import("@/core/auth/actions");
    cookieValue = await issueSession({ userId, tenantId, role: "SALES", sessionVersion: 1 });
    mockGet.mockImplementation(() => cookieValue ? { value: cookieValue } : undefined);

    await logout();

    const audit = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      "select action, actor_user_id, subject_id from audit_logs where tenant_id = $1 and action = 'auth.logout'",
      [tenantId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: "auth.logout", actor_user_id: userId, subject_id: userId });
    expect(mockDelete).toHaveBeenCalledWith("salescrm_session");
  });
});
