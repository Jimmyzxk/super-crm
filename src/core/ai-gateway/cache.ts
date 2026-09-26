import crypto from "crypto";

interface CacheEntry<T = unknown> {
  tenantId: string;
  data: T;
  rawText: string;
  provider: string;
  modelName: string;
  cachedAt: number;
  expiresAt: number;
}

// 内存级高速 LRU (Least Recently Used) 缓存池
const memoryCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 1000;

/**
 * 生成语义化或事实指纹哈希
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function generateAiCacheKey(
  tenantId: string,
  scene: string,
  contextFactors: Record<string, unknown> | string,
): string {
  const contextStr =
    typeof contextFactors === "string"
      ? contextFactors
      : stableStringify(contextFactors);
  const hash = crypto.createHash("sha256").update(`${tenantId}:${scene}:${contextStr}`).digest("hex").slice(0, 32);
  return `ai_cache:${tenantId}:${scene}:${hash}`;
}

/**
 * 查询 AI 缓存 (LRU: 命中后移动至队尾)
 */
export function getAiCache<T = unknown>(cacheKey: string): {
  data: T;
  rawText: string;
  provider: string;
  modelName: string;
  cachedAt: number;
} | null {
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(cacheKey);
    return null;
  }

  // LRU 命中刷新：先删除再存入队尾
  memoryCache.delete(cacheKey);
  memoryCache.set(cacheKey, entry);

  return {
    // 缓存条目以 unknown 存储、按调用方泛型读出（写入方保证 T 一致）
    data: entry.data as T,
    rawText: entry.rawText,
    provider: entry.provider,
    modelName: entry.modelName,
    cachedAt: entry.cachedAt,
  };
}

/**
 * 写入 AI 缓存 (LRU 淘汰最久未访问条目)
 */
export function setAiCache<T = unknown>(
  cacheKey: string,
  result: {
    data: T;
    rawText: string;
    provider: string;
    modelName: string;
  },
  ttlSeconds = 7200, // 默认 2 小时
): void {
  // 若已存在先删除，保证新写入在队尾
  if (memoryCache.has(cacheKey)) {
    memoryCache.delete(cacheKey);
  } else if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    // 淘汰最久未使用的头部条目
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }

  // 从 cacheKey 提取 tenantId (`ai_cache:<tenantId>:<scene>:<hash>`)
  const parts = cacheKey.split(":");
  const tenantId = parts.length >= 2 ? parts[1] : "";

  memoryCache.set(cacheKey, {
    tenantId,
    data: result.data,
    rawText: result.rawText,
    provider: result.provider,
    modelName: result.modelName,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * 手动失效特定缓存
 */
export function invalidateAiCache(cacheKey: string): void {
  memoryCache.delete(cacheKey);
}

/**
 * 按租户批量失效 AI 缓存 (模型配置或场景策略变更时触发)
 */
export function invalidateAiCacheByTenant(tenantId: string): void {
  for (const [key, entry] of memoryCache.entries()) {
    if (entry.tenantId === tenantId || key.startsWith(`ai_cache:${tenantId}:`)) {
      memoryCache.delete(key);
    }
  }
}
