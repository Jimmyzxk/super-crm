import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireSession } from "@/core/auth/session";
import { withTenant } from "@/core/tenant";
import AppSidebar from "./AppSidebar";

// 元数据查询 30-60s 进程内 TTL 缓存（键含 userId/tenantId，注意多租户隔离与失效简单化）
const layoutUserInfoCache = new Map<string, { data: { userName: string; userEmail: string; jobTitle: string; tenantName: string }; expiresAt: number }>();
const LAYOUT_TTL_MS = 45_000;
function getCachedLayoutUserInfo(key: string) {
  const entry = layoutUserInfoCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  if (entry) layoutUserInfoCache.delete(key);
  return null;
}
function setCachedLayoutUserInfo(key: string, data: { userName: string; userEmail: string; jobTitle: string; tenantName: string }) {
  layoutUserInfoCache.set(key, { data, expiresAt: Date.now() + LAYOUT_TTL_MS });
  if (layoutUserInfoCache.size > 500) {
    const first = layoutUserInfoCache.keys().next().value;
    if (first) layoutUserInfoCache.delete(first);
  }
}

import { getNotificationUnreadCountService } from "@/core/notification/service";
import { listEnabledPluginKeys } from "@/plugin-kit/server";
import { listEnabledPluginNavigation } from "@/plugin-kit/registry";
import { getSecurityComplianceConfigService } from "@/core/security/service";
import { SecurityConfigProvider } from "@/core/security/SecurityConfigProvider";
import SecurityWatermark from "@/core/security/SecurityWatermark";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession().catch(() => null);
  if (!session) {
    redirect("/login");
  }
  const [unreadCount, enabledPluginKeys, securityConfig, userInfo] = await Promise.all([
    getNotificationUnreadCountService(session),
    listEnabledPluginKeys(session).catch((error: unknown) => {
      console.error("plugin navigation lookup failed", error instanceof Error ? error.message : "unknown error");
      return [];
    }),
    getSecurityComplianceConfigService(session).catch((error: unknown) => {
      console.error("security config lookup failed", error instanceof Error ? error.message : "unknown error");
      return {
        id: "default",
        isAiCopilotEnabled: false,
        aiProvider: "BUILTIN" as const,
        aiApiKeyMasked: null,
        aiApiEndpoint: null,
        aiModelName: "deepseek-chat",
        aiTemperature: 0.3,
        isPhoneMaskingEnabled: false,
        isEmailMaskingEnabled: false,
        exportRequiresApproval: false,
        sessionTimeoutMinutes: 120,
        watermarkEnabled: true,
        updatedAt: new Date().toISOString(),
      };
    }),
    (async () => {
      const cacheKey = `${session.tenantId}:${session.userId}`;
      const cached = getCachedLayoutUserInfo(cacheKey);
      if (cached) return cached;
      try {
        const data = await withTenant(session.tenantId, async (tx) => {
          const res = await tx.execute<{ user_name: string; user_email: string; job_title: string | null; tenant_name: string }>(
            sql`select u.name as user_name, u.email as user_email, u.job_title as job_title, t.name as tenant_name
                from users u
                join tenants t on t.id = u.tenant_id
                where u.id = ${session.userId}::uuid and u.tenant_id = ${session.tenantId}::uuid
                limit 1`,
          );
          const row = res.rows[0];
          const defaultName = session.role === "ADMIN" ? "系统管理员" : session.role === "MANAGER" ? "销售主管" : "销售专员";
          return {
            userName: row?.user_name || defaultName,
            userEmail: row?.user_email || "",
            jobTitle: row?.job_title || "",
            tenantName: row?.tenant_name || "企业CRM",
          };
        });
        setCachedLayoutUserInfo(cacheKey, data);
        return data;
      } catch {
        return {
          userName: session.role === "ADMIN" ? "系统管理员" : session.role === "MANAGER" ? "销售主管" : "销售专员",
          userEmail: "",
          jobTitle: "",
          tenantName: "企业CRM",
        };
      }
    })(),
  ]);
  const pluginItems = listEnabledPluginNavigation(enabledPluginKeys, session.role);

  return (
    <SecurityConfigProvider config={securityConfig}>
      {/* 全局屏幕安全明水印 */}
      <SecurityWatermark
        tenantName={userInfo.tenantName}
        userName={userInfo.userName}
        userEmail={userInfo.userEmail}
      />

      <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900">
        {/* 左侧导航边栏 (240px Fixed Sidebar) */}
        <AppSidebar
          role={session.role}
          userName={userInfo.userName}
          userEmail={userInfo.userEmail}
          jobTitle={userInfo.jobTitle}
          unreadCount={unreadCount}
          pluginItems={pluginItems}
        />

        {/* 右侧主工作区独立滚动画布 */}
        <div className="flex flex-1 flex-col overflow-hidden min-w-0 bg-slate-50/70">
          <main className="flex-1 overflow-y-auto px-6 py-6 lg:px-8 focus:outline-none">
            <div className="w-full max-w-[1600px] mx-auto space-y-5">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SecurityConfigProvider>
  );
}



