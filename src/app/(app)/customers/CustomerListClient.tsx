"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import type { CustomerList } from "@/core/customer/types";
import { stageLabel } from "@/core/shared/display";
import { formatDateOnly } from "@/core/shared/date";
import CustomerDrawer, { CustomerDrawerPanel, CustomerItem } from "./CustomerDrawer";
import MaskedPhone from "@/core/security/MaskedPhone";
import { createCustomerDirectAction } from "@/core/customer/actions";
import {
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  EmptyState,
} from "@/components/ui";

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "全部客户" },
  { value: "active", label: "商机跟进中" },
  { value: "no-active", label: "待立项客户" },
  { value: "stalled", label: "超期未跟进" },
];

export default function CustomerListClient({
  initial,
  search: initialSearch,
  status: initialStatus,
  sort: initialSort,
}: {
  initial: CustomerList;
  search: string;
  status: string;
  sort: string;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [drawerCustomerId, setDrawerCustomerId] = useState<string | null>(null);
  const [drawerPanel, setDrawerPanel] = useState<CustomerDrawerPanel>("overview");
  const [menuAnchor, setMenuAnchor] = useState<{ customerId: string; top: number; right: number } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    customerType: "ENTERPRISE" as "ENTERPRISE" | "INDIVIDUAL",
    industry: "企业服务",
    region: "华东大区",
    size: "21-100" as "1-20" | "21-100" | "101-500" | "501-1000" | "1000+",
    contactName: "",
    contactPhone: "",
    contactTitle: "业务负责人",
    contactEmail: "",
    contactRoleTag: "DECISION_MAKER" as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();
  const router = useRouter();

  const activeCustomer = initial.items.find((i) => i.id === drawerCustomerId) || null;
  const activeIndex = activeCustomer ? initial.items.findIndex((i) => i.id === activeCustomer.id) : -1;

  function openDrawer(c: CustomerItem, panel: CustomerDrawerPanel = "overview") {
    setDrawerCustomerId(c.id);
    setDrawerPanel(panel);
  }

  function closeDrawer() {
    setDrawerCustomerId(null);
  }

  function navigateDrawer(nextIndex: number) {
    if (nextIndex >= 0 && nextIndex < initial.items.length) {
      setDrawerCustomerId(initial.items[nextIndex].id);
      setDrawerPanel("overview");
    }
  }

  function navigateStatus(value: string, query = search) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    if (value !== "all") params.set("status", value);
    if (initialSort !== "recent") params.set("sort", initialSort);
    router.push(`/customers?${params}` as never);
  }

  function navigateSort(value: string) {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (initialStatus !== "all") params.set("status", initialStatus);
    if (value !== "recent") params.set("sort", value);
    router.push(`/customers?${params}` as never);
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (initialStatus !== "all") params.set("status", initialStatus);
    if (initialSort !== "recent") params.set("sort", initialSort);
    router.push(`/customers?${params}` as never);
  }

  function handleCreateCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) {
      setCreateError("请填写客户企业全称");
      return;
    }
    setCreateError(null);
    startCreateTransition(async () => {
      const res = await createCustomerDirectAction({
        name: createForm.name.trim(),
        customerType: createForm.customerType,
        industry: createForm.industry,
        region: createForm.region,
        size: createForm.size,
        contactName: createForm.contactName.trim() || undefined,
        contactPhone: createForm.contactPhone.trim() || undefined,
        contactEmail: createForm.contactEmail.trim() || undefined,
        contactTitle: createForm.contactTitle.trim() || undefined,
        contactRoleTag: createForm.contactRoleTag,
      });
      if (res.ok) {
        setShowCreateModal(false);
        setCreateForm({
          name: "",
          customerType: "ENTERPRISE",
          industry: "企业服务",
          region: "华东大区",
          size: "21-100",
          contactName: "",
          contactPhone: "",
          contactTitle: "业务负责人",
          contactEmail: "",
          contactRoleTag: "DECISION_MAKER",
        });
        router.refresh();
        const data = res.data as { customerId: string; contactId: string | null } | undefined;
        if (data?.customerId) {
          setDrawerCustomerId(data.customerId);
          setDrawerPanel("overview");
        }
      } else {
        setCreateError(res.message);
      }
    });
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
            <h1 className="text-xl font-bold tracking-tight text-slate-950">客户管理</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {initial.items.length} 家客户
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            企业客户全生命周期档案，沉淀决策链图谱、商机管线与跟进资产
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              setCreateError(null);
              setShowCreateModal(true);
            }}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            新建客户
          </Button>
          <Link href="/leads">
            <Button variant="secondary" size="md">
              从线索池转化
            </Button>
          </Link>
        </div>
      </header>

      {/* 筛选与搜索工具条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
        {/* 状态过滤 Tabs (Segmented Control Track) */}
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/70 shadow-2xs">
          {FILTERS.map((f) => {
            const isActive = initialStatus === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => navigateStatus(f.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
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

        {/* 搜索与排序 */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 min-w-[min(100%,20rem)] sm:max-w-xl">
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
              aria-label="搜索企业全称或联系人"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch(e as never);
                }
              }}
              placeholder="搜索企业全称、联系人..."
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition shadow-2xs placeholder:text-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  navigateStatus(initialStatus, "");
                }}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>

          <select
            value={initialSort}
            onChange={(e) => navigateSort(e.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none cursor-pointer"
          >
            <option value="recent">排序：最近互动</option>
            <option value="created">排序：最新创建</option>
          </select>
        </div>
      </div>

      {/* Main Content: High-Density Table */}
      {initial.items.length === 0 ? (
        <EmptyState
          title="没有匹配的客户档案"
          description="客户由已确认需求的线索转化而来，或可前往线索池推进转化。"
          actionLabel="前往线索池"
          onAction={() => router.push("/leads")}
        />
      ) : (
        <div className="space-y-4">
          {/* Desktop High-Density Table */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <Table>
              <TableHeader>
                <tr>
                  <TableHead className="px-4">客户企业全称</TableHead>
                  <TableHead className="w-32">运营状态</TableHead>
                  <TableHead className="w-36">行业 / 地区</TableHead>
                  <TableHead className="w-36">主联系人</TableHead>
                  <TableHead className="w-24">负责人</TableHead>
                  <TableHead className="w-32">商机概览</TableHead>
                  <TableHead>最近互动时间</TableHead>
                  <TableHead className="w-32 px-4 text-right">操作</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {initial.items.map((customer) => {
                  const isCurrentOpen = drawerCustomerId === customer.id;

                  return (
                    <TableRow
                      key={customer.id}
                      isClickable
                      isSelected={isCurrentOpen}
                      onClick={() => openDrawer(customer, "overview")}
                    >
                      <TableCell className="px-4">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={customer.customerType === "INDIVIDUAL" ? "purple" : "teal"}
                            size="sm"
                          >
                            {customer.customerType === "INDIVIDUAL" ? "个人" : "单位"}
                          </Badge>
                          <span className="font-semibold text-slate-900 hover:text-blue-600 truncate max-w-[200px] transition-colors">
                            {customer.name}
                          </span>
                        </div>
                        {customer.size && customer.customerType !== "INDIVIDUAL" && (
                          <div className="mt-0.5 text-[11px] text-slate-400">
                            规模：{customer.size} 人
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <Badge
                          variant={
                            customer.operatingStatus === "推进中"
                              ? "blue"
                              : customer.operatingStatus === "已成交"
                              ? "emerald"
                              : "neutral"
                          }
                          dot
                          size="md"
                        >
                          {customer.operatingStatus}
                        </Badge>
                        {customer.progressingStage && (
                          <div className="mt-0.5 text-[10.5px] text-slate-500 font-medium">
                            {stageLabel(customer.progressingStage)}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-slate-600">
                        <div className="font-medium text-slate-800">{customer.industry || "-"}</div>
                        <div className="text-[11px] text-slate-400">{customer.region || "-"}</div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="font-medium text-slate-800">
                          {customer.primaryContactName || "未指定"}
                        </div>
                        {customer.primaryContactPhone && (
                          <div className="mt-0.5">
                            <MaskedPhone
                              phone={customer.primaryContactPhone}
                              entityType="CUSTOMER"
                      reason="客户列表检索后电话联络"
                              entityId={customer.id}
                              className="text-[11px] font-mono"
                              showCopy={true}
                            />
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap font-medium text-slate-800">
                        {customer.ownerName}
                      </TableCell>

                      <TableCell className="whitespace-nowrap">
                        <div className="font-semibold text-slate-900 font-mono">
                          {customer.opportunityCount} <span className="text-xs font-normal text-slate-500 font-sans">个商机</span>
                        </div>
                        <div className="text-[10.5px] text-slate-400 mt-0.5">
                          进行中 {customer.activeOpportunityCount} · 赢单 {customer.wonOpportunityCount}
                        </div>
                      </TableCell>

                      <TableCell className="text-slate-500 whitespace-nowrap font-mono text-[11px]">
                        {customer.recentInteractionAt
                          ? formatDateOnly(customer.recentInteractionAt)
                          : "暂无记录"}
                      </TableCell>

                      <TableCell className="px-4 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => openDrawer(customer, "opportunity")}
                          >
                            发起商机
                          </Button>

                          <Button
                            variant={menuAnchor?.customerId === customer.id ? "primary" : "secondary"}
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              if (menuAnchor?.customerId === customer.id) {
                                setMenuAnchor(null);
                              } else {
                                setMenuAnchor({
                                  customerId: customer.id,
                                  top: rect.bottom + 4,
                                  right: window.innerWidth - rect.right,
                                });
                              }
                            }}
                            title="展开该客户的全部操作"
                          >
                            ⋯ 操作
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Responsive Cards */}
          <div className="grid gap-3 md:hidden">
            {initial.items.map((customer) => (
              <article
                key={customer.id}
                onClick={() => openDrawer(customer, "overview")}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={customer.customerType === "INDIVIDUAL" ? "purple" : "teal"}
                        size="sm"
                      >
                        {customer.customerType === "INDIVIDUAL" ? "个人" : "单位"}
                      </Badge>
                      <Badge
                        variant={
                          customer.operatingStatus === "推进中"
                            ? "blue"
                            : customer.operatingStatus === "已成交"
                            ? "emerald"
                            : "neutral"
                        }
                        dot
                        size="sm"
                      >
                        {customer.operatingStatus}
                      </Badge>
                      {customer.progressingStage && (
                        <span className="text-[10px] text-slate-500 font-medium">
                          {stageLabel(customer.progressingStage)}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-sm font-bold text-slate-900">{customer.name}</h2>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 border-t border-slate-100 pt-2.5">
                  <div>
                    <span className="text-slate-400 text-[11px]">主联系人:</span>{" "}
                    <span className="font-medium text-slate-800">{customer.primaryContactName || "-"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px]">负责人:</span>{" "}
                    <span className="font-medium text-slate-800">{customer.ownerName}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400 text-[11px]">商机概况:</span>{" "}
                    <span className="font-semibold text-slate-900 font-mono">{customer.opportunityCount} 个</span>
                    <span className="text-[10.5px] text-slate-400 ml-1">
                      (进行中 {customer.activeOpportunityCount} · 赢单 {customer.wonOpportunityCount})
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => openDrawer(customer, "opportunity")}
                  >
                    发起商机
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => openDrawer(customer, "overview")}
                  >
                    全景档案
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {/* Cursor Pagination */}
          {initial.nextCursor && (
            <div className="pt-2 text-center">
              <Link
                href={`/customers?${new URLSearchParams({
                  ...(initialSearch ? { search: initialSearch } : {}),
                  ...(initialStatus !== "all" ? { status: initialStatus } : {}),
                  ...(initialSort !== "recent" ? { sort: initialSort } : {}),
                  cursor: initial.nextCursor,
                })}`}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs"
              >
                加载更多客户 ↓
              </Link>
            </div>
          )}
        </div>
      )}

      {/* In-Place Slide-over Hub */}
      <CustomerDrawer
        customer={activeCustomer}
        customersList={initial.items}
        currentIndex={activeIndex}
        initialPanel={drawerPanel}
        onClose={closeDrawer}
        onNavigate={navigateDrawer}
        onRefresh={() => {
          closeDrawer();
          router.refresh();
        }}
      />

      {/* 独立 Portal 悬浮操作菜单 */}
      {menuAnchor && typeof document !== "undefined" && (() => {
        const targetMenuCust = initial.items.find((i) => i.id === menuAnchor.customerId);
        if (!targetMenuCust) return null;

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
                <span>客户操作</span>
                <span className="font-normal text-slate-600 truncate max-w-[90px]">{targetMenuCust.name}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuCust, "overview");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 font-medium rounded"
              >
                查看全量档案
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuCust, "opportunity");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-emerald-700 hover:bg-emerald-50 font-medium rounded"
              >
                立项发起新商机
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuCust, "activity");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
              >
                记录客户跟进
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuCust, "contact");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
              >
                添加企业联系人
              </button>

              <div className="border-t border-slate-100 my-1" />

              <button
                type="button"
                onClick={() => {
                  setMenuAnchor(null);
                  openDrawer(targetMenuCust, "edit");
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-slate-700 hover:bg-slate-100 rounded"
              >
                修改企业资料
              </button>
            </div>
          </>,
          document.body
        );
      })()}

      {/* 新建客户模态弹窗 (Direct Customer Creation Modal) */}
      {showCreateModal && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-lg bg-white rounded-2xl p-6 shadow-2xl border border-slate-200 space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-2xs">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <h2 className="font-bold text-slate-950 text-sm">直接新建企业客户档案</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition text-sm"
                >
                  ×
                </button>
              </div>

              {createError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium shadow-2xs flex items-center gap-2">
                  <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateCustomer} className="space-y-4">
                {/* 1. 企业基础信息 */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      企业全称 <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={createForm.name}
                      onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                      placeholder="例如：杭州智云数字科技有限公司"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">行业领域</label>
                      <select
                        value={createForm.industry}
                        onChange={(e) => setCreateForm({ ...createForm, industry: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      >
                        <option value="企业服务">企业服务 (SaaS/IT)</option>
                        <option value="制造业">先进制造业</option>
                        <option value="互联网软件">互联网与软件</option>
                        <option value="金融服务">金融与财税</option>
                        <option value="医疗健康">医疗与大健康</option>
                        <option value="零售消费">零售与跨境消费</option>
                        <option value="其他">其他行业</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">企业人员规模</label>
                      <select
                        value={createForm.size}
                        onChange={(e) => setCreateForm({ ...createForm, size: e.target.value as typeof createForm.size })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      >
                        <option value="1-20">1-20 人</option>
                        <option value="21-100">21-100 人 (标准中型)</option>
                        <option value="101-500">101-500 人 (成长型)</option>
                        <option value="501-1000">501-1000 人 (大型企事业)</option>
                        <option value="1000+">1000 人以上 (战略KA)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. 核心决策人联系方式 */}
                <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-900">核心联系人 / 拍板人信息</span>
                    <span className="text-[10px] text-slate-400">选填 · 后续可在档案中增补</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-1">联系人姓名</label>
                      <input
                        type="text"
                        value={createForm.contactName}
                        onChange={(e) => setCreateForm({ ...createForm, contactName: e.target.value })}
                        placeholder="例如：张总"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-1">手机号码</label>
                      <input
                        type="tel"
                        value={createForm.contactPhone}
                        onChange={(e) => setCreateForm({ ...createForm, contactPhone: e.target.value })}
                        placeholder="13800000000"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-1">决策角色标记</label>
                      <select
                        value={createForm.contactRoleTag}
                        onChange={(e) => setCreateForm({ ...createForm, contactRoleTag: e.target.value as typeof createForm.contactRoleTag })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      >
                        <option value="DECISION_MAKER">关键决策人 (EB/一票否决)</option>
                        <option value="TECH_EVALUATOR">技术评估人 (CTO/IT总监)</option>
                        <option value="PROCUREMENT">商务采购 (Procurement)</option>
                        <option value="USER">实际使用人员 (User)</option>
                        <option value="OTHER">其他关联人</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-600 mb-1">职位头衔</label>
                      <input
                        type="text"
                        value={createForm.contactTitle}
                        onChange={(e) => setCreateForm({ ...createForm, contactTitle: e.target.value })}
                        placeholder="分管副总 / 业务一号位"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 text-xs shadow-2xs disabled:opacity-50"
                  >
                    {isCreating ? "保存中..." : "保存并打开档案"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
