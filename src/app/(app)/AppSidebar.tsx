"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/core/auth/types";
import { logout } from "@/core/auth/actions";
import type { PluginNavigationItem } from "@/plugin-kit/definition";

interface AppSidebarProps {
  role: Role;
  userEmail?: string;
  userName?: string;
  jobTitle?: string;
  unreadCount: number;
  pluginItems?: PluginNavigationItem[];
}

function NavIcon({ name }: { name: string }) {
  const common = "w-4 h-4 shrink-0 transition-colors";
  if (name === "/today") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (name === "/inbox") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    );
  }
  if (name === "/leads") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
      </svg>
    );
  }
  if (name === "/customers") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    );
  }
  if (name === "/contacts") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    );
  }
  if (name === "/quotas") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    );
  }
  if (name === "/opportunities") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    );
  }
  if (name === "/products") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    );
  }
  if (name === "/ai-hub") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
      </svg>
    );
  }
  if (name === "/analytics") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    );
  }
  if (name === "/playbooks") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    );
  }
  if (name === "/team") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    );
  }
  if (name === "/settings") {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  }
  if (name.includes("/form-capture")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (name.includes("/knowledge-base")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    );
  }
  if (name.includes("/lead-routing")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    );
  }
  if (name.includes("/contracts")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2zM15 2v5a1 1 0 001 1h5" />
      </svg>
    );
  }
  if (name.includes("/orders")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
      </svg>
    );
  }
  if (name.includes("/projects")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    );
  }
  if (name.includes("/bi-matrix")) {
    return (
      <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    );
  }
  return (
    <svg className={common} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
    </svg>
  );
}

export default function AppSidebar({
  role,
  userEmail,
  userName,
  jobTitle,
  unreadCount,
  pluginItems = [],
}: AppSidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const roleMeta: Record<Role, { title: string; subtitle: string; badge: string; badgeClass: string }> = {
    ADMIN: {
      title: "系统管理员",
      subtitle: "超级管理员中枢",
      badge: "超级管理员",
      badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    },
    MANAGER: {
      title: "销售主管",
      subtitle: "销售业务主管看板",
      badge: "销售主管",
      badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    },
    SALES: {
      title: "销售专员",
      subtitle: "销售专员工作空间",
      badge: "销售专员",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    },
  };
  const currentRoleMeta = roleMeta[role] || {
    title: "业务成员",
    subtitle: "企业协同工作空间",
    badge: "成员",
    badgeClass: "bg-slate-700 text-slate-300 border-slate-600",
  };

  const navItems = [
    {
      group: "日常工作",
      items: [
        {
          href: "/today",
          label: "今日工作台",
          badge: null,
        },
        {
          href: "/inbox",
          label: "消息中心",
          badge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : null,
          badgeColor: "bg-red-500 text-white",
        },
      ],
    },
    {
      group: "销售管线",
      items: [
        { href: "/leads", label: "线索管理", badge: null },
        { href: "/customers", label: "客户管理", badge: null },
        { href: "/contacts", label: "联系人脉", badge: null },
        { href: "/opportunities", label: "商机管理", badge: null },
        { href: "/products", label: "产品配置", badge: null },
      ],
    },
    {
      group: "智能与作战",
      items: [
        {
          href: "/quotas",
          label: "销售目标",
          badge: "对赌",
          badgeColor: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
        },
        {
          href: "/ai-hub",
          label: "AI 智能体中心",
          badge: "Agent",
          badgeColor: "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30",
        },
        { href: "/analytics", label: "经营分析", badge: null },
        { href: "/playbooks", label: "销售策略", badge: null },
      ],
    },
    ...(pluginItems.length > 0
      ? [
          {
            group: "扩展插件",
            items: pluginItems.map((p) => ({
              href: p.path,
              label: p.path.includes("bi-matrix") && role === "SALES" ? "业绩看板" : p.label,
              badge: "插件",
              badgeColor: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
            })),
          },
        ]
      : []),
    ...(role === "ADMIN" || role === "MANAGER"
      ? [
          {
            group: "系统治理",
            items: [
              { href: "/team", label: "团队管理", badge: null },
              ...(role === "ADMIN" ? [{ href: "/settings", label: "系统配置", badge: null }] : []),
            ],
          },
        ]
      : []),
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-slate-900 border-r border-slate-800/80 text-slate-100 select-none">
      {/* 1. 顶部品牌与搜索 */}
      <div className="shrink-0 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-xs font-black text-white shadow-md shrink-0">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="text-xs font-bold tracking-tight text-white truncate">Super CRM</h1>
              <span className="rounded bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-bold text-blue-300">
                内测版本
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {currentRoleMeta.subtitle}
            </p>
          </div>
        </div>

        {/* 全局快捷查找栏 */}
        <div className="px-3 pb-3">
          <Link
            href="/leads"
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-between px-2.5 py-1.5 bg-slate-800/70 hover:bg-slate-800 border border-slate-700/60 rounded-lg text-slate-400 hover:text-slate-200 transition-colors text-xs shadow-2xs group"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-[11.5px]">全局快捷检索</span>
            </div>
            <kbd className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-900/80 border border-slate-700 text-slate-400">
              ⌘K
            </kbd>
          </Link>
        </div>
      </div>

      {/* 2. 导航菜单流（可独立滚动） */}
      <nav className="flex-1 overflow-y-auto min-h-0 space-y-3 px-3 py-2" aria-label="侧边栏主导航">
        {navItems.map((group) => (
          <div key={group.group} className="space-y-0.5">
            <div className="flex items-center justify-between px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>{group.group}</span>
              <span className="text-[9px] text-slate-600 font-mono font-normal">{group.items.length}</span>
            </div>
            {group.items.map((item) => {
              const active = Boolean(
                pathname && (pathname === item.href || (item.href !== "/today" && pathname.startsWith(item.href))),
              );

              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  onClick={() => setMobileOpen(false)}
                  className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors ${
                    active
                      ? "bg-blue-600 text-white font-bold shadow-xs"
                      : "text-slate-300 hover:bg-slate-800/80 hover:text-white font-medium"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={active ? "text-white" : "text-slate-400 group-hover:text-slate-200"}>
                      <NavIcon name={item.href} />
                    </span>
                    <span className="truncate text-xs">{item.label}</span>
                  </div>

                  {item.badge ? (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold font-mono ${
                        item.badgeColor || "bg-slate-800 text-slate-300 border border-slate-700"
                      }`}
                    >
                      {item.badge}
                    </span>
                  ) : (
                    <span className={`text-[11px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity ${active ? "hidden" : ""}`}>
                      ›
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 3. 底部系统状态与个人中心 */}
      <div className="shrink-0 border-t border-slate-800/80 p-3 bg-slate-950/40 space-y-2">
        {/* 系统服务健康与版本微标签 */}
        <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            系统就绪
          </span>
          <span className="font-mono text-slate-400">v0.0.1</span>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-slate-800/80 p-2.5 border border-slate-700/60 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 font-bold text-white text-xs shadow-2xs shrink-0">
              {(userName || userEmail || "U").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-white truncate">{userName || currentRoleMeta.title}</p>
                <span className={`rounded px-1 py-0.2 text-[9px] font-bold border ${currentRoleMeta.badgeClass}`}>
                  {currentRoleMeta.badge}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono truncate">
                {userEmail || jobTitle || currentRoleMeta.title}
              </p>
            </div>
          </div>

          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-700 hover:text-white transition cursor-pointer"
              title="退出登录"
              aria-label="退出登录"
            >
              退出
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* 桌面端常驻左侧边栏 (768px+ 响应式常驻展示) */}
      <aside className="hidden md:flex w-60 lg:w-64 flex-col shrink-0 border-r border-slate-800/80 z-20">
        {sidebarContent}
      </aside>

      {/* 移动端汉堡浮动触发按钮 */}
      <div className="md:hidden fixed top-3 left-3 z-40">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm"
          aria-label="打开导航菜单"
        >
          菜单
        </button>
      </div>

      {/* 移动端全屏滑出抽屉 */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-64 max-w-[80vw] flex-1 z-10 shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 z-20 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-700"
              aria-label="关闭导航菜单"
            >
              关闭
            </button>
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
