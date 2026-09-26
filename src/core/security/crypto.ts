import crypto from "node:crypto";

/**
 * 获取用于 AES-256-GCM 加密的 32 字节主密钥
 * 优先读取 ENCRYPTION_KEY：
 *   - 若为 64 位十六进制字符串，按 hex 解码为 32 字节（保留完整 256 位熵，消除熵减半）
 *   - 若长度 >= 32，按 utf8 截取前 32 字节
 * 缺省时从 SESSION_SECRET 派生（sha256 摘要得到 32 字节）
 * 生产环境严格 fail-fast：若未配置合规密钥则直接抛错中断启动（对齐 session.ts 模式）
 */
function getMasterEncryptionKey(): Buffer {
  const encKey = process.env.ENCRYPTION_KEY?.trim();
  if (encKey) {
    if (/^[0-9a-fA-F]{64}$/.test(encKey)) {
      return Buffer.from(encKey, "hex");
    }
    if (encKey.length >= 32) {
      return Buffer.from(encKey.slice(0, 32), "utf8");
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY must be a 64-character hex string or at least 32 characters in production");
    }
  }

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    return crypto.createHash("sha256").update(sessionSecret).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY or SESSION_SECRET (at least 32 characters) must be configured in production");
  }

  return crypto.createHash("sha256").update("default-insecure-crm-secret-key-32b").digest();
}

/**
 * 使用 AES-256-GCM 对敏感密钥执行信封加密
 * 返回格式: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain || plain.trim() === "") return null;
  const raw = plain.trim();
  if (raw.startsWith("enc:v1:")) {
    return raw; // 已加密，避免重复加密
  }

  const key = getMasterEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(raw, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function getSessionSecretDerivedKey(): Buffer | null {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret && sessionSecret.length >= 32) {
    return crypto.createHash("sha256").update(sessionSecret).digest();
  }
  return null;
}

/**
 * 对存储的敏感字段执行解密
 * 兼容识别存量明文：若不是 enc:v1: 前缀，直接返回原值（透明兼容）
 * 迁移期容错：若当前主密钥解密失败，自动尝试用 SESSION_SECRET 派生密钥进行二次容错解密
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored || stored.trim() === "") return null;
  const val = stored.trim();
  if (!val.startsWith("enc:v1:")) {
    // 存量明文数据，直接返回
    return val;
  }

  const parts = val.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || parts[1] !== "v1") {
    return val;
  }

  const ivHex = parts[2];
  const tagHex = parts[3];
  const cipherHex = parts[4];

  const tryDecryptWithKey = (key: Buffer): string | null => {
    try {
      const iv = Buffer.from(ivHex, "hex");
      const tag = Buffer.from(tagHex, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(cipherHex, "hex")),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  };

  try {
    // 1. 优先使用当前主密钥解密
    const primaryKey = getMasterEncryptionKey();
    const primaryResult = tryDecryptWithKey(primaryKey);
    if (primaryResult !== null) {
      return primaryResult;
    }

    // 2. 迁移期二次容错：若主密钥解密失败，尝试使用 SESSION_SECRET 派生密钥解密
    const fallbackKey = getSessionSecretDerivedKey();
    if (fallbackKey && !fallbackKey.equals(primaryKey)) {
      const fallbackResult = tryDecryptWithKey(fallbackKey);
      if (fallbackResult !== null) {
        return fallbackResult;
      }
    }
  } catch (err) {
    console.error("AES-256-GCM 密钥派生异常:", err);
  }

  console.error("AES-256-GCM 解密敏感数据失败（主密钥与二次容错密钥均未匹配）");
  return null;
}

/**
 * 敏感密钥脱敏辅助（先解密再掩码）
 */
export function maskSecretKey(stored: string | null | undefined): string | null {
  const plain = decryptSecret(stored);
  if (!plain) return null;
  if (plain.length <= 8) return "••••••••";
  const head = plain.slice(0, 4);
  return `${head}****`;
}
