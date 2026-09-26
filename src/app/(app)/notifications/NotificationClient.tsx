"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllNotificationsRead, markNotificationRead } from "@/core/notification/actions";
import type { NotificationPage } from "@/core/notification/types";
import { Button, Badge, EmptyState } from "@/components/ui";

const typeConfig: Record<
  string,
  { label: string; badgeVariant: "rose" | "amber" | "blue" | "neutral"; iconBg: string; icon: string }
> = {
  TASK_OVERDUE: {
    label: "SLA 响应超期",
    badgeVariant: "rose",
    iconBg: "bg-rose-50 text-rose-600 border border-rose-200",
    icon: "exclamation",
  },
  TASK_DUE_SOON: {
    label: "SLA 即将到期",
    badgeVariant: "amber",
    iconBg: "bg-amber-50 text-amber-600 border border-amber-200",
    icon: "clock",
  },
  LEAD_ASSIGNED: {
    label: "新线索分配",
    badgeVariant: "blue",
    iconBg: "bg-blue-50 text-blue-600 border border-blue-200",
    icon: "user-plus",
  },
  CONTRACT_EXPIRING_SOON: {
    label: "合同即将到期",
    badgeVariant: "amber",
    iconBg: "bg-amber-50 text-amber-600 border border-amber-200",
    icon: "document-clock",
  },
  SCHEDULE_PAYMENT_OVERDUE: {
    label: "回款计划逾期",
    badgeVariant: "rose",
    iconBg: "bg-rose-50 text-rose-600 border border-rose-200",
    icon: "currency-exclamation",
  },
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationIcon({ icon, className = "w-4 h-4" }: { icon: string; className?: string }) {
  if (icon === "exclamation" || icon === "currency-exclamation") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    );
  }
  if (icon === "clock" || icon === "document-clock") {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

export default function NotificationClient({ initial }: { initial: NotificationPage }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"ALL" | "UNREAD" | "SLA" | "LEAD">("ALL");

  const filteredItems = useMemo(() => {
    return initial.items.filter((item) => {
      if (filter === "UNREAD") return !item.readAt;
      if (filter === "SLA") return item.type === "TASK_OVERDUE" || item.type === "TASK_DUE_SOON";
      if (filter === "LEAD") return item.type === "LEAD_ASSIGNED";
      return true;
    });
  }, [initial.items, filter]);

  const unreadCount = initial.unreadCount;

  const slaCount = useMemo(() => {
    return initial.items.filter(
      (item) => !item.readAt && (item.type === "TASK_OVERDUE" || item.type === "TASK_DUE_SOON")
    ).length;
  }, [initial.items]);

  const leadAssignedCount = useMemo(() => {
    return initial.items.filter((item) => !item.readAt && item.type === "LEAD_ASSIGNED").length;
  }, [initial.items]);

  function readAndOpen(id: string, link: string | null) {
    startTransition(async () => {
      await markNotificationRead({ notificationId: id });
      if (link) router.push(link as Parameters<typeof router.push>[0]);
      else router.refresh();
    });
  }

  function readAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* 1. 顶部标准 Header (与全系统设计规范统一) */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-950 tracking-tight">
              消息与通知中心
            </h1>
            {unreadCount > 0 ? (
              <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs px-2.5 py-0.5 font-bold">
                {unreadCount} 条待处理
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 text-slate-500 border border-slate-200 text-xs px-2.5 py-0.5 font-medium">
                全部已读
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            全生命周期聚合首响应 SLA 超期预警、线索分配与协同流转动态，保障关键业务不漏跟
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || unreadCount === 0}
            onClick={readAll}
          >
            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{pending ? "处理中..." : "全部标记已读"}</span>
          </Button>
        </div>
      </div>

      {/* 2. 统计指标卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">累计通知总量</div>
            <div className="text-xl font-bold text-slate-900 mt-1 font-mono">
              {initial.totalCount ?? initial.items.length} <span className="text-xs font-normal text-slate-400">条</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shadow-2xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">待处理未读消息</div>
            <div className="text-xl font-bold text-blue-600 mt-1 font-mono">
              {unreadCount} <span className="text-xs font-normal text-slate-400">条未读</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-2xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0017.25 4.5h-10.5a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">SLA 预警待办</div>
            <div className="text-xl font-bold text-rose-600 mt-1 font-mono">
              {slaCount} <span className="text-xs font-normal text-slate-400">条待办</span>
            </div>
          </div>
          <div className="h-9 w-9 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shadow-2xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
        </div>
      </div>

      {/* 3. 分类选项卡与通知列表 */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Tab 过滤栏 */}
        <div className="flex flex-wrap items-center justify-between p-3 border-b border-slate-100 bg-slate-50/50 gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                filter === "ALL"
                  ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              全部消息
            </button>
            <button
              onClick={() => setFilter("UNREAD")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "UNREAD"
                  ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>未读</span>
              {unreadCount > 0 && (
                <Badge variant="rose" size="sm">
                  {unreadCount}
                </Badge>
              )}
            </button>
            <button
              onClick={() => setFilter("SLA")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "SLA"
                  ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>SLA 响应预警</span>
              {slaCount > 0 && (
                <Badge variant="amber" size="sm">
                  {slaCount}
                </Badge>
              )}
            </button>
            <button
              onClick={() => setFilter("LEAD")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                filter === "LEAD"
                  ? "bg-white text-slate-900 font-semibold shadow-2xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>线索指派</span>
              {leadAssignedCount > 0 && (
                <Badge variant="blue" size="sm">
                  {leadAssignedCount}
                </Badge>
              )}
            </button>
          </div>

          <span className="text-[11px] text-slate-400 font-medium hidden sm:inline">
            点击消息可直接穿透跳转至对应业务详情页
          </span>
        </div>

        {/* 消息列表主体 */}
        <div className="divide-y divide-slate-100">
          {filteredItems.length === 0 ? (
            <EmptyState
              title="当前分类下暂无通知消息"
              description="当系统产生首响应预警或指派新线索时，将第一时间在此提醒您"
            />
          ) : (
            filteredItems.map((item) => {
              const isUnread = !item.readAt;
              const config = typeConfig[item.type] || {
                label: "系统提醒",
                badgeVariant: "neutral" as const,
                iconBg: "bg-slate-100 text-slate-600 border border-slate-200",
                icon: "clock",
              };

              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 transition-colors ${
                    isUnread ? "bg-slate-50/50 hover:bg-slate-50" : "bg-white hover:bg-slate-50/80"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center shadow-2xs ${config.iconBg}`}>
                      <NotificationIcon icon={config.icon} className="w-4 h-4" />
                    </div>

                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" title="未读" />
                        )}
                        <Badge variant={config.badgeVariant} size="sm">
                          {config.label}
                        </Badge>
                        <h3 className={`text-xs break-words ${isUnread ? "font-bold text-slate-950" : "font-medium text-slate-800"}`}>
                          {item.title}
                        </h3>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>

                      {item.body && (
                        <p className="text-xs text-slate-600 leading-relaxed break-words">
                          {item.body}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {item.link && (
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => readAndOpen(item.id, item.link)}
                        disabled={pending}
                      >
                        立即跟进
                      </Button>
                    )}

                    {isUnread && !item.link && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => readAndOpen(item.id, null)}
                        disabled={pending}
                      >
                        标为已读
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {initial.nextLimit && (
          <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-center">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  router.push(`/inbox?limit=${initial.nextLimit}`);
                });
              }}
            >
              {pending ? "加载中..." : `加载更多通知 (已展示 ${initial.items.length} 条 / 共 ${initial.totalCount ?? initial.items.length} 条)`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
