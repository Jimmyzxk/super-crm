"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  addContact,
  getCustomerDetail,
  getCustomerTimeline,
  updateCustomer,
} from "@/core/customer/actions";
import { createOpportunity } from "@/core/opportunity/actions";
import { logActivity } from "@/core/followup/actions";
import type { CustomerDetail, CustomerList, CustomerTimelinePage } from "@/core/customer/types";
import { listProductsAction } from "@/core/products/actions";
import type { ProductItem } from "@/core/products/types";
import { formatAmountInCents, stageLabel } from "@/core/shared/display";
import { parseLocalDateTime } from "@/core/shared/date";
import MaskedPhone from "@/core/security/MaskedPhone";
import { useSecurityConfig } from "@/core/security/SecurityConfigProvider";
import { maskPhone } from "@/core/security/masking";

export type CustomerItem = CustomerList["items"][number];
export type CustomerDrawerPanel = "opportunity" | "activity" | "contact" | "edit" | "overview";

interface Props {
  customer: CustomerItem | null;
  customersList: CustomerItem[];
  currentIndex: number;
  initialPanel?: CustomerDrawerPanel;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onRefresh: () => void;
}

const inputClass = () =>
  "min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";

const textareaClass = () =>
  "w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-2xs resize-y min-h-[96px] placeholder:text-slate-400";

const buttonClass = (variant: "primary" | "secondary" | "danger" = "secondary") => {
  if (variant === "primary") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition";
  }
  if (variant === "danger") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-red-700 disabled:opacity-50 transition";
  }
  return "inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs";
};

export default function CustomerDrawer(props: Props) {
  if (!props.customer) return null;
  return <CustomerDrawerInner key={props.customer.id} {...props} customer={props.customer} />;
}

function CustomerDrawerInner({
  customer,
  customersList,
  currentIndex,
  initialPanel,
  onClose,
  onNavigate,
  onRefresh,
}: Props & { customer: CustomerItem }) {
  const { isPhoneMaskingEnabled } = useSecurityConfig();
  const [activePanel, setActivePanel] = useState<CustomerDrawerPanel>(() => {
    if (initialPanel && initialPanel !== "overview") return initialPanel;
    return "opportunity";
  });

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [timeline, setTimeline] = useState<CustomerTimelinePage["items"]>([]);
  const [detailLoading, startDetailTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [opportunityForm, setOpportunityForm] = useState({
    name: "",
    expectedAmount: "",
    expectedCloseAt: "",
    stage: "DISCOVERY" as const,
    primaryContactId: "",
    demandNote: "",
  });

  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    pricingModel: string;
    quantity: number;
    discountRate: number;
  }>>([]);

  const [activityForm, setActivityForm] = useState({
    type: "CALL",
    outcome: "CONNECTED",
    summary: "",
    nextFollowUpAt: "",
  });

  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    email: "",
    title: "",
    roleTag: "OTHER" as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER",
    isPrimary: false,
  });

  const [editForm, setEditForm] = useState({
    name: customer.name,
    customerType: customer.customerType || "ENTERPRISE",
    industry: customer.industry || "",
    region: customer.region || "",
    size: customer.size || "1-20",
  });

  // Load available products for catalog quoting
  useEffect(() => {
    listProductsAction({ status: "ACTIVE" }).then((res) => {
      if (res.ok && res.data) {
        setAvailableProducts(res.data);
      }
    });
  }, []);

  // Load detail & timeline
  useEffect(() => {
    startDetailTransition(async () => {
      try {
        const [detailRes, timelineRes] = await Promise.all([
          getCustomerDetail(customer.id),
          getCustomerTimeline(customer.id, 50),
        ]);
        if (detailRes.ok && detailRes.data) {
          setDetail(detailRes.data);
          setEditForm({
            name: detailRes.data.customer.name,
            customerType: detailRes.data.customer.customerType || "ENTERPRISE",
            industry: detailRes.data.customer.industry || "",
            region: detailRes.data.customer.region || "",
            size: detailRes.data.customer.size || "1-20",
          });
          if (detailRes.data.contacts.length > 0) {
            const preferredContact =
              detailRes.data.contacts.find((c) => c.roleTag === "DECISION_MAKER") ||
              detailRes.data.contacts.find((c) => c.isPrimary) ||
              detailRes.data.contacts[0];
            setOpportunityForm((prev) => ({
              ...prev,
              primaryContactId: prev.primaryContactId || preferredContact.id,
            }));
          }
        }
        if (timelineRes.ok && timelineRes.data) {
          setTimeline(timelineRes.data.items);
        }
      } catch {
        // Fallback
      }
    });
  }, [customer.id]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName)) return;
      if (event.key === "ArrowUp" || event.key === "k" || event.key === "K") {
        if (currentIndex > 0) {
          event.preventDefault();
          onNavigate(currentIndex - 1);
        }
      } else if (event.key === "ArrowDown" || event.key === "j" || event.key === "J") {
        if (currentIndex < customersList.length - 1) {
          event.preventDefault();
          onNavigate(currentIndex + 1);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, customersList.length, onNavigate, onClose]);

  const handleAddProduct = (prodId: string) => {
    const prod = availableProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setSelectedProducts((prev) => {
      const existing = prev.find((p) => p.productId === prodId);
      if (existing) {
        return prev.map((p) => (p.productId === prodId ? { ...p, quantity: p.quantity + 1 } : p));
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          unitPrice: prod.unitPrice,
          pricingModel: prod.pricingModel,
          quantity: 1,
          discountRate: 100,
        },
      ];
    });
  };

  const handleRemoveProduct = (prodId: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.productId !== prodId));
  };

  const handleUpdateProduct = (prodId: string, quantity: number, discountRate: number) => {
    setSelectedProducts((prev) =>
      prev.map((p) =>
        p.productId === prodId
          ? { ...p, quantity: Math.max(1, quantity), discountRate: Math.min(100, Math.max(1, discountRate)) }
          : p,
      ),
    );
  };

  const computedProductsTotal = selectedProducts.reduce(
    (sum, p) => sum + Math.round((p.unitPrice * p.quantity * p.discountRate) / 100),
    0,
  );

  async function submitOpportunity(e: FormEvent) {
    e.preventDefault();
    if (!opportunityForm.primaryContactId) {
      setError("请选择或添加至少一位主联系人");
      return;
    }
    const totalAmountInCents =
      computedProductsTotal > 0
        ? computedProductsTotal
        : opportunityForm.expectedAmount
        ? Math.round(Number(opportunityForm.expectedAmount) * 100)
        : 0;

    const lineItems = selectedProducts.map((p) => ({
      productId: p.productId,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      discountRate: p.discountRate,
    }));

    setError(null);
    setPending(true);
    const res = await createOpportunity({
      customerId: customer.id,
      primaryContactId: opportunityForm.primaryContactId,
      name: opportunityForm.name.trim(),
      stage: opportunityForm.stage,
      expectedAmount: totalAmountInCents,
      expectedCloseAt: opportunityForm.expectedCloseAt ? new Date(opportunityForm.expectedCloseAt) : undefined,
      demandNote: opportunityForm.demandNote.trim() || undefined,
      lineItems: lineItems.length > 0 ? lineItems : undefined,
    });
    if (res.ok) {
      setOpportunityForm({
        name: "",
        expectedAmount: "",
        expectedCloseAt: "",
        stage: "DISCOVERY",
        primaryContactId: detail?.contacts[0]?.id || "",
        demandNote: "",
      });
      setSelectedProducts([]);
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitActivity(e: FormEvent) {
    e.preventDefault();
    if (!activityForm.summary.trim()) {
      setError("请填写跟进纪要");
      return;
    }
    setError(null);
    setPending(true);
    const res = await logActivity({
      customerId: customer.id,
      type: activityForm.type,
      outcome: activityForm.type === "NOTE" ? undefined : activityForm.outcome,
      summary: activityForm.summary.trim(),
      nextFollowUpAt: activityForm.nextFollowUpAt ? parseLocalDateTime(activityForm.nextFollowUpAt) : undefined,
    });
    if (res.ok) {
      setActivityForm({ type: "CALL", outcome: "CONNECTED", summary: "", nextFollowUpAt: "" });
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitContact(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await addContact({
      customerId: customer.id,
      name: contactForm.name.trim(),
      phone: contactForm.phone.trim(),
      email: contactForm.email.trim() || undefined,
      title: contactForm.title.trim() || undefined,
      roleTag: contactForm.roleTag,
      isPrimary: contactForm.isPrimary,
    });
    if (res.ok) {
      setContactForm({ name: "", phone: "", email: "", title: "", roleTag: "OTHER", isPrimary: false });
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await updateCustomer({
      customerId: customer.id,
      name: editForm.name.trim(),
      customerType: editForm.customerType as "ENTERPRISE" | "INDIVIDUAL",
      industry: editForm.industry.trim() || undefined,
      region: editForm.region.trim() || undefined,
      size: editForm.size as "1-20",
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`客户全景工作台 - ${customer.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-5xl xl:max-w-6xl 2xl:max-w-[1240px] flex-col border-l border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-out"
      >
        {/* 1. 顶部上下文导航栏 */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-slate-50/90 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 shadow-2xs">
              <button
                type="button"
                disabled={currentIndex <= 0}
                onClick={() => onNavigate(currentIndex - 1)}
                className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                title="查看上一条 (快捷键 ↑ 或 K)"
              >
                <span>↑</span>
              </button>
              <span className="px-1.5 text-xs font-mono text-slate-500">
                {currentIndex + 1} / {customersList.length}
              </span>
              <button
                type="button"
                disabled={currentIndex >= customersList.length - 1}
                onClick={() => onNavigate(currentIndex + 1)}
                className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                title="查看下一条 (快捷键 ↓ 或 J)"
              >
                <span>↓</span>
              </button>
            </div>

            <div className="h-4 w-px bg-slate-200" />

            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-950 truncate max-w-[260px]">{customer.name}</span>
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                  customer.operatingStatus === "推进中"
                    ? "bg-blue-100 text-blue-800"
                    : customer.operatingStatus === "已成交"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {customer.operatingStatus}
              </span>
              <span className="font-mono text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                商机：{customer.opportunityCount}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center justify-center rounded px-2 text-xs text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 transition"
            title="收起工作台 (ESC)"
          >
            关闭
          </button>
        </header>

        {/* 2. 黄金三分栏工作台 */}
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-12 min-h-0 overflow-y-auto lg:overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80">
          
          {/* 左栏：企业档案、属性、联系人矩阵 */}
          <section className="lg:col-span-3 flex flex-col bg-slate-50/60 p-5 overflow-y-auto space-y-4">
            {/* 企业核心属性卡 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-900">企业档案信息</span>
                <button
                  type="button"
                  onClick={() => setActivePanel("edit")}
                  className="text-[11px] text-blue-600 hover:underline font-normal"
                >
                  编辑
                </button>
              </div>

              <div className="space-y-2 text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">所属行业</span>
                  <span className="font-medium text-slate-900">{customer.industry || "未填写"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">所在地区</span>
                  <span className="text-slate-800">{customer.region || "未填写"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">企业规模</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                    {customer.size || "1-20"} 人
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">客户负责人</span>
                  <span className="font-semibold text-slate-900">{customer.ownerName}</span>
                </div>

                {customer.progressingStage && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">推进阶段</span>
                    <span className="font-semibold text-indigo-700">{stageLabel(customer.progressingStage)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 企业联系人矩阵卡片 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-900">
                  联系人 ({detail?.contacts.length || 0})
                </span>
                <button
                  type="button"
                  onClick={() => setActivePanel("contact")}
                  className="text-[11px] text-blue-600 hover:underline font-semibold"
                >
                  + 新增
                </button>
              </div>

              {detailLoading ? (
                <div className="py-3 text-center text-slate-400">加载联系人中...</div>
              ) : !detail?.contacts.length ? (
                <div className="text-slate-400 text-center py-2">暂无联系人</div>
              ) : (
                <div className="space-y-2.5">
                  {detail.contacts.map((c) => (
                    <div key={c.id} className="rounded border border-slate-100 bg-slate-50/70 p-2.5 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                          {c.name}
                          {c.isPrimary && (
                            <span className="rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-bold text-emerald-800">
                              主
                            </span>
                          )}
                          {c.roleTag === "DECISION_MAKER" && <span className="rounded bg-amber-50 px-1 text-[9px] font-semibold text-amber-800 border border-amber-200">决策人</span>}
                          {c.roleTag === "TECH_EVALUATOR" && <span className="rounded bg-blue-50 px-1 text-[9px] font-semibold text-blue-800 border border-blue-200">技术评估</span>}
                          {c.roleTag === "PROCUREMENT" && <span className="rounded bg-indigo-50 px-1 text-[9px] font-semibold text-indigo-800 border border-indigo-200">商务采购</span>}
                          {c.roleTag === "USER" && <span className="rounded bg-emerald-50 px-1 text-[9px] font-semibold text-emerald-800 border border-emerald-200">实际使用</span>}
                          {c.roleTag === "FINANCE" && <span className="rounded bg-violet-50 px-1 text-[9px] font-semibold text-violet-800 border border-violet-200">财务对接</span>}
                        </span>
                        <span className="text-[11px] text-slate-400">{c.title || ""}</span>
                      </div>
                      <div>
                        <MaskedPhone
                          phone={c.phone}
                          entityType="CONTACT"
                      reason="客户新建/编辑抽屉核对联系方式"
                          entityId={c.id}
                          showCopy={true}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 中栏：客户指标卡 + 原地动作录入器 + 企业全息互动时间轴 */}
          <main className="lg:col-span-6 flex flex-col p-5 overflow-y-auto space-y-5 bg-white">
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {error}
              </div>
            )}

            {/* 客户资产关键指标看板 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 shadow-2xs">
                <span className="text-[11px] text-slate-400">商机总数</span>
                <div className="mt-1 font-mono text-lg font-bold text-slate-900">
                  {customer.opportunityCount} <span className="text-xs font-normal text-slate-500">笔</span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 shadow-2xs">
                <span className="text-[11px] text-slate-400">活跃推进</span>
                <div className="mt-1 font-mono text-lg font-bold text-blue-600">
                  {customer.activeOpportunityCount} <span className="text-xs font-normal text-slate-500">笔</span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 shadow-2xs">
                <span className="text-[11px] text-slate-400">已赢单结案</span>
                <div className="mt-1 font-mono text-lg font-bold text-emerald-700">
                  {customer.wonOpportunityCount} <span className="text-xs font-normal text-slate-500">笔</span>
                </div>
              </div>
            </div>

            {/* 原地动作录入器 (Action Composer) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
                <button
                  type="button"
                  onClick={() => setActivePanel("opportunity")}
                  className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                    activePanel === "opportunity"
                      ? "bg-emerald-800 text-white shadow-2xs"
                      : "bg-emerald-700 text-white hover:bg-emerald-800"
                  }`}
                >
                  创建新商机
                </button>

                <button
                  type="button"
                  onClick={() => setActivePanel("activity")}
                  className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                    activePanel === "activity"
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "text-slate-700 hover:bg-slate-200/60"
                  }`}
                >
                  记录跟进纪要
                </button>

                <button
                  type="button"
                  onClick={() => setActivePanel("contact")}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    activePanel === "contact" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  添加联系人
                </button>

                <button
                  type="button"
                  onClick={() => setActivePanel("edit")}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    activePanel === "edit" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-200/60"
                  }`}
                >
                  编辑客户档案
                </button>
              </div>

              {/* 1. 发起新商机表单 */}
              {activePanel === "opportunity" && (
                <form onSubmit={submitOpportunity} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">商机项目名称 *</label>
                      <input
                        required
                        value={opportunityForm.name}
                        onChange={(e) => setOpportunityForm({ ...opportunityForm, name: e.target.value })}
                        placeholder="例如：产线数字化二期扩容"
                        className={inputClass()}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        预估总金额 (元) {computedProductsTotal > 0 && <span className="text-indigo-600 font-normal">· 已按选配产品自动核算</span>}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={computedProductsTotal > 0 ? (computedProductsTotal / 100).toString() : opportunityForm.expectedAmount}
                        onChange={(e) => setOpportunityForm({ ...opportunityForm, expectedAmount: e.target.value })}
                        disabled={computedProductsTotal > 0}
                        placeholder={computedProductsTotal > 0 ? "" : "例如：100000"}
                        className={`${inputClass()} ${computedProductsTotal > 0 ? "bg-indigo-50/50 font-bold text-indigo-900 font-mono" : ""}`}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">主联系人 *</label>
                      <select
                        required
                        value={opportunityForm.primaryContactId}
                        onChange={(e) => setOpportunityForm({ ...opportunityForm, primaryContactId: e.target.value })}
                        className={inputClass()}
                      >
                        {detail?.contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({isPhoneMaskingEnabled ? maskPhone(c.phone) : c.phone}) {c.title ? `· ${c.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">预计结单日期</label>
                      <input
                        type="date"
                        value={opportunityForm.expectedCloseAt}
                        onChange={(e) => setOpportunityForm({ ...opportunityForm, expectedCloseAt: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                  </div>

                  {/* 选配产品清单与智能核算模块 */}
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                          </svg>
                          <span>选配标准产品 SKU 与报价联动核算</span>
                        </span>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          选配产品后系统将自动测算预估金额，并自动通过 AI 质检“产品明细”项
                        </p>
                      </div>
                      {availableProducts.length > 0 && (
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              handleAddProduct(e.target.value);
                              e.target.value = "";
                            }
                          }}
                          defaultValue=""
                          className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-900 font-semibold shadow-2xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="" disabled>+ 添加选配产品 SKU...</option>
                          {availableProducts.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · ￥{(p.unitPrice / 100).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {selectedProducts.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-indigo-200 bg-white/60 p-3 text-center text-xs text-slate-400">
                        尚未挑选产品 SKU，可点击右上角添加，或直接在上方手动录入预估金额。
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-2xs">
                          {selectedProducts.map((sp) => {
                            const lineSubtotal = Math.round((sp.unitPrice * sp.quantity * sp.discountRate) / 100);
                            return (
                              <div key={sp.productId} className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                <div className="min-w-0 flex-1">
                                  <div className="font-semibold text-slate-900 truncate">{sp.productName}</div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    基准单价: ￥{(sp.unitPrice / 100).toLocaleString()}
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-500 text-[11px]">数量:</span>
                                    <input
                                      type="number"
                                      min="1"
                                      value={sp.quantity}
                                      onChange={(e) => handleUpdateProduct(sp.productId, Number(e.target.value), sp.discountRate)}
                                      className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-center font-mono text-xs"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-slate-500 text-[11px]">折扣%:</span>
                                    <input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={sp.discountRate}
                                      onChange={(e) => handleUpdateProduct(sp.productId, sp.quantity, Number(e.target.value))}
                                      className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-center font-mono text-xs"
                                    />
                                  </div>
                                  <div className="text-right min-w-[70px]">
                                    <span className="font-mono font-bold text-slate-950">
                                      ￥{(lineSubtotal / 100).toLocaleString()}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveProduct(sp.productId)}
                                    className="text-rose-500 hover:text-rose-700 p-1 font-bold text-xs"
                                    title="移除此产品"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex items-center justify-between pt-1 px-1 text-xs">
                          <span className="text-slate-500">
                            已选 <span className="font-bold text-slate-800">{selectedProducts.length}</span> 款产品
                          </span>
                          <div className="text-right">
                            <span className="text-slate-500 mr-2">产品核算总价:</span>
                            <span className="font-mono font-bold text-indigo-700 text-sm">
                              ￥{(computedProductsTotal / 100).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold text-slate-700">商机需求说明与交付范围</label>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {opportunityForm.demandNote.length}/500 字
                      </span>
                    </div>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={opportunityForm.demandNote}
                      onChange={(e) => setOpportunityForm({ ...opportunityForm, demandNote: e.target.value })}
                      placeholder="明确客户核心诉求、预估采购软件版本与实施交付要求 (如：对接内部 ERP、需在 Q3 前完成培训交付)..."
                      className={textareaClass()}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="submit" className={buttonClass("primary")} disabled={pending}>
                      {pending ? "创建中..." : "确认立项商机"}
                    </button>
                  </div>
                </form>
              )}

              {/* 2. 记跟进表单 */}
              {activePanel === "activity" && (
                <form onSubmit={submitActivity} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">跟进方式</label>
                      <select
                        value={activityForm.type}
                        onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value })}
                        className={inputClass()}
                      >
                        <option value="CALL">电话沟通</option>
                        <option value="MEETING">方案汇报/高层会议</option>
                        <option value="VISIT">拜访客户现场</option>
                        <option value="MESSAGE">微信/邮件</option>
                        <option value="NOTE">内部记录</option>
                      </select>
                    </div>
                    {activityForm.type !== "NOTE" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">跟进结果</label>
                        <select
                          value={activityForm.outcome}
                          onChange={(e) => setActivityForm({ ...activityForm, outcome: e.target.value })}
                          className={inputClass()}
                        >
                          <option value="CONNECTED">已接通 / 会议顺利</option>
                          <option value="INTERESTED">意向明确</option>
                          <option value="NO_ANSWER">未接通 / 暂缓</option>
                          <option value="REFUSED">明确拒绝</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">跟进纪要 *</label>
                    <textarea
                      required
                      rows={2}
                      value={activityForm.summary}
                      onChange={(e) => setActivityForm({ ...activityForm, summary: e.target.value })}
                      placeholder="记录客户拜访、企业高层沟通或业务动态纪要..."
                      className={inputClass()}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">下次跟进时间</label>
                    <input
                      type="datetime-local"
                      value={activityForm.nextFollowUpAt}
                      onChange={(e) => setActivityForm({ ...activityForm, nextFollowUpAt: e.target.value })}
                      className={inputClass()}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="submit" className={buttonClass("primary")} disabled={pending}>
                      {pending ? "保存中..." : "保存跟进"}
                    </button>
                  </div>
                </form>
              )}

              {/* 3. 添加联系人表单 */}
              {activePanel === "contact" && (
                <form onSubmit={submitContact} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">联系人姓名 *</label>
                      <input
                        required
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">手机号码 *</label>
                      <input
                        required
                        value={contactForm.phone}
                        onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">决策链角色</label>
                      <select
                        value={contactForm.roleTag}
                        onChange={(e) => setContactForm({ ...contactForm, roleTag: e.target.value as typeof contactForm.roleTag })}
                        className={inputClass()}
                      >
                        <option value="DECISION_MAKER">最终决策人 (拍板人)</option>
                        <option value="TECH_EVALUATOR">技术评估人 (架构/选型)</option>
                        <option value="PROCUREMENT">商务采购 (采购/法务)</option>
                        <option value="USER">实际使用人 (业务对接)</option>
                        <option value="FINANCE">财务对接人 (付款/对账)</option>
                        <option value="OTHER">其他协作人</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">职位头衔</label>
                      <input
                        value={contactForm.title}
                        onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })}
                        className={inputClass()}
                        placeholder="例如：技术总监 / 采购主管"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">电子邮箱</label>
                      <input
                        type="email"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isPrimaryContact"
                      checked={contactForm.isPrimary}
                      onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900"
                    />
                    <label htmlFor="isPrimaryContact" className="text-xs text-slate-700">
                      设为主联系人
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="submit" className={buttonClass("primary")} disabled={pending}>
                      {pending ? "添加中..." : "保存联系人"}
                    </button>
                  </div>
                </form>
              )}

              {/* 4. 编辑企业资料表单 */}
              {activePanel === "edit" && (
                <form onSubmit={submitEdit} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">客户类型</label>
                      <select
                        value={editForm.customerType}
                        onChange={(e) => setEditForm({ ...editForm, customerType: e.target.value as typeof editForm.customerType })}
                        className={inputClass()}
                      >
                        <option value="ENTERPRISE">单位/企业客户</option>
                        <option value="INDIVIDUAL">个人客户</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-700">
                        {editForm.customerType === "INDIVIDUAL" ? "个人客户主体全称 *" : "客户公司/单位全称 *"}
                      </label>
                      <input
                        required
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                    {editForm.customerType === "ENTERPRISE" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">所属行业</label>
                        <input
                          value={editForm.industry}
                          onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                          className={inputClass()}
                        />
                      </div>
                    )}
                    <div className={editForm.customerType === "INDIVIDUAL" ? "sm:col-span-2" : ""}>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">所在地区</label>
                      <input
                        value={editForm.region}
                        onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                        className={inputClass()}
                      />
                    </div>
                    {editForm.customerType === "ENTERPRISE" && (
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">企业规模</label>
                        <select
                          value={editForm.size}
                          onChange={(e) => setEditForm({ ...editForm, size: e.target.value })}
                          className={inputClass()}
                        >
                          <option value="1-20">1-20 人</option>
                          <option value="21-100">21-100 人</option>
                          <option value="101-500">101-500 人</option>
                          <option value="501-1000">501-1000 人</option>
                          <option value="1000+">1000+ 人</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button type="submit" className={buttonClass("primary")} disabled={pending}>
                      {pending ? "保存中..." : "保存修改"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* 客户全息动态时间轴 */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center justify-between">
                <span>客户全息互动与推进时间轴</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  共 {timeline.length} 条记录
                </span>
              </h3>

              {detailLoading ? (
                <div className="py-6 text-center text-xs text-slate-400">加载动态中...</div>
              ) : timeline.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  暂无历史互动记录。
                </div>
              ) : (
                <div className="relative pl-4 space-y-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {timeline.map((item) => {
                    const badge =
                      item.type === "LEAD_CREATED"
                        ? { label: "来源进线", bg: "bg-slate-100 text-slate-700" }
                        : item.type === "CONVERTED"
                        ? { label: "线索转化", bg: "bg-teal-100 text-teal-800" }
                        : item.type === "CALL"
                        ? { label: "电话沟通", bg: "bg-blue-100 text-blue-800" }
                        : item.type === "MEETING"
                        ? { label: "会议汇报", bg: "bg-indigo-100 text-indigo-800" }
                        : item.type === "VISIT"
                        ? { label: "上门拜访", bg: "bg-purple-100 text-purple-800" }
                        : item.type === "MESSAGE"
                        ? { label: "微信/邮件", bg: "bg-sky-100 text-sky-800" }
                        : { label: "跟进记录", bg: "bg-slate-100 text-slate-700" };
                    return (
                      <div key={item.id} className="relative">
                        <span className="absolute -left-4 top-1.5 flex h-2 w-2 rounded-full bg-slate-400" />
                        <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 text-xs shadow-2xs">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                              <span className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${badge.bg}`}>
                                {badge.label}
                              </span>
                              {item.userName}
                            </span>
                            <span className="font-mono text-slate-400">
                              {new Date(item.occurredAt).toLocaleString("zh-CN", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="mt-1.5 text-slate-700 whitespace-pre-wrap">{item.summary}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </main>

          {/* 右栏：关联商机管道列表、来源线索溯源与客户健康度 */}
          <aside className="lg:col-span-3 flex flex-col bg-slate-50/40 p-5 overflow-y-auto space-y-4">
            {/* 关联商机卡片列表 */}
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900">
                  关联商机 ({detail?.opportunities.length || 0})
                </h3>
                <button
                  type="button"
                  onClick={() => setActivePanel("opportunity")}
                  className="text-[11px] text-blue-600 hover:underline font-semibold"
                >
                  + 新增
                </button>
              </div>

              {detailLoading ? (
                <div className="py-3 text-center text-slate-400">加载商机中...</div>
              ) : !detail?.opportunities.length ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-slate-400 shadow-2xs">
                  暂无关联商机
                </div>
              ) : (
                <div className="space-y-2.5">
                  {detail.opportunities.map((opp) => (
                    <div
                      key={opp.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <Link
                          href={`/opportunities`}
                          className="font-bold text-slate-900 hover:text-blue-600 truncate max-w-[140px]"
                        >
                          {opp.name}
                        </Link>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                            opp.stage === "WON"
                              ? "bg-emerald-100 text-emerald-800"
                              : opp.stage === "LOST"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {stageLabel(opp.stage)}
                        </span>
                      </div>
                      <div className="font-mono text-slate-600 font-semibold">
                        {formatAmountInCents(opp.expectedAmount)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 来源线索 */}
            {detail?.sourceLeads && detail.sourceLeads.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-2.5 text-xs">
                <h3 className="font-bold text-slate-900 flex items-center justify-between border-b border-slate-100 pb-2">
                  <span>来源线索</span>
                  <span className="font-mono text-[11px] text-slate-400">{detail.sourceLeads.length} 条</span>
                </h3>
                <div className="space-y-2">
                  {detail.sourceLeads.map((sl) => (
                    <div key={sl.id} className="rounded-lg bg-slate-50 p-2.5 text-[11px] space-y-1.5 border border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">{sl.name}</span>
                        <Link
                          href={`/leads/${sl.id}`}
                          className="text-blue-600 hover:underline font-semibold shrink-0"
                        >
                          查看线索 ↗
                        </Link>
                      </div>
                      {sl.intendedProduct && (
                        <div className="text-slate-600 flex items-center gap-1">
                          <span className="text-slate-400">意向产品: </span>
                          <span className="font-semibold text-slate-800">{sl.intendedProduct}</span>
                        </div>
                      )}
                      {sl.note && (
                        <p className="text-slate-500 text-[10.5px] line-clamp-2 bg-white p-1.5 rounded border border-slate-100 leading-relaxed">
                          {sl.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 客户健康度诊断 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-2 text-xs">
              <h3 className="font-bold text-slate-900">
                客户健康度诊断
              </h3>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {customer.operatingStatus === "推进中"
                  ? "当前有进行中商机，客户关系处于高活跃期，请保持商务推进节奏。"
                  : customer.operatingStatus === "已成交"
                  ? "已有成功赢单交付记录，老客复购与二期增购潜力高。"
                  : "当前暂无活跃商机，建议定期回访维护客户粘性。"}
              </p>
            </div>
          </aside>
        </div>
      </aside>
    </>
  );
}
