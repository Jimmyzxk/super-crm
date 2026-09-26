import crypto from "crypto";
import { sql } from "drizzle-orm";
import { refreshInsightsSafely } from "@/core/insight/service";
import { createUnassignedPluginLeadInTransaction } from "@/core/leads/service";
import { leadFieldsSchema } from "@/core/leads/types";
import { resolveSession, requireSession } from "@/core/auth/session";
import { lookupLeadSourceToken } from "@/core/leads/service";
import { BusinessError, toResult } from "@/core/shared/result";
import { withTenant } from "@/core/tenant";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import type { Result } from "@/core/shared/result";
import type { PluginLeadContext, PluginOffboardHandler, PluginOffboardTransferResult, PluginServerContext } from "./types";

export { withTenant, type TenantContext, type TenantTransaction } from "@/core/tenant";
export { BusinessError, toResult, type Result } from "@/core/shared/result";
export { requireSession, resolveSession } from "@/core/auth/session";
export { createPluginNotificationInTransaction } from "./notifications";
export { getShanghaiDateString, addShanghaiDays } from "@/core/shared/date";
export { escapeSqlLike } from "@/core/shared/query";
// 周期口径（配额 period_key / timestamptz 业务时区边界）唯一实现：插件侧（如 BI）与
// core 侧（quota / analytics）必须共用，否则 period_key 格式与时区边界会再次分叉
export {
  buildQuotaPeriodKey,
  detectQuotaPeriodFromDateRange,
  timestamptzPeriodRangeSql,
  type QuotaPeriodType,
} from "@/core/shared/period";

export { runAgentLoop } from "@/core/ai-hub/agent-loop";
export { customerPortfolioStructureTool, revenueBySegmentTool } from "@/core/ai-hub/tools/company-profile";
export { topPerformersByRevenueTool } from "@/core/ai-hub/tools/champion";
export { getLostReasonDistributionTool } from "@/core/ai-hub/tools/attribution";
export { getPipelineSummaryTool } from "@/core/ai-hub/tools/analytics";
export { customerRevenueTieringTool, crossSellCandidatesTool, dormantHighValueTool, renewalPipelineTool } from "@/core/ai-hub/tools/growth";
export { runGrowthOpportunityAgent } from "@/core/ai-hub/agents/growth-opportunity";

export { assertSafeHttpUrl, callLlmGatewayService } from "@/core/ai-gateway/client";
export { generateAiCacheKey, getAiCache, setAiCache } from "@/core/ai-gateway/cache";
export {
  getPluginFactsProvider,
  registerPluginFactsProvider,
  defaultPluginFactsProvider,
  type PluginFactsProvider,
} from "@/core/plugin-facts";
export type { PluginOffboardHandler, PluginOffboardTransferResult };

const apiRateLimiterMap = new Map<string, { count: number; resetAt: number }>();

export function clearRateLimiterCache(): void {
  apiRateLimiterMap.clear();
}

export async function checkApiKeyRateLimit(
  subject: string,
  limitPerMinute: number = 60,
  tenantId?: string,
): Promise<boolean> {
  const now = Date.now();

  // 定期/惰性清理过期条目，防止内存无限膨胀
  if (apiRateLimiterMap.size > 1000) {
    for (const [k, v] of apiRateLimiterMap.entries()) {
      if (now > v.resetAt) {
        apiRateLimiterMap.delete(k);
      }
    }
  }

  // 1. L1 进程内存缓存快速阻断
  const memEntry = apiRateLimiterMap.get(subject);
  if (memEntry && now <= memEntry.resetAt && memEntry.count >= limitPerMinute) {
    return false;
  }

  // 2. 解析有效租户 ID，执行 DB 原子计数 UPSERT
  let effectiveTenantId = tenantId;
  if (!effectiveTenantId && subject.startsWith("user:")) {
    const parts = subject.split(":");
    if (parts.length >= 3) {
      effectiveTenantId = parts[1];
    }
  }

  if (effectiveTenantId) {
    try {
      const res = await withTenant(effectiveTenantId, async (tx) => {
        return await tx.execute<{ count: number; window_started_at: string }>(sql`
          insert into public.plugin_rate_limits (tenant_id, subject, window_started_at, count, updated_at)
          values (${effectiveTenantId}::uuid, ${subject}, now(), 1, now())
          on conflict (tenant_id, subject)
          do update set
            count = case
              when plugin_rate_limits.window_started_at <= now() - interval '1 minute' then 1
              else plugin_rate_limits.count + 1
            end,
            window_started_at = case
              when plugin_rate_limits.window_started_at <= now() - interval '1 minute' then now()
              else plugin_rate_limits.window_started_at
            end,
            updated_at = now()
          returning count, window_started_at::text as window_started_at
        `);
      });

      const currentCount = res.rows[0]?.count ?? 1;
      const windowStartedAt = res.rows[0]?.window_started_at ? new Date(res.rows[0].window_started_at).getTime() : now;
      const remaining = Math.max(0, 60_000 - (now - windowStartedAt));
      const resetAt = now + (remaining > 0 ? remaining : 60_000);
      apiRateLimiterMap.set(subject, { count: currentCount, resetAt });
      return currentCount <= limitPerMinute;
    } catch (err) {
      console.error("DB rate limit atomic counter error, fallback to memory:", err);
    }
  }

  // 3. Fallback: 进程内存计数
  if (!memEntry || now > memEntry.resetAt) {
    apiRateLimiterMap.set(subject, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (memEntry.count >= limitPerMinute) {
    return false;
  }
  memEntry.count++;
  return true;
}

export async function resolvePluginApiSession(
  req: Request,
  requiredScope?: string | string[],
  pluginKey?: string,
): Promise<TenantContext> {
  const auth = req.headers.get("authorization") ?? "";
  const apiKeyHeader = req.headers.get("x-api-key");
  const bearer = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] || apiKeyHeader?.trim();

  let ctx: TenantContext;

  if (bearer) {
    // 1. 尝试作为用户 JWT session 校验
    try {
      const session = await resolveSession(bearer);
      if (session) {
        ctx = session;

        // JWT 会话限流接入 (每个用户 300 次/分钟，DB 原子计数 + L1 内存缓存)
        const userRateLimitKey = `user:${ctx.tenantId}:${ctx.userId}`;
        if (!await checkApiKeyRateLimit(userRateLimitKey, 300, ctx.tenantId)) {
          throw new BusinessError("RATE_LIMITED", "用户会话请求过于频繁，请稍后重试");
        }

        if (pluginKey) {
          const isEnabled = await getPluginEnabledState(ctx.tenantId, pluginKey);
          if (!isEnabled) {
            throw new BusinessError("FORBIDDEN", `该功能插件 [${pluginKey}] 已被企业管理员停用，API 接口拒绝访问`);
          }
        }
        return ctx;
      }
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      // 忽略继续尝试 API Key
    }

    // 2. 尝试作为系统外部 API Key (sk_live_...) 校验
    if (bearer.startsWith("sk_") || bearer.length >= 20) {
      const source = await lookupLeadSourceToken(bearer).catch(() => null);
      if (source && !source.revokedAt && source.tenantStatus === "ACTIVE") {
        const allowedRoles = ["ADMIN", "MANAGER", "SALES"];
        const effectiveRole = source.actorRole as TenantContext["role"];
        if (!effectiveRole || !allowedRoles.includes(effectiveRole)) {
          throw new BusinessError("FORBIDDEN", "API Key 未绑定有效的授权访问角色，拒绝访问");
        }

        // 查询该 API Key 配置的 rate_limit_per_minute 与 scopes 并执行校验（带 45s TTL 缓存，键含 tenantId/key 稳定哈希，防 A key scopes 串给 B key）
        let keyInfo: { rows: Array<{ rateLimitPerMinute: number; scopes: string[]; allowedIpRanges: string | null }> };
        const bearerHash = crypto.createHash("sha256").update(bearer).digest("hex").slice(0, 16);
        const lsCacheKey = `${source.tenantId}:${source.sourceKeyId}:${bearerHash}`;
        const lsCached = leadSourceKeyCache.get(lsCacheKey);
        if (lsCached && Date.now() < lsCached.expiresAt) {
          keyInfo = { rows: [lsCached.data] };
        } else {
          if (lsCached) leadSourceKeyCache.delete(lsCacheKey);
          keyInfo = await withTenant(source.tenantId, async (tx) => {
            return await tx.execute<{ rateLimitPerMinute: number; scopes: string[]; allowedIpRanges: string | null }>(sql`
              select rate_limit_per_minute as "rateLimitPerMinute", scopes, allowed_ip_ranges as "allowedIpRanges"
              from public.lead_source_keys
              where tenant_id = ${source.tenantId}::uuid and id = ${source.sourceKeyId}::uuid
            `);
          });
          if (keyInfo.rows[0]) {
            leadSourceKeyCache.set(lsCacheKey, { data: keyInfo.rows[0], expiresAt: Date.now() + PLUGIN_TTL_MS });
            if (leadSourceKeyCache.size > 500) {
              const first = leadSourceKeyCache.keys().next().value;
              if (first) leadSourceKeyCache.delete(first);
            }
          }
        }

        if (!keyInfo.rows[0]) {
          throw new BusinessError("UNAUTHENTICATED", "API Key 配置信息不存在或已失效");
        }

        // IP 白名单准入校验 (如果配置了 allowed_ip_ranges)
        const allowedIps = keyInfo.rows[0].allowedIpRanges?.trim();
        if (allowedIps) {
          const clientIp =
            req.headers.get("x-real-ip")?.trim() ||
            req.headers.get("x-forwarded-for")?.split(",").map(s => s.trim()).filter(Boolean).pop() ||
            "";
          const ipList = allowedIps.split(/[\s,;]+/).filter(Boolean);
          if (ipList.length > 0) {
            if (!clientIp || (!ipList.includes(clientIp) && !ipList.includes("*"))) {
              throw new BusinessError("FORBIDDEN", `客户端 IP [${clientIp || "unknown"}] 不在 API Key 允许的白名单列表中`);
            }
          }
        }

        const limit = keyInfo.rows[0].rateLimitPerMinute ?? 60;
        if (!await checkApiKeyRateLimit(`key:${source.sourceKeyId}`, limit, source.tenantId)) {
          throw new BusinessError("RATE_LIMITED", "API 调用频次超出配额限制，请稍后重试");
        }

        if (requiredScope) {
          const reqScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
          const grantedScopes: string[] = Array.isArray(keyInfo.rows[0]?.scopes)
            ? keyInfo.rows[0].scopes
            : ["leads:write"];

          const hasAccess =
            grantedScopes.includes("*") ||
            reqScopes.some((s) => grantedScopes.includes(s));

          if (!hasAccess) {
            throw new BusinessError(
              "FORBIDDEN",
              `API Key 缺少访问权限，需要 Scope [${reqScopes.join(" 或 ")}]，当前拥有 [${grantedScopes.join(", ")}]`,
            );
          }
        }

        ctx = {
          tenantId: source.tenantId,
          userId: source.createdByUserId,
          role: effectiveRole,
        };

        if (pluginKey) {
          const isEnabled = await getPluginEnabledState(ctx.tenantId, pluginKey);
          if (!isEnabled) {
            throw new BusinessError("FORBIDDEN", `该功能插件 [${pluginKey}] 已被企业管理员停用，API 接口拒绝访问`);
          }
        }

        return ctx;
      }
    }
  }

  // 3. 回退至 Cookie Session
  ctx = await requireSession();
  const userRateLimitKey = `user:${ctx.tenantId}:${ctx.userId}`;
  if (!await checkApiKeyRateLimit(userRateLimitKey, 300, ctx.tenantId)) {
    throw new BusinessError("RATE_LIMITED", "用户会话请求过于频繁，请稍后重试");
  }

  if (pluginKey) {
    const isEnabled = await getPluginEnabledState(ctx.tenantId, pluginKey);
    if (!isEnabled) {
      throw new BusinessError("FORBIDDEN", `该功能插件 [${pluginKey}] 已被企业管理员停用，API 接口拒绝访问`);
    }
  }
  return ctx;
}

const offboardHandlers: PluginOffboardHandler[] = [];

export function registerPluginOffboardHandler(handler: PluginOffboardHandler): void {
  offboardHandlers.push(handler);
}

export async function runPluginOffboardHooks(
  tx: TenantTransaction,
  ctx: TenantContext,
  targetUserId: string,
  transferToUserId: string,
): Promise<PluginOffboardTransferResult[]> {
  const results: PluginOffboardTransferResult[] = [];
  for (const handler of offboardHandlers) {
    const res = await handler(tx, ctx, targetUserId, transferToUserId);
    results.push(res);
  }
  return results;
}

const pluginKeyPattern = /^[a-z][a-z0-9-]{2,49}$/;

export { leadFieldsSchema as pluginLeadFieldsSchema };

/** V1 first-party plugin storage only; callers must limit SQL to plugin-owned tables. */
export function withPluginTenantTransaction<T>(tenantId: string, operation: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  return withTenant(tenantId, operation);
}

export async function refreshPluginLeadInsightsSafely(ctx: TenantContext, leadId: string): Promise<void> {
  await refreshInsightsSafely(ctx, { type: "lead", id: leadId });
}

export async function requirePluginSession(): Promise<TenantContext> {
  return requireSession();
}

export async function recordPluginAuditLog(
  tx: TenantTransaction,
  ctx: TenantContext,
  action: string,
  subjectType: string,
  subjectId: string,
  detail: object = {}
): Promise<void> {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, ${subjectType}, ${subjectId}::uuid, ${JSON.stringify(detail)}::jsonb)`);
}

export function toPluginResult<T>(error: unknown): Result<T> {
  return toResult<T>(error);
}

import { cache } from "react";

/**
 * 本仓库编译进 registry 的插件 key 全集（框架契约）。
 * 开源版不含任何业务插件实现，故为空数组；闭源插件包挂载后在此登记即可。
 */
export const ALL_REGISTERED_PLUGIN_KEYS: readonly string[] = [];

export const listEnabledPluginKeys = cache(async function listEnabledPluginKeys(ctx: TenantContext): Promise<string[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ pluginKey: string }>(sql`
      select plugin_key as "pluginKey"
      from plugin_registry
      where tenant_id = ${ctx.tenantId} and enabled = true
      order by plugin_key
    `);
    return result.rows.map((row) => row.pluginKey);
  });
});

// 进程内 TTL 缓存 30-60s（键含 tenantId/pluginKey，多租户隔离）
const pluginEnabledCache = new Map<string, { enabled: boolean; expiresAt: number }>();
const leadSourceKeyCache = new Map<string, { data: { rateLimitPerMinute: number; scopes: string[]; allowedIpRanges: string | null }; expiresAt: number }>();
const PLUGIN_TTL_MS = 45_000;

export function invalidateLeadSourceKeyCache(tenantId: string, sourceKeyId: string): void {
  const prefix = `${tenantId}:${sourceKeyId}:`;
  for (const key of Array.from(leadSourceKeyCache.keys())) {
    if (key.startsWith(prefix)) leadSourceKeyCache.delete(key);
  }
}
export async function getPluginEnabledState(tenantId: string, pluginKey: string): Promise<boolean> {
  const cacheKey = `${tenantId}:${pluginKey}`;
  const cached = pluginEnabledCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.enabled;
  if (cached) pluginEnabledCache.delete(cacheKey);
  const result = await withTenant(tenantId, async (tx) => {
    const res = await tx.execute<{ enabled: boolean }>(sql`
      select enabled from plugin_registry
      where tenant_id = ${tenantId} and plugin_key = ${pluginKey}
      limit 1
    `);
    return res.rows[0]?.enabled ?? true;
  }).catch((err) => {
    console.error(`[PluginSecurity] Failed to query plugin state for ${pluginKey} (failing closed):`, err);
    return false;
  });
  pluginEnabledCache.set(cacheKey, { enabled: result, expiresAt: Date.now() + PLUGIN_TTL_MS });
  if (pluginEnabledCache.size > 1000) {
    const first = pluginEnabledCache.keys().next().value;
    if (first) pluginEnabledCache.delete(first);
  }
  return result;
}

export function createPluginServerContext(
  tx: TenantTransaction,
  tenant: TenantContext,
  context: PluginLeadContext,
): PluginServerContext {
  if (!pluginKeyPattern.test(context.pluginKey)) {
    throw new Error("Invalid plugin key");
  }
  const source = context.formId ? `form:${context.formId}` : `plugin:${context.pluginKey}`;
  return {
    tenant,
    core: {
      createLead: async (input) => {
        // 评分已内置于 createUnassignedPluginLeadInTransaction（先评分后路由，
        // 保证 minScore 门槛生效），此处无需再调
        return createUnassignedPluginLeadInTransaction(
          tx,
          tenant,
          input,
          source,
          { pluginKey: context.pluginKey, ...(context.formId ? { formId: context.formId } : {}), ...context.auditDetail },
        );
      },
    },
  };
}
export { dispatchWorkplaceNotificationService } from "@/core/workplace/service";
export { createSimulationTaskService } from "@/core/followup/service";

/**
 * 跨长周期异步操作（如 LLM Agent 推理）安全持有 Session 级 pg_advisory_lock
 * 执行完毕或异常退出时自动在独立数据库连接上完成解锁并归还连接池
 * 彻底消除在事务内部持有锁导致的连接池耗尽自锁
 */
export async function withSessionAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const { pool } = await import("@/db/client");
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtext($1))", [lockKey]);
    return await fn();
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    } catch {
      // ignore unlock error
    }
    lockClient.release();
  }
}

