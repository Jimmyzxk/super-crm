"use client";

import { ChangeEvent, useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { formatBoundedCount } from "@/core/shared/display";
import { listProductsAction } from "@/core/products/actions";

import {
  assignLeadsBulkAction,
  createLeadAction,
  importLeadsCommitAction,
  importLeadsPreviewAction,
  listLeadsAction,
} from "./actions";
import LeadDrawer, { type DrawerPanel } from "./LeadDrawer";
import MaskedPhone from "@/core/security/MaskedPhone";
import {
  Button,
  Badge,
  EmptyState,
} from "@/components/ui";
import type {
  ActionResult,
  AssignableUser,
  CreateLeadResult,
  ImportPreview,
  Lead,
  LeadFilter,
  LeadPage,
  LeadRole,
  LeadSort,
} from "./types";
import { formatDate, formatDue, sourceLabel, statusLabel } from "./types";

import { type ProductItem, formatPricingModel } from "@/core/products/types";

type Props = {
  role: LeadRole;
  initialPage: LeadPage;
  initialAssignableUsers: AssignableUser[];
  initialSearch?: string;
  initialFilter?: LeadFilter;
  initialSort?: LeadSort;
  isAiCopilotEnabled?: boolean;
};

type LeadForm = {
  contactName: string;
  contactPhone: string;
  companyName: string;
  contactEmail: string;
  title: string;
  intendedProductId: string;
  intendedProduct: string;
  budget: string;
  channel: string;
  note: string;
};

const emptyLead: LeadForm = {
  contactName: "",
  contactPhone: "",
  companyName: "",
  contactEmail: "",
  title: "",
  intendedProductId: "",
  intendedProduct: "",
  budget: "",
  channel: "direct",
  note: "",
};

function buttonClass(kind: "primary" | "secondary" | "danger" | "text" = "secondary") {
  const common =
    "inline-flex min-h-9 items-center justify-center rounded-lg px-3.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  if (kind === "primary") return `${common} bg-slate-900 text-white hover:bg-slate-800 shadow-sm`;
  if (kind === "danger") return `${common} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`;
  if (kind === "text") return `${common} px-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100`;
  return `${common} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm`;
}

function inputClass(error?: string) {
  return `min-h-10 w-full rounded-lg border ${
    error ? "border-red-400 bg-red-50/30" : "border-slate-300 bg-white"
  } px-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10`;
}

function scoreBadge(score?: number | null) {
  if (score == null) {
    return <span className="inline-flex items-center text-xs text-slate-400 font-mono">-</span>;
  }
  const variant = score >= 70 ? "emerald" : score >= 40 ? "amber" : "neutral";
  return (
    <Badge variant={variant} dot size="md" className="font-mono font-semibold">
      {score} 分
    </Badge>
  );
}

function statusBadge(status: Lead["status"]) {
  const variantMap: Record<Lead["status"], "blue" | "purple" | "emerald" | "teal" | "neutral"> = {
    NEW: "blue",
    CONTACTED: "purple",
    QUALIFIED: "emerald",
    CONVERTED: "teal",
    DISCARDED: "neutral",
  };
  return (
    <Badge variant={variantMap[status] ?? "neutral"} dot size="md">
      {statusLabel(status)}
    </Badge>
  );
}

function validateLead(form: LeadForm) {
  const errors: Partial<Record<keyof LeadForm, string>> = {};
  if (!form.contactName.trim() || form.contactName.trim().length > 50) errors.contactName = "请填写联系人姓名";
  if (!/^1[3-9]\d{9}$/.test(form.contactPhone.trim())) errors.contactPhone = "请填写正确的手机号";
  if (form.companyName.length > 100) errors.companyName = "公司名称不超过 100 字";
  if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) errors.contactEmail = "邮箱格式不正确";
  if (form.title.length > 50) errors.title = "职位不超过 50 字";
  if (form.intendedProduct.length > 100) errors.intendedProduct = "意向产品不超过 100 字";
  if (form.budget.length > 50) errors.budget = "预估预算不超过 50 字";
  if (form.note.length > 500) errors.note = "需求说明不超过 500 字";
  return errors;
}

export default function LeadsClient({
  role,
  initialPage,
  initialAssignableUsers,
  initialSearch = "",
  initialFilter = "all",
  initialSort = "priority",
  isAiCopilotEnabled = false,
}: Props) {
  const [page, setPage] = useState(initialPage);
  const [filter, setFilter] = useState<LeadFilter>(initialFilter);
  const [sort, setSort] = useState<LeadSort>(initialSort);
  const [search, setSearch] = useState(initialSearch);
  const [selected, setSelected] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [loading, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [includeConverted, setIncludeConverted] = useState(false);
  const [includeDiscarded, setIncludeDiscarded] = useState(false);
  const [showViewOptions, setShowViewOptions] = useState(false);

  // Active drawer state
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  const [drawerPanel, setDrawerPanel] = useState<DrawerPanel | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ leadId: string; top: number; right: number } | null>(null);


  const isManager = role === "MANAGER" || role === "ADMIN";
  const uniqueLeads = useMemo(() => {
    const seen = new Set<string>();
    return page.items.filter((lead) => !seen.has(lead.id) && seen.add(lead.id));
  }, [page.items]);

  const allSelected = uniqueLeads.length > 0 && uniqueLeads.every((l) => selected.includes(l.id));

  const drawerLead = useMemo(() => {
    return uniqueLeads.find((l) => l.id === drawerLeadId) ?? null;
  }, [uniqueLeads, drawerLeadId]);

  const currentIndex = useMemo(() => {
    return uniqueLeads.findIndex((l) => l.id === drawerLeadId);
  }, [uniqueLeads, drawerLeadId]);

  function syncUrl(nextFilter: LeadFilter, nextSort: LeadSort, nextSearch: string) {
    const params = new URLSearchParams();
    if (nextFilter !== "all") params.set("filter", nextFilter);
    if (nextSort !== "priority") params.set("sort", nextSort);
    if (nextSearch.trim()) params.set("search", nextSearch.trim());
    const href = `/leads${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", href as never);
  }

  function reload(
    nextFilter = filter,
    nextSort = sort,
    nextSearch = search,
    incConverted = includeConverted,
    incDiscarded = includeDiscarded,
  ) {
    syncUrl(nextFilter, nextSort, nextSearch);
    startTransition(async () => {
      try {
        const response = await listLeadsAction({
          filter: nextFilter,
          sort: nextSort,
          search: nextSearch,
          includeConverted: incConverted,
          includeDiscarded: incDiscarded,
        });
        if (!response.ok) throw new Error(response.message);
        setPage(response.data);
        setSelected([]);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "线索加载失败");
      }
    });
  }

  function changeView(nextFilter: LeadFilter) {
    setFilter(nextFilter);
    reload(nextFilter, sort, search);
  }

  function loadMore() {
    if (!page.nextCursor) return;
    startTransition(async () => {
      try {
        const response = await listLeadsAction({ filter, sort, search, cursor: page.nextCursor ?? undefined });
        if (!response.ok) throw new Error(response.message);
        setPage((current) => ({ ...response.data, items: [...current.items, ...response.data.items] }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "加载更多失败");
      }
    });
  }

  async function runAction<T>(action: Promise<ActionResult<T>>, success?: () => void) {
    setError(null);
    try {
      const result = await action;
      if (!result.ok) {
        setError(result.message || "操作失败，请重试");
        return result;
      }
      success?.();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      return null;
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected([]);
    } else {
      setSelected(uniqueLeads.map((l) => l.id));
    }
  }

  function openDrawer(lead: Lead, panel: DrawerPanel = "overview") {
    setDrawerLeadId(lead.id);
    setDrawerPanel(panel);
  }

  function closeDrawer() {
    setDrawerLeadId(null);
    setDrawerPanel(null);
  }

  function handleNavigate(newIndex: number) {
    if (newIndex >= 0 && newIndex < uniqueLeads.length) {
      setDrawerLeadId(uniqueLeads[newIndex].id);
    }
  }

  const counts = page.counts ?? {};
  const countCeiling = page.countCeiling;

  return (
    <section className="space-y-6">
      {/* 头部区域 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              销售管线
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">线索管理</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {counts.all !== undefined ? formatBoundedCount(counts.all, countCeiling ?? 1000) : uniqueLeads.length} 条
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            全渠道线索统一接入与清洗，依据评分规则与响应时效推进商机转化
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isManager && (
            <Button variant="secondary" size="md" onClick={() => setShowImport(true)}>
              导入 CSV 线索
            </Button>
          )}
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowCreate(true)}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            新建线索
          </Button>
        </div>
      </header>

      {/* 筛选与搜索工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
        {/* 状态过滤 Tabs (Segmented Control Track) */}
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/70 shadow-2xs">
          <FilterTab label="全部线索" count={counts.all} countCeiling={countCeiling} active={filter === "all"} onClick={() => changeView("all")} always />
          <FilterTab label={isManager ? "公海线索 (待分配)" : "公海线索 (待打捞)"} count={counts.unassigned} countCeiling={countCeiling} active={filter === "unassigned"} onClick={() => changeView("unassigned")} badgeColor="blue" always />
          <FilterTab label="超期未跟进" count={counts.overdue} countCeiling={countCeiling} active={filter === "overdue"} onClick={() => changeView("overdue")} badgeColor="red" />
          <FilterTab label="高价值线索" count={counts["high-score"]} countCeiling={countCeiling} active={filter === "high-score"} onClick={() => changeView("high-score")} badgeColor="emerald" />
          <FilterTab label="疑似重复" count={counts.duplicate} countCeiling={countCeiling} active={filter === "duplicate"} onClick={() => changeView("duplicate")} badgeColor="amber" />
          <FilterTab label="已放弃线索" count={counts.discarded} countCeiling={countCeiling} active={filter === "discarded"} onClick={() => changeView("discarded")} badgeColor="slate" />
          <FilterTab label="已转化客户" count={counts.converted} countCeiling={countCeiling} active={filter === "converted"} onClick={() => changeView("converted")} badgeColor="emerald" />
        </div>

        {/* 搜索、排序与高级视图选项 */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 min-w-[min(100%,20rem)] sm:max-w-xl">
          {/* 现代化集成搜索栏 (防折行、内置搜索图标与一键清空) */}
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
              aria-label="搜索姓名、手机号或企业"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  reload(filter, sort, search);
                }
              }}
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition shadow-2xs placeholder:text-slate-400"
              placeholder="搜索联系人、手机号、企业全称..."
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  reload(filter, sort, "");
                }}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 text-xs font-bold"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>

          <select
            value={sort}
            onChange={(event) => {
              const next = event.target.value as LeadSort;
              setSort(next);
              reload(filter, next, search);
            }}
            className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none"
          >
            <option value="priority">排序：优先级优先</option>
            <option value="created">排序：最新创建</option>
            <option value="score">排序：评分最高</option>
          </select>

          {/* 视图选项 Popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowViewOptions(!showViewOptions)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition shadow-2xs ${
                includeConverted || includeDiscarded
                  ? "border-blue-300 bg-blue-50/80 text-blue-900 font-semibold"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="配置当前列表显示范围与偏好"
            >
              <span>视图范围</span>
              {(includeConverted || includeDiscarded) && (
                <span className="rounded-full bg-blue-600 px-1.5 py-0.2 text-[10px] font-bold text-white font-mono leading-tight">
                  {(includeConverted ? 1 : 0) + (includeDiscarded ? 1 : 0)}
                </span>
              )}
              <span className="text-[10px] opacity-60">▾</span>
            </button>

            {showViewOptions && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setShowViewOptions(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-xl space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-bold text-slate-900">列表显示范围配置</span>
                    {(includeConverted || includeDiscarded) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIncludeConverted(false);
                          setIncludeDiscarded(false);
                          setShowViewOptions(false);
                          reload(filter, sort, search, false, false);
                        }}
                        className="text-[11px] text-blue-600 hover:underline"
                      >
                        恢复默认
                      </button>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeConverted}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIncludeConverted(val);
                          reload(filter, sort, search, val, includeDiscarded);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">并入已转商机线索</div>
                        <div className="text-[11px] text-slate-400">显示已成功转为企业客户与商机档案的历史线索</div>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={includeDiscarded}
                        onChange={(e) => {
                          const val = e.target.checked;
                          setIncludeDiscarded(val);
                          reload(filter, sort, search, includeConverted, val);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800">并入已放弃流失线索</div>
                        <div className="text-[11px] text-slate-400">显示标记放弃退回公海的流失线索</div>
                      </div>
                    </label>
                  </div>

                  <div className="rounded bg-slate-50 p-2 text-[11px] text-slate-500">
                    默认仅聚焦进行中有效线索，保持管道敏捷高效。
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>


      {/* 错误提示 */}
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          <span>{error}</span>
          <button className={buttonClass("danger")} onClick={() => reload()}>
            重试
          </button>
        </div>
      )}

      {/* 主数据展示区 */}
      {loading ? (
        <LeadTableSkeleton />
      ) : uniqueLeads.length === 0 ? (
        <LeadEmptyState
          hasSearch={Boolean(search)}
          hasFilter={filter !== "all"}
          canImport={isManager}
          onCreate={() => setShowCreate(true)}
          onImport={() => setShowImport(true)}
          onClear={() => {
            setSearch("");
            changeView("all");
          }}
        />
      ) : (
        <>
          {/* 桌面端高密度表格 (Hidden on mobile) */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50/75 font-semibold text-slate-500 uppercase tracking-wider text-[11px]">
                  <tr>
                    {isManager && (
                      <th scope="col" className="w-10 px-3.5 py-2.5">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          aria-label="全选当前页线索"
                          className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                        />
                      </th>
                    )}
                    <th scope="col" className="w-24 px-3 py-2.5">
                      评分
                    </th>
                    <th scope="col" className="px-3.5 py-2.5">
                      联系人 / 公司
                    </th>
                    <th scope="col" className="w-32 px-3 py-2.5">
                      手机号
                    </th>
                    <th scope="col" className="w-36 px-3 py-2.5">
                      状态 / 时效
                    </th>
                    <th scope="col" className="w-24 px-3 py-2.5">
                      来源
                    </th>
                    <th scope="col" className="w-24 px-3 py-2.5">
                      负责人
                    </th>
                    <th scope="col" className="px-3 py-2.5">
                      最近跟进
                    </th>
                    <th scope="col" className="w-32 px-3.5 py-2.5 text-right">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {uniqueLeads.map((lead) => {
                    const due = lead.openTask ? formatDue(lead.openTask.dueAt) : null;
                    const isSelected = selected.includes(lead.id);
                    const isCurrentOpen = drawerLeadId === lead.id;
                    const canConvert = lead.status === "QUALIFIED" && Boolean(lead.ownerUserId);

                    return (
                      <tr
                        key={lead.id}
                        onClick={() => openDrawer(lead, "overview")}
                        className={`cursor-pointer transition hover:bg-slate-50/60 ${
                          isCurrentOpen ? "bg-slate-50/90 border-l-2 border-slate-900" : isSelected ? "bg-slate-50/50" : ""
                        }`}
                      >
                        {isManager && (
                          <td className="px-3.5 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelected(lead.id)}
                              aria-label={`选择 ${lead.contactName}`}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                            />
                          </td>
                        )}
                        <td className="px-3 py-3 whitespace-nowrap">
                          {scoreBadge(lead.score)}
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-900 hover:text-blue-600 truncate max-w-[150px] transition-colors">
                                  {lead.contactName}
                                </span>
                                {lead.isPossibleDuplicate && (
                                  <Badge variant="amber" size="sm">
                                    重复
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate max-w-[180px] mt-0.5">
                                {lead.companyName ? lead.companyName : lead.title ? lead.title : "-"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <MaskedPhone
                            phone={lead.contactPhone}
                            entityType="LEAD"
                      reason="线索列表筛选后电话联络"
                            entityId={lead.id}
                            showCopy={true}
                            className="font-mono text-[11px]"
                          />
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <div>{statusBadge(lead.status)}</div>
                            {due && (
                              <span
                                className={`text-[10px] font-medium ${
                                  due.overdue ? "text-rose-600 font-bold" : "text-amber-600"
                                }`}
                              >
                                ● {due.label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-slate-500">
                          {sourceLabel(lead.source)}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {lead.ownerName ? (
                            <span className="text-slate-800 font-medium">{lead.ownerName}</span>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              未分配
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {lead.lastActivity ? (
                            <div className="max-w-xs">
                              <p className="truncate text-slate-700">{lead.lastActivity.summary}</p>
                              <span className="text-[10px] text-slate-400 font-mono">{formatDate(lead.lastActivity.occurredAt)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3.5 py-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            {!lead.ownerUserId ? (
                              <Button
                                variant="primary"
                                size="xs"
                                onClick={() => openDrawer(lead, "assign")}
                              >
                                {isManager ? "指派责任人" : "从公海认领"}
                              </Button>
                            ) : lead.status === "CONVERTED" ? (
                              <Badge variant="teal" size="md">
                                已转为商机
                              </Badge>
                            ) : lead.status === "DISCARDED" ? (
                              <Badge variant="neutral" size="md">
                                已放弃
                              </Badge>
                            ) : canConvert ? (
                              <Button
                                variant="primary"
                                size="xs"
                                onClick={() => openDrawer(lead, "convert")}
                              >
                                转客户立项
                              </Button>
                            ) : lead.status === "CONTACTED" ? (
                              <Button
                                variant="primary"
                                size="xs"
                                onClick={() => openDrawer(lead, "qualify")}
                              >
                                确认需求
                              </Button>
                            ) : (
                              <Button
                                variant="primary"
                                size="xs"
                                onClick={() => openDrawer(lead, "activity")}
                              >
                                记录跟进
                              </Button>
                            )}

                            <Button
                              variant={menuAnchor?.leadId === lead.id ? "primary" : "secondary"}
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (menuAnchor?.leadId === lead.id) {
                                  setMenuAnchor(null);
                                } else {
                                  setMenuAnchor({
                                    leadId: lead.id,
                                    top: rect.bottom + 4,
                                    right: window.innerWidth - rect.right,
                                  });
                                }
                              }}
                              title="展开该线索的所有操作（跟进、改约、指派、转客户、放弃等）"
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

          {/* 移动端轻量卡片流 (Visible on mobile only) */}
          <div className="md:hidden space-y-3">
            {uniqueLeads.map((lead) => {
              const due = lead.openTask ? formatDue(lead.openTask.dueAt) : null;
              const canConvert = lead.status === "QUALIFIED" && Boolean(lead.ownerUserId);

              return (
                <article
                  key={lead.id}
                  onClick={() => openDrawer(lead, "overview")}
                  className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {scoreBadge(lead.score)}
                        {statusBadge(lead.status)}
                        {lead.isPossibleDuplicate && (
                          <Badge variant="amber" size="sm">
                            重复
                          </Badge>
                        )}
                      </div>
                      <h2 className="mt-2 text-sm font-bold text-slate-900">
                        {lead.contactName}
                        {lead.companyName && (
                          <span className="ml-1.5 text-xs font-normal text-slate-500">
                            · {lead.companyName}
                          </span>
                        )}
                      </h2>
                    </div>
                    {isManager && (
                      <input
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleSelected(lead.id);
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer mt-0.5"
                      />
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 border-t border-slate-100 pt-2.5">
                    <div onClick={(e) => e.stopPropagation()}>
                      <span className="text-slate-400 text-[11px]">电话:</span>{" "}
                      <MaskedPhone
                        phone={lead.contactPhone}
                        entityType="LEAD"
                      reason="线索列表筛选后电话联络"
                        entityId={lead.id}
                        showCopy={true}
                        className="font-mono text-[11px]"
                      />
                    </div>
                    <div>
                      <span className="text-slate-400 text-[11px]">负责人:</span>{" "}
                      <span className="font-medium text-slate-800">{lead.ownerName || "未分配"}</span>
                    </div>
                    {due && (
                      <div className="col-span-2">
                        <span className="text-slate-400 text-[11px]">待办时效:</span>{" "}
                        <span className={due.overdue ? "font-bold text-rose-600" : "text-amber-600"}>
                          ● {due.label}
                        </span>
                      </div>
                    )}
                  </div>

                  {lead.lastActivity && (
                    <p className="mt-2 text-xs text-slate-500 line-clamp-1 bg-slate-50 p-2 rounded-lg">
                      最近跟进：{lead.lastActivity.summary}
                    </p>
                  )}

                  <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                    {lead.status === "CONVERTED" ? (
                      <Badge variant="teal" size="md" className="flex-1 justify-center">
                        已转为商机
                      </Badge>
                    ) : lead.status === "DISCARDED" ? (
                      <Badge variant="neutral" size="md" className="flex-1 justify-center">
                        已放弃
                      </Badge>
                    ) : canConvert ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => openDrawer(lead, "convert")}
                      >
                        转客户立项
                      </Button>
                    ) : lead.status === "CONTACTED" ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => openDrawer(lead, "qualify")}
                      >
                        确认需求
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => openDrawer(lead, "activity")}
                      >
                        记录跟进
                      </Button>
                    )}

                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      onClick={() => openDrawer(lead, "overview")}
                    >
                      查看档案
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* 加载更多 */}
          {page.nextCursor && (
            <div className="pt-2 text-center">
              <button className={buttonClass()} disabled={loading} onClick={loadMore}>
                {loading ? "加载中..." : "加载更多线索"}
              </button>
            </div>
          )}
        </>
      )}

      {/* 主管批量指派底部悬浮条 */}
      {isManager && selected.length > 0 && (
        <BulkActionBar
          selectedCount={selected.length}
          users={initialAssignableUsers}
          onAssign={async (userId) => {
            const res = await assignLeadsBulkAction({ leadIds: selected, assigneeUserId: userId });
            if (!res.ok) setError(res.message);
            else {
              setSelected([]);
              reload();
            }
          }}
          onClear={() => setSelected([])}
        />
      )}

      {/* 右侧全功能免二级跳转滑动工作台 (In-Place Detail Hub) */}
      <LeadDrawer
        lead={drawerLead}
        leadsList={uniqueLeads}
        currentIndex={currentIndex}
        initialPanel={drawerPanel}
        role={role}
        users={initialAssignableUsers}
        onClose={closeDrawer}
        onNavigate={handleNavigate}
        onRefresh={() => reload()}
        runAction={runAction}
        isAiCopilotEnabled={isAiCopilotEnabled}
      />

      {/* 新建线索 Modal */}
      {showCreate && (
        <CreateLeadModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {/* 导入 CSV Modal */}
      {showImport && isManager && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            reload();
          }}
          onError={setError}
        />
      )}

      {/* 独立 Portal 悬浮操作菜单 (100% 免疫表格 overflow 裁切) */}
      {menuAnchor && typeof document !== "undefined" && (() => {
        const targetMenuLead = uniqueLeads.find((l) => l.id === menuAnchor.leadId);
        if (!targetMenuLead) return null;
        const canMenuConvert = targetMenuLead.status === "QUALIFIED" && Boolean(targetMenuLead.ownerUserId);
        const terminal = targetMenuLead.status === "CONVERTED" || targetMenuLead.status === "DISCARDED";

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
                <span>线索操作</span>
                <span className="font-normal text-slate-600 truncate max-w-[90px]">{targetMenuLead.contactName}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuLead, "overview");
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
                      openDrawer(targetMenuLead, "activity");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 font-medium rounded"
                  >
                    记录跟进
                  </button>

                  {targetMenuLead.status === "CONTACTED" && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuLead, "qualify");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-indigo-700 hover:bg-indigo-50 font-medium rounded"
                    >
                      确认需求合格
                    </button>
                  )}

                  {canMenuConvert && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuLead, "convert");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50 font-medium rounded"
                    >
                      转客户建商机
                    </button>
                  )}

                  {isManager && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuLead, "assign");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                    >
                      指派负责人
                    </button>
                  )}

                  {targetMenuLead.openTask && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuAnchor(null);
                        openDrawer(targetMenuLead, "reschedule");
                      }}
                      className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                    >
                      改约跟进时间
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuLead, "edit");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
                  >
                    修改线索资料
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  <button
                    type="button"
                    onClick={() => {
                      setMenuAnchor(null);
                      openDrawer(targetMenuLead, "discard");
                    }}
                    className="flex w-full items-center px-2.5 py-1.5 text-red-600 hover:bg-red-50 font-medium rounded"
                  >
                    放弃此线索
                  </button>
                </>
              ) : (
                <div className="px-2.5 py-1 text-[11px] text-slate-400 italic">
                  {targetMenuLead.status === "CONVERTED" ? "已转为正式客户" : "已放弃归档"}
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

function FilterTab({
  label,
  count,
  countCeiling,
  active,
  onClick,
  always = false,
  badgeColor = "slate",
}: {
  label: string;
  count?: number;
  countCeiling?: number;
  active: boolean;
  onClick: () => void;
  always?: boolean;
  badgeColor?: "slate" | "red" | "emerald" | "amber" | "blue";
}) {
  if (!always && !active && (!count || count < 1)) return null;
  const displayCount = typeof count === "number" ? formatBoundedCount(count, countCeiling ?? 1000) : "";

  const badgeBg = {
    slate: active ? "bg-slate-100 text-slate-800 border border-slate-200/80" : "bg-slate-200/60 text-slate-600",
    red: active ? "bg-red-50 text-red-700 border border-red-200" : "bg-red-100/80 text-red-700",
    emerald: active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-emerald-100/80 text-emerald-700",
    amber: active ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-amber-100/80 text-amber-700",
    blue: active ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-blue-100/80 text-blue-700",
  }[badgeColor];

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-white text-slate-950 font-bold shadow-2xs border border-slate-200/80"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
      }`}
    >
      <span>{label}</span>
      {displayCount && (
        <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-semibold ${badgeBg}`}>
          {displayCount}
        </span>
      )}
    </button>
  );
}

function BulkActionBar({
  selectedCount,
  users,
  onAssign,
  onClear,
}: {
  selectedCount: number;
  users: AssignableUser[];
  onAssign: (userId: string) => Promise<void>;
  onClear: () => void;
}) {
  const [targetUser, setTargetUser] = useState(users[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleAssign() {
    if (!targetUser) return;
    setSubmitting(true);
    try {
      await onAssign(targetUser);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed bottom-6 inset-x-0 mx-auto max-w-xl px-4 z-30">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/95 p-3.5 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold font-mono">
            {selectedCount}
          </span>
          <span className="text-xs font-medium">条线索已选中</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={targetUser}
            onChange={(e) => setTargetUser(e.target.value)}
            className="h-8 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs text-white outline-none"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                分配给: {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={submitting}
            onClick={handleAssign}
            className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-500 shadow-sm disabled:opacity-50"
          >
            {submitting ? "分配中..." : "批量指派"}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs text-slate-400 hover:text-white hover:bg-slate-800"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadTableSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function LeadEmptyState({
  hasSearch,
  hasFilter,
  canImport,
  onCreate,
  onImport,
  onClear,
}: {
  hasSearch: boolean;
  hasFilter: boolean;
  canImport: boolean;
  onCreate: () => void;
  onImport: () => void;
  onClear: () => void;
}) {
  if (hasSearch || hasFilter) {
    return (
      <EmptyState
        title="没有找到匹配的线索记录"
        description="请尝试调整搜索关键词或重置筛选条件"
        actionLabel="清除筛选条件"
        onAction={onClear}
      />
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white py-14 px-4 text-center shadow-xs">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500 mb-3 shadow-2xs">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
        </svg>
      </div>
      <h4 className="text-sm font-semibold text-slate-900">线索池暂无数据</h4>
      <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
        您可以通过手工录入、批量 CSV 导入、公开表单或 API 进线创建线索
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" size="sm" onClick={onCreate}>
          + 新建第一条线索
        </Button>
        {canImport && (
          <Button variant="secondary" size="sm" onClick={onImport}>
            批量导入
          </Button>
        )}
      </div>
    </div>
  );
}

function CreateLeadModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(emptyLead);
  const [errors, setErrors] = useState<Partial<Record<keyof LeadForm, string>>>({});
  const [duplicate, setDuplicate] = useState<CreateLeadResult["duplicateOf"]>();
  const [collision, setCollision] = useState<CreateLeadResult["collision"]>();
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customProductMode, setCustomProductMode] = useState(false);

  useEffect(() => {
    listProductsAction({ status: "ACTIVE" }).then((res) => {
      if (res.ok && res.data) {
        setProducts(res.data);
      }
    });
  }, []);

  const groupedProducts = useMemo(() => {
    const map: Record<string, ProductItem[]> = {};
    for (const p of products) {
      const cat = p.category || "常规产品";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }
    return map;
  }, [products]);

  async function submit(confirmDuplicate = false, reactivateLeadId?: string, claimPublicLeadId?: string) {
    const nextErrors = validateLead(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setPending(true);
    setServerError(null);
    try {
      const result = await createLeadAction({
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        title: form.title.trim() || undefined,
        intendedProductId: form.intendedProductId.trim() || undefined,
        intendedProduct: form.intendedProduct.trim() || undefined,
        budget: form.budget.trim() || undefined,
        channel: form.channel.trim() || undefined,
        note: form.note.trim() || undefined,
        confirmDuplicate,
        reactivateLeadId,
        claimPublicLeadId,
      });
      if (!result.ok) {
        setServerError(result.message);
        return;
      }
      if (!result.data.created) {
        if (result.data.collision) {
          setCollision(result.data.collision);
        }
        if (result.data.duplicateOf) {
          setDuplicate(result.data.duplicateOf);
        }
        return;
      }
      onCreated();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "创建失败，请重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="新建线索" onClose={onClose}>
      {collision?.canReactivate && (
        <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/80 p-3.5 text-xs text-indigo-950">
          <p className="font-bold">发现历史流失线索：</p>
          <p className="mt-1">
            该联系人曾于历史跟进中标记放弃。可一键重新激活并认领入您的私海，系统将自动重置状态并生成首响任务。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={buttonClass("primary")} disabled={pending} onClick={() => submit(false, collision.leadId)}>
              {pending ? "激活中..." : "重新激活并认领入私海"}
            </button>
            <a href={`/leads?search=${encodeURIComponent(form.contactPhone)}`} className={buttonClass()}>
              查看历史档案
            </a>
          </div>
        </div>
      )}

      {collision?.canClaim && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/80 p-3.5 text-xs text-blue-950">
          <p className="font-bold">公海池已有该线索：</p>
          <p className="mt-1">
            该线索已在公海池中待认领，无需重复创建。您可以直接将其认领入您的私海。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={buttonClass("primary")} disabled={pending} onClick={() => submit(false, undefined, collision.leadId)}>
              {pending ? "认领中..." : "直接认领入私海"}
            </button>
            <a href={`/leads?search=${encodeURIComponent(form.contactPhone)}`} className={buttonClass()}>
              查看公海线索
            </a>
          </div>
        </div>
      )}

      {collision && !collision.canReactivate && !collision.canClaim && collision.collisionType === "EXISTING_CUSTOMER_CONTACT" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
          <p className="font-bold">发现已有客户联系人冲突：</p>
          <p className="mt-1">
            {collision.message}
          </p>
          {collision.customerId && (
            <p className="mt-1 text-slate-600">
              关联客户：<span className="font-semibold">{collision.customerName || "未知客户"}</span>
              {collision.ownerName ? ` · 负责人：${collision.ownerName}` : " · 当前在公海"}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {collision.customerId && (
              <a href={`/customers/${collision.customerId}`} className={buttonClass("primary")}>
                前往对应客户详情
              </a>
            )}
            <button className={buttonClass()} onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      )}

      {!collision?.canReactivate && !collision?.canClaim && collision?.collisionType !== "EXISTING_CUSTOMER_CONTACT" && duplicate && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
          <p className="font-semibold">发现疑似重复线索：</p>
          <p className="mt-1">
            该手机号已存在线索：{duplicate.contactName}
            {duplicate.companyName ? ` · ${duplicate.companyName}` : ""}
            {duplicate.ownerName ? ` · 负责人 ${duplicate.ownerName}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/leads?search=${encodeURIComponent(form.contactPhone)}`} className={buttonClass()}>
              查看已有线索
            </a>
            <button className={buttonClass("primary")} disabled={pending} onClick={() => submit(true)}>
              仍然创建
            </button>
          </div>
        </div>
      )}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="联系人姓名 *" error={errors.contactName}>
          <input
            autoFocus
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            className={inputClass(errors.contactName)}
            placeholder="例如：张总"
          />
        </Field>
        <Field label="手机号 *" error={errors.contactPhone}>
          <input
            inputMode="tel"
            value={form.contactPhone}
            onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            className={inputClass(errors.contactPhone)}
            placeholder="11 位手机号"
          />
        </Field>
        <Field label="公司名称" error={errors.companyName}>
          <input
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className={inputClass(errors.companyName)}
            placeholder="企业全称或品牌名"
          />
        </Field>
        <Field label="职位 / 头衔" error={errors.title}>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={inputClass(errors.title)}
            placeholder="例如：采购总监 / CTO"
          />
        </Field>
        <Field label="电子邮箱" error={errors.contactEmail}>
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            className={inputClass(errors.contactEmail)}
            placeholder="name@company.com"
          />
        </Field>

        <Field label="意向产品" error={errors.intendedProduct}>
          <div className="space-y-1.5">
            {products.length > 0 ? (
              <>
                <select
                  value={customProductMode ? "__CUSTOM__" : form.intendedProductId}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "__CUSTOM__") {
                      setCustomProductMode(true);
                      setForm({ ...form, intendedProductId: "", intendedProduct: "" });
                    } else if (val === "") {
                      setCustomProductMode(false);
                      setForm({ ...form, intendedProductId: "", intendedProduct: "" });
                    } else {
                      setCustomProductMode(false);
                      const p = products.find((item) => item.id === val);
                      if (p) {
                        setForm({
                          ...form,
                          intendedProductId: p.id,
                          intendedProduct: p.name,
                          budget: form.budget || (p.unitPrice ? `¥${(p.unitPrice / 100).toLocaleString()}` : form.budget),
                        });
                      }
                    }
                  }}
                  className={inputClass()}
                >
                  <option value="">请选择意向产品</option>
                  {Object.entries(groupedProducts).map(([category, prods]) => (
                    <optgroup key={category} label={category}>
                      {prods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code}) · ¥{(p.unitPrice / 100).toLocaleString()}/{p.unit} [{formatPricingModel(p.pricingModel)}]
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="__CUSTOM__">+ 自定义 / 非标需求</option>
                </select>

                {customProductMode && (
                  <input
                    autoFocus
                    value={form.intendedProduct}
                    onChange={(e) => setForm({ ...form, intendedProductId: "", intendedProduct: e.target.value })}
                    className={inputClass(errors.intendedProduct)}
                    placeholder="输入自定义产品需求名称..."
                  />
                )}
              </>
            ) : (
              <div className="space-y-1">
                <input
                  value={form.intendedProduct}
                  onChange={(e) => setForm({ ...form, intendedProductId: "", intendedProduct: e.target.value })}
                  className={inputClass(errors.intendedProduct)}
                  placeholder="例如：企业旗舰版 / 私有化部署"
                />
                <p className="text-[10px] text-slate-400">
                  暂未配置标准产品，可在「产品配置」中维护。
                </p>
              </div>
            )}
          </div>
        </Field>

        <Field label="预估预算" error={errors.budget}>
          <input
            value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })}
            className={inputClass(errors.budget)}
            placeholder="例如：100,000 或 5-10万"
          />
        </Field>

        <Field label="获客渠道 (Channel)">
          <select
            value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value })}
            className={inputClass()}
          >
            <option value="direct">主动开发 / 销售自拓</option>
            <option value="baidu_ads">百度推广 (Baidu Ads)</option>
            <option value="douyin">抖音 / 巨量信息流 (Douyin)</option>
            <option value="official_website">官方网站留资 (Website)</option>
            <option value="offline_expo">线下展会 / 峰会 (Expo)</option>
            <option value="referral">老客户转介绍 (Referral)</option>
            <option value="partner">渠道生态伙伴 (Partner)</option>
            <option value="other">其他渠道 (Other)</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="需求描述" error={errors.note}>
            <textarea
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className="w-full rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:border-slate-900"
              placeholder="输入客户业务诉求与需求细节..."
            />
          </Field>
        </div>
      </div>
      {serverError && <p role="alert" className="mt-3 text-xs text-red-700">{serverError}</p>}
      {!duplicate && (
        <div className="mt-6 flex justify-end gap-2">
          <button className={buttonClass()} onClick={onClose}>
            取消
          </button>
          <button className={buttonClass("primary")} disabled={pending} onClick={() => submit()}>
            {pending ? "提交中..." : "确认创建"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ImportModal({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<ImportPreview["valid"][number]["data"][]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [pending, setPending] = useState(false);
  const [resultSummary, setResultSummary] = useState<{ created: number; skipped: number; failed: number } | null>(null);
  const [errors, setErrors] = useState<Array<{ rowNumber: number; contactMasked: string; reason: string }>>([]);
  const [copied, setCopied] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onError("文件大小不能超过 2MB");
      return;
    }
    setPending(true);
    setResultSummary(null);
    setErrors([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const response = await importLeadsPreviewAction({ base64: btoa(binary) });
      if (!response.ok) onError(response.message);
      else {
        setPreview(response.data);
        setRows([...response.data.valid, ...response.data.duplicates].map((row) => row.data));
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "预览失败，请重试");
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setPending(true);
    try {
      const response = await importLeadsCommitAction({ rows, skipDuplicates });
      if (!response.ok) onError(response.message);
      else {
        setResultSummary({
          created: response.data.created,
          skipped: response.data.skipped,
          failed: response.data.failed,
        });
        setErrors(response.data.errors || []);
        onDone();
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "导入失败，请重试");
    } finally {
      setPending(false);
    }
  }

  function copyErrors() {
    if (!errors.length) return;
    const text = ["行号\t联系方式\t失败原因", ...errors.map((e) => `${e.rowNumber}\t${e.contactMasked}\t${e.reason}`)].join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadErrorsCsv() {
    if (!errors.length) return;
    const header = "行号,联系方式,失败原因\n";
    const body = errors.map((e) => `"${e.rowNumber}","${e.contactMasked.replace(/"/g, '""')}","${e.reason.replace(/"/g, '""')}"`).join("\n");
    const blob = new Blob(["\uFEFF" + header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads_import_errors_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const groups = preview
    ? [
        { label: "可导入", count: preview.valid.length, color: "text-emerald-700 bg-emerald-50" },
        { label: "疑似重复", count: preview.duplicates.length, color: "text-amber-700 bg-amber-50" },
        { label: "格式错误", count: preview.errors.length, color: "text-red-700 bg-red-50" },
      ]
    : [];

  const previewRows = preview
    ? [
        ...preview.valid.map((row) => ({ ...row.data, row: row.row, state: "可导入" })),
        ...preview.duplicates.map((row) => ({ ...row.data, row: row.row, state: "疑似重复" })),
        ...preview.errors.map((row) => ({ contactName: "-", contactPhone: "-", companyName: "-", row: row.row, state: row.message })),
      ]
    : [];

  return (
    <Modal title="批量导入线索 (CSV)" onClose={onClose}>
      {!resultSummary ? (
        <>
          <label className="flex min-h-16 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-4 text-xs text-slate-600 hover:bg-slate-100 transition">
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFile} />
            <span className="font-semibold text-slate-900">点击选择或拖拽 CSV 文件至此处</span>
            <span className="mt-1 text-[11px] text-slate-400">支持 UTF-8 / GBK 编码，文件最大 2MB</span>
          </label>

          {pending && <div className="mt-3 h-1.5 animate-pulse rounded bg-blue-500" />}

          {preview && (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                {groups
                  .filter((group) => group.count > 0)
                  .map((group) => (
                    <span key={group.label} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${group.color}`}>
                      {group.label} {group.count} 条
                    </span>
                  ))}
              </div>

              <div className="mt-3.5 max-h-64 overflow-auto rounded-lg border border-slate-200 text-xs">
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3 py-2">姓名</th>
                      <th className="px-3 py-2">手机号</th>
                      <th className="px-3 py-2">公司</th>
                      <th className="px-3 py-2">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.slice(0, 50).map((row) => (
                      <tr key={row.row}>
                        <td className="px-3 py-2 font-medium">{row.contactName}</td>
                        <td className="px-3 py-2 font-mono">{row.contactPhone}</td>
                        <td className="px-3 py-2 text-slate-500">{row.companyName ?? "-"}</td>
                        <td className="px-3 py-2">{row.state}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <label className="mt-3.5 flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900"
                />
                <span>跳过疑似重复的手机号记录</span>
              </label>

              <div className="mt-5 flex justify-end gap-2">
                <button className={buttonClass()} onClick={onClose}>
                  取消
                </button>
                <button className={buttonClass("primary")} disabled={pending} onClick={commit}>
                  {pending ? "导入中..." : "确认导入入库"}
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="space-y-4 text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <h4 className="font-bold text-slate-900 text-sm">导入执行完毕</h4>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 border border-emerald-200">
                成功创建 {resultSummary.created} 条
              </span>
              <span className="rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 border border-amber-200">
                跳过重复 {resultSummary.skipped} 条
              </span>
              <span className="rounded-md bg-rose-50 px-2.5 py-1 font-semibold text-rose-700 border border-rose-200">
                失败 {resultSummary.failed} 条
              </span>
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">失败明细 ({errors.length} 条)</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyErrors}
                    className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-medium cursor-pointer"
                  >
                    {copied ? "已复制" : "复制失败明细"}
                  </button>
                  <button
                    type="button"
                    onClick={downloadErrorsCsv}
                    className="px-2.5 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs font-medium cursor-pointer"
                  >
                    下载失败明细 CSV
                  </button>
                </div>
              </div>

              <div className="max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-left">
                  <thead className="bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3 py-2 w-16">行号</th>
                      <th className="px-3 py-2 w-32">联系方式</th>
                      <th className="px-3 py-2">失败原因</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {errors.map((err, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-mono text-slate-500">第 {err.rowNumber} 行</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{err.contactMasked}</td>
                        <td className="px-3 py-2 text-rose-600 font-medium">{err.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-slate-500">全部数据均已顺利导入或按规则跳过，无异常报错。</p>
          )}

          <div className="flex justify-end pt-2">
            <button className={buttonClass("primary")} onClick={onClose}>
              完成并关闭
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button className={buttonClass("text")} onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <span className="mt-1.5 block font-normal">{children}</span>
      {error && <span className="mt-1 block text-xs font-normal text-red-600">{error}</span>}
    </label>
  );
}
