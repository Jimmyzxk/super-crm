import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, maskSecretKey } from "@/core/security/crypto";

describe("crypto security envelope encryption", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("decrypts data encrypted with a 64-char hex key correctly", () => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const plain = "sk-ant-api03-secret-test-token-123456";
    const enc = encryptSecret(plain);
    expect(enc).toBeTruthy();
    expect(enc?.startsWith("enc:v1:")).toBe(true);

    const decrypted = decryptSecret(enc);
    expect(decrypted).toBe(plain);
  });

  it("fails fast in production when no encryption key or session secret is configured", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;

    expect(() => {
      encryptSecret("sensitive-data");
    }).toThrow(/ENCRYPTION_KEY or SESSION_SECRET/);
  });

  it("fails fast in production when ENCRYPTION_KEY is too short", () => {
    Object.assign(process.env, { NODE_ENV: "production", ENCRYPTION_KEY: "short-key" });
    delete process.env.SESSION_SECRET;

    expect(() => {
      encryptSecret("sensitive-data");
    }).toThrow(/ENCRYPTION_KEY must be a 64-character hex string/);
  });

  it("masks decrypted secret properly", () => {
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const enc = encryptSecret("sk-1234567890abcdef");
    expect(maskSecretKey(enc)).toBe("sk-1****");
  });

  it("tolerates key rotation / migration by falling back to SESSION_SECRET derived key when primary key fails", () => {
    // 阶段 1：使用 SESSION_SECRET 加密数据（存量历史数据）
    delete process.env.ENCRYPTION_KEY;
    process.env.SESSION_SECRET = "legacy-session-secret-at-least-32-chars-long";
    const plain = "sk-legacy-migrated-secret-key-9999";
    const encryptedWithSessionSecret = encryptSecret(plain);
    expect(encryptedWithSessionSecret).toBeTruthy();

    // 阶段 2：引入全新的独立 ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    // 主密钥不同，首次解密失败后通过 SESSION_SECRET 二次容错解密成功
    const fallbackDecrypted = decryptSecret(encryptedWithSessionSecret);
    expect(fallbackDecrypted).toBe(plain);
  });
});
