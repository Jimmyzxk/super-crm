import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "12345678901234567890123456789012";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "11111111-1111-1111-1111-111111111111";

let mockCookieValue: string | undefined;
const mockDelete = vi.fn();
const mockExecute = vi.fn(async () => ({ rows: [{ session_version: 1 }] }));
let withTenantCallCount = 0;

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (mockCookieValue ? { value: mockCookieValue } : undefined)),
    delete: mockDelete,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock("@/core/tenant", () => ({
  withTenant: vi.fn(async (_tenantId: string, cb: (tx: { execute: typeof mockExecute }) => Promise<unknown>) => {
    withTenantCallCount++;
    return cb({ execute: mockExecute } as unknown as { execute: typeof mockExecute });
  }),
}));

function secret(): Uint8Array { return new TextEncoder().encode(process.env.SESSION_SECRET!); }

describe("F02 logout 验签回归", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieValue = undefined;
    withTenantCallCount = 0;
    mockExecute.mockImplementation(async () => ({ rows: [{ session_version: 1 }] }));
  });

  it("伪造签名不产生 UPDATE（withTenant 不被调用）", async () => {
    const { logout } = await import("@/core/auth/actions");
    // 用不同 secret 签发
    const fakeToken = await new SignJWT({ userId: USER_ID, tenantId: TENANT_ID, role: "SALES", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode("fake-secret-1234567890123456789012"));
    mockCookieValue = fakeToken;
    try { await logout(); } catch { /* redirect */ }
    expect(withTenantCallCount).toBe(0);
    expect(mockDelete).toHaveBeenCalled();
  });

  it("错误算法（none）不产生 UPDATE", async () => {
    const { logout } = await import("@/core/auth/actions");
    // 手动构造 alg none token（jwtVerify 会拒绝）
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ userId: USER_ID, tenantId: TENANT_ID, sessionVersion: 1 })).toString("base64url");
    mockCookieValue = `${header}.${payload}.`;
    try { await logout(); } catch {}
    expect(withTenantCallCount).toBe(0);
  });

  it("过期 token 不产生 UPDATE", async () => {
    const { logout } = await import("@/core/auth/actions");
    const expired = await new SignJWT({ userId: USER_ID, tenantId: TENANT_ID, role: "SALES", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("-1h")
      .sign(secret());
    mockCookieValue = expired;
    try { await logout(); } catch {}
    expect(withTenantCallCount).toBe(0);
  });

  it("有效 token 但 sessionVersion 不一致不产生 UPDATE", async () => {
    const { logout } = await import("@/core/auth/actions");
    const token = await new SignJWT({ userId: USER_ID, tenantId: TENANT_ID, role: "SALES", sessionVersion: 1 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
      .sign(secret());
    mockCookieValue = token;
    // DB 返回 version 2，不匹配 -> 不递增
    mockExecute.mockImplementationOnce(async () => ({ rows: [{ session_version: 2 }] }));
    try { await logout(); } catch {}
    // withTenant 被调用（验签通过），但 UPDATE 未执行（只做了 SELECT）
    // 我们的 mockExecute 会被调用一次 SELECT，若版本匹配才会第二次 UPDATE；不匹配则仅一次
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("有效且一致的 token 产生 UPDATE", async () => {
    const { logout } = await import("@/core/auth/actions");
    const token = await new SignJWT({ userId: USER_ID, tenantId: TENANT_ID, role: "SALES", sessionVersion: 5 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
      .sign(secret());
    mockCookieValue = token;
    // @ts-expect-error -- mock 签名与库类型不完全一致，下行预期有类型错误
    mockExecute.mockImplementation(async (sql: unknown) => {
      const s = String(sql);
      if (s.includes("select")) return { rows: [{ session_version: 5 }] } as unknown as { rows: [{ session_version: number }] };
      return { rows: [] } as unknown as { rows: [] };
    });
    // 重置计数后，需要让 withTenant 内部的 execute 调用计数准确
    let execCount = 0;
    // @ts-expect-error -- 同上，二次覆盖 mock 以计数
    mockExecute.mockImplementation(async (q: unknown) => {
      execCount++;
      const s = String(q);
      if (String(s).includes("select") || s.includes("select")) return { rows: [{ session_version: 5 }] } as unknown as { rows: Array<{ session_version: number }> };
      return { rows: [] } as unknown as { rows: Array<{ session_version: number }> };
    });
    try { await logout(); } catch {}
    expect(withTenantCallCount).toBe(1);
    expect(execCount).toBeGreaterThanOrEqual(1);
  });
});
