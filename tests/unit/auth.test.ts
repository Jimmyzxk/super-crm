import { describe, expect, it, vi, beforeEach } from "vitest";
import { normalizeEmail } from "@/core/auth/types";
import { issueSession } from "@/core/auth/session";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "12345678901234567890123456789012";

let mockCookieValue: string | undefined;
const mockDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => (mockCookieValue ? { value: mockCookieValue } : undefined)),
    delete: mockDelete,
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const mockExecute = vi.fn(async () => ({ rows: [{ session_version: 1 }] }));
const mockWithTenant = vi.fn(async (_tenantId: string, callback: (tx: { execute: typeof mockExecute }) => Promise<unknown>) => {
  return callback({ execute: mockExecute } as unknown as { execute: typeof mockExecute });
});

vi.mock("@/core/tenant", () => ({
  withTenant: (tenantId: string, cb: (tx: { execute: typeof mockExecute }) => Promise<unknown>) => mockWithTenant(tenantId, cb),
}));

describe("阶段 0 认证规则", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieValue = undefined;
  });

  it("统一去首尾空格并转小写", () => {
    expect(normalizeEmail(" Alice@EXAMPLE.COM ")).toBe("alice@example.com");
  });

  it("logout 注销时使用 withTenant 递增 users.session_version 并清理 cookie", async () => {
    const { logout } = await import("@/core/auth/actions");

    const token = await issueSession({
      userId: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      role: "SALES",
      sessionVersion: 1,
    });
    mockCookieValue = token;

    await logout();

    // 校验带租户上下文调用
    expect(mockWithTenant).toHaveBeenCalledWith("22222222-2222-2222-2222-222222222222", expect.any(Function));
    expect(mockExecute).toHaveBeenCalledTimes(3);
    // 校验 cookie 被清理
    expect(mockDelete).toHaveBeenCalledWith("salescrm_session");
  });
});
