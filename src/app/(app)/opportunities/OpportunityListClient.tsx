"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { OpportunityFilter, OpportunityList } from "@/core/opportunity/types";
import type { DealInterventionItem, InterventionWinRateAnalytics } from "@/core/collaboration/types";
import { formatAmountInCents, stageLabel, taskLabel } from "@/core/shared/display";
import { formatDateOnly } from "@/core/shared/date";
import OpportunityDrawer, { OpportunityDrawerPanel, OpportunityItem } from "./OpportunityDrawer";
import { Button, Badge, EmptyState } from "@/components/ui";

const FILTERS: Array<{ value: OpportunityFilter; label: string }> = [
  { value: "active", label: "推进中商机" },
  { value: "stalled", label: "推进停滞预警" },
  { value: "month", label: "本月预测成交" },
  { value: "won", label: "赢单归档" },
  { value: "lost", label: "输单归档" },
];

export default function OpportunityListClient({
  initial,
  filter: initialFilter,
  search: initialSearch,
  interventions = [],
  winRateAnalytics,
  isAiCopilotEnabled = false,
  canTransfer = false,
  assignableUsers = [],
}: {
  initial: OpportunityList;
  filter: OpportunityFilter;
  search: string;
  interventions?: DealInterventionItem[];
  winRateAnalytics?: InterventionWinRateAnalytics;
  isAiCopilotEnabled?: boolean;
  canTransfer?: boolean;
  assignableUsers?: Array<{ id: string; name: string; role?: string }>;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [drawerOpportunityId, setDrawerOpportunityId] = useState<string | null>(null);
  const [drawerPanel, setDrawerPanel] = useState<OpportunityDrawerPanel>("overview");
  const [menuAnchor, setMenuAnchor] = useState<{ opportunityId: string; top: number; right: number } | null>(null);
  const router = useRouter();

  const pendingInterventions = interventions.filter((i) => i.status === "REQUESTED");
  const resolvedInterventions = interventions.filter((i) => i.status === "RESOLVED");
  const interventionByOppId = new Map<string, DealInterventionItem>();
  for (const item of interventions) {
    if (!interventionByOppId.has(item.opportunityId) || item.status === "REQUESTED") {
      interventionByOppId.set(item.opportunityId, item);
    }
  }

  const activeOpportunity = initial.items.find((i) => i.id === drawerOpportunityId) || null;
  const activeIndex = activeOpportunity ? initial.items.findIndex((i) => i.id === activeOpportunity.id) : -1;

  function openDrawer(opp: OpportunityItem, panel: OpportunityDrawerPanel = "overview") {
    setDrawerOpportunityId(opp.id);
    setDrawerPanel(panel);
  }

  function closeDrawer() {
    setDrawerOpportunityId(null);
  }

  function navigateDrawer(nextIndex: number) {
    if (nextIndex >= 0 && nextIndex < initial.items.length) {
      setDrawerOpportunityId(initial.items[nextIndex].id);
      setDrawerPanel("overview");
    }
  }

  function navigate(filter: string, query = search) {
    const params = new URLSearchParams();
    params.set("filter", filter);
    if (query.trim()) params.set("search", query.trim());
    router.push(`/opportunities?${params}` as never);
  }

  return (
    <section className="space-y-6">
      {/* 头部区域 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              销售管线
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">商机管理</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {initial.items.length} 个商机
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            管理商机全流程流转、报价方案与团队协同
          </p>
        </div>

        <Link href="/leads">
          <Button
            variant="primary"
            size="md"
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            新建商机
          </Button>
        </Link>
      </header>

      {/* 战情室协同作战总览 (War Room Hub) */}
      <section className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 p-4 text-white shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 shadow-inner">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">团队协同作战室</h2>
                {pendingInterventions.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[10px] font-bold text-red-300 font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                    {pendingInterventions.length} 项待处理
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300">高层陪访、底价特批与技术方案协同支持</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs flex-wrap">
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5">
              <span className="text-slate-400 text-[11px]">待介入：</span>
              <span className="font-bold text-amber-400 font-mono ml-1">{pendingInterventions.length}</span>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5">
              <span className="text-slate-400 text-[11px]">已处理：</span>
              <span className="font-bold text-emerald-400 font-mono ml-1">{resolvedInterventions.length}</span>
            </div>
            {winRateAnalytics && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5">
                <span className="text-emerald-300 text-[11px]">协同赢单率：</span>
                <span className="font-bold text-emerald-400 font-mono ml-1">{winRateAnalytics.withInterventionWonRate}%</span>
                <span className="text-[10px] text-emerald-300/80 ml-1">({winRateAnalytics.withInterventionWonCount}/{winRateAnalytics.withInterventionTotalCount})</span>
              </div>
            )}
          </div>
        </div>

        {/* 紧急协同介入待办卡列 */}
        {pendingInterventions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5 pt-1 border-t border-white/10">
            {pendingInterventions.map((item) => {
              const opp = initial.items.find((o) => o.id === item.opportunityId);
              return (
                <div
                  key={item.id}
                  onClick={() => opp && openDrawer(opp, "intervention")}
                  className="group cursor-pointer rounded-lg bg-white/10 hover:bg-white/15 border border-amber-400/30 p-2.5 transition flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white truncate max-w-[140px]">{item.opportunityName}</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {item.interventionType === "EXECUTIVE_SPONSOR"
                          ? "高层陪访"
                          : item.interventionType === "DISCOUNT_APPROVAL"
                          ? "底价特批"
                          : item.interventionType === "SOLUTION_SUPPORT"
                          ? "方案答辩"
                          : "打法辅导"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 truncate max-w-[200px]">
                      {item.requesterName}：{item.requestNote}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-2 py-1 text-[11px] transition shadow-xs">
                    处理 →
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 筛选与搜索工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
        {/* 状态过滤 Tabs (Segmented Track) */}
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/70 shadow-2xs">
          {FILTERS.map((f) => {
            const isActive = initialFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => navigate(f.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-white text-slate-950 font-bold shadow-2xs border border-slate-200/80"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* 搜索与过滤 */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 min-w-[min(100%,20rem)] sm:max-w-md">
          {/* 现代化集成搜索栏 */}
          <div className="relative flex items-center min-w-[200px] flex-1 sm:max-w-xs">
            <svg
              className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              aria-label="搜索商机项目名称或客户公司"
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition shadow-2xs placeholder:text-slate-400"
              placeholder="搜索商机名称、客户公司..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  navigate(initialFilter);
                }
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  navigate(initialFilter, "");
                }}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 text-xs font-bold"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content: High-Density Table */}

      {/* Main Content: High-Density Table */}

      {initial.items.length === 0 ? (
        <EmptyState
          title="没有匹配的商机"
          description="可前往线索池确认需求后一键转客户立项，或从客户档案直接发起新商机。"
        />
      ) : (
        <div className="space-y-4">
          {/* Desktop High-Density Table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50/75 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5">
                      商机名称 / 关联客户
                    </th>
                    <th scope="col" className="w-28 px-3 py-2.5 font-mono">
                      预估金额
                    </th>
                    <th scope="col" className="w-32 px-3 py-2.5">
                      当前推进阶段
                    </th>
                    <th scope="col" className="w-32 px-3 py-2.5">
                      预计结单
                    </th>
                    <th scope="col" className="w-28 px-3 py-2.5">
                      主联系人
                    </th>
                    <th scope="col" className="w-24 px-3 py-2.5">
                      负责人
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      下一步待办
                    </th>
                    <th scope="col" className="w-32 px-3.5 py-2.5 text-right">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {initial.items.map((item) => {
                    const terminal = item.stage === "WON" || item.stage === "LOST";
                    const isCurrentOpen = drawerOpportunityId === item.id;

                    return (
                      <tr
                        key={item.id}
                        onClick={() => openDrawer(item, "overview")}
                        className={`cursor-pointer transition hover:bg-slate-50/60 ${
                          isCurrentOpen
                            ? "bg-slate-50/90 border-l-2 border-slate-900"
                            : ""
                        }`}
                      >
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-900 hover:text-blue-600 truncate max-w-[200px] transition-colors">
                              {item.name}
                            </span>
                            {item.isStalled && (
                              <Badge variant="rose" size="sm">
                                停滞
                              </Badge>
                            )}
                            {(() => {
                              const oppIntervention = interventionByOppId.get(item.id);
                              if (!oppIntervention) return null;
                              return (
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDrawer(item, "intervention");
                                  }}
                                  className="cursor-pointer"
                                  title="点击直达协同战情室"
                                >
                                  <Badge
                                    variant={oppIntervention.status === "REQUESTED" ? "amber" : "emerald"}
                                    size="sm"
                                    dot
                                  >
                                    {oppIntervention.status === "REQUESTED" ? "待主管介入" : "主管已批复"}
                                  </Badge>
                                </span>
                              );
                            })()}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500 truncate max-w-[200px]">
                            {item.customerName}
                          </div>
                        </td>

                        <td className="px-3 py-3 whitespace-nowrap font-mono font-semibold text-slate-950">
                          {formatAmountInCents(item.expectedAmount)}
                        </td>

                        <td className="px-3 py-3 whitespace-nowrap">
                          <Badge
                            variant={
                              item.stage === "WON"
                                ? "emerald"
                                : item.stage === "LOST"
                                ? "neutral"
                                : item.stage === "NEGOTIATION"
                                ? "purple"
                                : item.stage === "PROPOSAL"
                                ? "blue"
                                : "teal"
                            }
                            dot
                            size="sm"
                          >
                            {stageLabel(item.stage)}
                          </Badge>
                        </td>

                        <td className="px-3 py-3 whitespace-nowrap text-slate-600 font-mono text-[11px]">
                          {item.expectedCloseAt ? formatDateOnly(item.expectedCloseAt) : "-"}
                        </td>

                        <td className="px-3 py-3 whitespace-nowrap text-slate-700">
                          {item.primaryContactName || "-"}
                        </td>

                        <td className="px-3 py-3 whitespace-nowrap font-medium text-slate-800">
                          {item.ownerName}
                        </td>

                        <td className="px-3 py-3">
                          {item.openTaskType ? (
                            <div className="max-w-xs">
                              <span className="text-slate-700 font-medium">{taskLabel(item.openTaskType)}</span>
                              {item.openTaskDueAt && (
                                <span className={`ml-1 text-[10px] font-mono ${item.isStalled ? "text-rose-600 font-bold" : "text-slate-400"}`}>
                                  (● {formatDateOnly(item.openTaskDueAt)})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>

                        <td className="px-3.5 py-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {!terminal ? (
                              item.stage === "NEGOTIATION" ? (
                                <Button
                                  variant="primary"
                                  size="xs"
                                  onClick={() => openDrawer(item, "win")}
                                >
                                  赢单
                                </Button>
                              ) : (
                                <Button
                                  variant="primary"
                                  size="xs"
                                  onClick={() => openDrawer(item, "advance")}
                                >
                                  推进
                                </Button>
                              )
                            ) : item.stage === "WON" ? (
                              <Badge variant="emerald" size="md">
                                已赢单
                              </Badge>
                            ) : (
                              <Badge variant="neutral" size="md">
                                已丢单
                              </Badge>
                            )}

                            <Button
                              variant={menuAnchor?.opportunityId === item.id ? "primary" : "secondary"}
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (menuAnchor?.opportunityId === item.id) {
                                  setMenuAnchor(null);
                                } else {
                                  setMenuAnchor({
                                    opportunityId: item.id,
                                    top: rect.bottom + 4,
                                    right: window.innerWidth - rect.right,
                                  });
                                }
                              }}
                              title="展开该商机的全部操作"
                            >
                              ⋯ 操作
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Responsive Cards */}
          <div className="grid gap-3 md:hidden">
            {initial.items.map((item) => {
              const terminal = item.stage === "WON" || item.stage === "LOST";
              return (
                <article
                  key={item.id}
                  onClick={() => openDrawer(item, "overview")}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            item.stage === "WON"
                              ? "emerald"
                              : item.stage === "LOST"
                              ? "neutral"
                              : item.stage === "NEGOTIATION"
                              ? "purple"
                              : item.stage === "PROPOSAL"
                              ? "blue"
                              : "teal"
                          }
                          dot
                          size="sm"
                        >
                          {stageLabel(item.stage)}
                        </Badge>
                        {item.isStalled && (
                          <Badge variant="rose" size="sm">
                            停滞
                          </Badge>
                        )}
                        <span className="font-mono text-xs font-bold text-slate-950">
                          {formatAmountInCents(item.expectedAmount)}
                        </span>
                      </div>
                      <h2 className="mt-1.5 text-sm font-bold text-slate-900">{item.name}</h2>
                      <p className="text-xs text-slate-500 mt-0.5">{item.customerName}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 border-t border-slate-100 pt-2.5">
                    <div>
                      <span className="text-slate-400 text-[11px]">主联系人:</span>{" "}
                      <span className="font-medium text-slate-800">{item.primaryContactName || "-"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 text-[11px]">负责人:</span>{" "}
                      <span className="font-medium text-slate-800">{item.ownerName}</span>
                    </div>
                    {item.expectedCloseAt && (
                      <div className="col-span-2">
                        <span className="text-slate-400 text-[11px]">预计结单:</span>{" "}
                        <span className="font-mono text-slate-700">{formatDateOnly(item.expectedCloseAt)}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                    {!terminal ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => openDrawer(item, item.stage === "NEGOTIATION" ? "win" : "advance")}
                      >
                        {item.stage === "NEGOTIATION" ? "确认赢单" : "推进阶段"}
                      </Button>
                    ) : (
                      <Badge
                        variant={item.stage === "WON" ? "emerald" : "neutral"}
                        size="md"
                        className="flex-1 justify-center"
                      >
                        {item.stage === "WON" ? "已赢单" : "已丢单"}
                      </Badge>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => openDrawer(item, "overview")}
                    >
                      全景档案
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Cursor Pagination */}
          {initial.nextCursor && (
            <div className="pt-2 text-center">
              <Link
                href={`/opportunities?${new URLSearchParams({
                  filter: initialFilter,
                  ...(initialSearch ? { search: initialSearch } : {}),
                  cursor: initial.nextCursor,
                })}`}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
              >
                加载更多商机 ↓
              </Link>
            </div>
          )}
        </div>
      )}

      {/* In-Place Slide-over Hub */}
      <OpportunityDrawer
        opportunity={activeOpportunity}
        opportunitiesList={initial.items}
        currentIndex={activeIndex}
        initialPanel={drawerPanel}
        onClose={closeDrawer}
        onNavigate={navigateDrawer}
        onRefresh={() => {
          closeDrawer();
          router.refresh();
        }}
        isAiCopilotEnabled={isAiCopilotEnabled}
        canTransfer={canTransfer}
        assignableUsers={assignableUsers}
      />

      {/* 独立 Portal 悬浮操作菜单 */}
      {menuAnchor && typeof document !== "undefined" && (() => {
        const targetMenuOpp = initial.items.find((i) => i.id === menuAnchor.opportunityId);
        if (!targetMenuOpp) return null;
        const terminal = targetMenuOpp.stage === "WON" || targetMenuOpp.stage === "LOST";

        return createPortal(
          <>
            <div
              className="fixed inset-0 z-50 bg-transparent"
              onClick={() => setMenuAnchor(null)}
              aria-hidden="true"
            />
            <div
              style={{
                position: "fixed",
                top: `${menuAnchor.top}px`,
                right: `${menuAnchor.right}px`,
              }}
              className="z-50 min-w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl text-left text-xs space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 border-b border-slate-100 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>商机操作</span>
                <span className="font-normal text-slate-600 truncate max-w-[90px]">{targetMenuOpp.name}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuOpp, "overview");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 font-medium rounded"
              >
                查看全量档案
              </button>

              {!terminal ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "intervention");
                    }}
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-amber-800 hover:bg-amber-50 font-medium rounded"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>协同战情室</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "advance");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 font-medium rounded"
                  >
                    推进下一阶段
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "activity");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                  >
                    记录跟进纪要
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "win");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50 font-medium rounded"
                  >
                    确认赢单结案
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "revert");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                  >
                    回退上一阶段
                  </button>

                  {targetMenuOpp.openTaskId && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuOpp, "reschedule");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                    >
                      改约待办时间
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "edit");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                  >
                    修改商机资料
                  </button>

                  {canTransfer && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuOpp, "transfer");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-indigo-700 hover:bg-indigo-50 font-medium rounded"
                    >
                      转移商机归属
                    </button>
                  )}

                  <div className="border-t border-slate-100 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuOpp, "lost");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-red-600 hover:bg-red-50 font-medium rounded"
                  >
                    记录商机丢单
                  </button>
                </>
              ) : (
                <div className="px-2.5 py-1 text-[11px] text-slate-400 italic">
                  {targetMenuOpp.stage === "WON" ? "已赢单结案" : "已丢单归档"}
                </div>
              )}
            </div>
          </>,
          document.body
        );
      })()}
    </section>
  );
}
