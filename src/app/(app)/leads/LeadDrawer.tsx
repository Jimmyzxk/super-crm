"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { parseQuickFollowup } from "@/core/followup/actions";
import { convertLeadToCustomer, listCustomersAction } from "@/core/customer/actions";
import { acceptSalesInsight, dismissSalesInsight, getSalesInsights } from "@/core/insight/actions";
import type { InsightDismissReason, InsightListItem } from "@/core/insight/types";
import {
  assignLeadAction,
  discardLeadAction,
  getLeadDetailAction,
  logActivityAction,
  qualifyLeadAction,
  rescheduleTaskAction,
  updateLeadAction,
} from "./actions";
import { generateLeadOutreachPitchAction } from "@/core/ai-copilot/actions";
import type { LeadPitchScript } from "@/core/ai-copilot/types";
import { listProductsAction } from "@/core/products/actions";
import { type ProductItem, formatPricingModel } from "@/core/products/types";
import MaskedPhone from "@/core/security/MaskedPhone";
import { dateInputValue, localDateValue } from "@/core/shared/date";
import type { ActionResult, AssignableUser, Lead, LeadDetail, LeadRole } from "./types";
import { formatDate, formatDue, sourceLabel, statusLabel } from "./types";

export type DrawerPanel = "activity" | "qualify" | "assign" | "reschedule" | "discard" | "convert" | "edit" | "overview";

type Props = {
  lead: Lead | null;
  leadsList: Lead[];
  currentIndex: number;
  initialPanel?: DrawerPanel | null;
  role: LeadRole;
  users: AssignableUser[];
  onClose: () => void;
  onNavigate: (newIndex: number) => void;
  onRefresh: () => void;
  runAction: <T>(action: Promise<ActionResult<T>>, success?: () => void) => Promise<ActionResult<T> | null>;
  isAiCopilotEnabled?: boolean;
};

type ActivityForm = {
  type: string;
  outcome: string;
  summary: string;
  occurredAt: string;
  nextFollowUpAt: string;
};

type EditForm = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  companyName: string;
  title: string;
  intendedProductId: string;
  intendedProduct: string;
  budget: string;
  note: string;
};

const activityTypes = [
  ["CALL", "电话沟通"],
  ["MEETING", "方案汇报/会议"],
  ["VISIT", "客户现场拜访"],
  ["MESSAGE", "微信/邮件"],
  ["NOTE", "内部记录"],
] as const;

const outcomes = [
  ["CONNECTED", "已接通"],
  ["NO_ANSWER", "未接通"],
  ["BUSY", "占线/无人接听"],
  ["WRONG_NUMBER", "错号/空号"],
  ["REFUSED", "明确拒绝"],
  ["INTERESTED", "有意向"],
] as const;

const discardReasons = [
  ["INVALID_CONTACT", "无效联系方式"],
  ["NO_NEED", "无采购需求"],
  ["BUDGET_MISMATCH", "预算不匹配"],
  ["COMPETITOR", "竞品已签单"],
  ["DUPLICATE", "线索重复"],
  ["OTHER", "其他原因"],
] as const;

const STAGES = [
  { key: "NEW", label: "新线索" },
  { key: "CONTACTED", label: "跟进中" },
  { key: "QUALIFIED", label: "需求已确认" },
  { key: "CONVERTED", label: "已转客户" },
] as const;

const inputClass = () =>
  "min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";

const textareaClass = () =>
  "w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-2xs resize-y min-h-[96px] placeholder:text-slate-400";

const buttonClass = (variant: "primary" | "secondary" | "danger" | "text" = "secondary") => {
  if (variant === "primary") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition";
  }
  if (variant === "danger") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-red-700 disabled:opacity-50 transition";
  }
  if (variant === "text") {
    return "inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition";
  }
  return "inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs";
};

export default function LeadDrawer(props: Props) {
  if (!props.lead) return null;
  return <LeadDrawerInner key={props.lead.id} {...props} lead={props.lead} />;
}

function LeadDrawerInner({
  lead,
  leadsList,
  currentIndex,
  initialPanel,
  role,
  users,
  onClose,
  onNavigate,
  onRefresh,
  runAction,
  isAiCopilotEnabled = false,
}: Props & { lead: Lead }) {
  const isManager = role === "MANAGER" || role === "ADMIN";
  const terminal = lead.status === "CONVERTED" || lead.status === "DISCARDED";

  const [activePanel, setActivePanel] = useState<DrawerPanel>(() => {
    if (!terminal && initialPanel && initialPanel !== "overview") return initialPanel;
    return "activity";
  });

  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [insights, setInsights] = useState<InsightListItem[]>([]);
  const [loading, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outreachPitch, setOutreachPitch] = useState<LeadPitchScript | null>(null);
  const [isGeneratingPitch, setIsGeneratingPitch] = useState(false);
  const [copiedPitch, setCopiedPitch] = useState(false);
  const [pitchTab, setPitchTab] = useState<"full" | "wechatMsg" | "friendReq" | "phone">("full");
  const [appliedPitchTip, setAppliedPitchTip] = useState(false);

  function getActivePitchText(pitch: LeadPitchScript, tab: "full" | "wechatMsg" | "friendReq" | "phone"): string {
    if (tab === "friendReq") return pitch.wechatFriendRequest || pitch.fullPitch;
    if (tab === "wechatMsg") return pitch.wechatFirstMessage || pitch.fullPitch;
    if (tab === "phone") return pitch.phoneOpening || pitch.fullPitch;
    return pitch.fullPitch;
  }

  async function handleGeneratePitch() {
    setIsGeneratingPitch(true);
    const res = await generateLeadOutreachPitchAction(lead.id);
    if (res.ok) {
      setOutreachPitch(res.data);
    } else {
      setError(res.message);
    }
    setIsGeneratingPitch(false);
  }

  // Form states
  const [activityForm, setActivityForm] = useState<ActivityForm>({
    type: "CALL",
    outcome: "CONNECTED",
    summary: "",
    occurredAt: dateInputValue(new Date()),
    nextFollowUpAt: "",
  });

  const [editForm, setEditForm] = useState<EditForm>({
    contactName: lead.contactName,
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail || "",
    companyName: lead.companyName || "",
    title: lead.title || "",
    intendedProductId: lead.intendedProductId || "",
    intendedProduct: lead.intendedProduct || "",
    budget: lead.budget || "",
    note: lead.note || "",
  });

  const [qualifyNote, setQualifyNote] = useState("");
  const [assigneeId, setAssigneeId] = useState(lead.ownerUserId || "");
  const [rescheduleDue, setRescheduleDue] = useState(() =>
    lead.openTask ? dateInputValue(lead.openTask.dueAt) : "",
  );
  const [discardReason, setDiscardReason] = useState("OTHER");
  const [discardNote, setDiscardNote] = useState("");

  const [convertMode, setConvertMode] = useState<"NEW" | "EXISTING">("NEW");
  const [existingCustomers, setExistingCustomers] = useState<Array<{ id: string; name: string; customerType?: string; ownerName?: string }>>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  const [convertForm, setConvertForm] = useState({
    customerType: (lead.companyName ? "ENTERPRISE" : "INDIVIDUAL") as "ENTERPRISE" | "INDIVIDUAL",
    customerName: lead.companyName || `${lead.contactName} (个人主体)`,
    contactRoleTag: "DECISION_MAKER" as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER",
    opportunityName: `${lead.companyName || lead.contactName}-合作项目`,
    industry: "",
    region: "",
    size: "1-20" as const,
    expectedAmount: lead.budget ? lead.budget.replace(/[^0-9]/g, "") : "",
    expectedCloseAt: "",
    demandNote: lead.note || "",
  });

  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [customProductMode, setCustomProductMode] = useState(false);
  const [convertProducts, setConvertProducts] = useState<Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    pricingModel: string;
    quantity: number;
    discountRate: number;
  }>>([]);

  // Load available products for catalog quoting
  useEffect(() => {
    listProductsAction({ status: "ACTIVE" }).then((res) => {
      if (res.ok && res.data) {
        setAvailableProducts(res.data);
      }
    });
  }, []);

  const groupedAvailableProducts = useMemo(() => {
    const map: Record<string, ProductItem[]> = {};
    for (const p of availableProducts) {
      const cat = p.category || "常规产品";
      if (!map[cat]) map[cat] = [];
      map[cat].push(p);
    }
    return map;
  }, [availableProducts]);

  // Load detail & insights
  useEffect(() => {
    startTransition(async () => {
      try {
        const [detailRes, insightRes] = await Promise.all([
          getLeadDetailAction(lead.id),
          getSalesInsights({ subjectType: "lead", subjectId: lead.id }),
        ]);
        if (detailRes.ok && detailRes.data) {
          setDetail(detailRes.data);
          const currentLead = detailRes.data.lead;
          setEditForm({
            contactName: currentLead.contactName,
            contactPhone: currentLead.contactPhone,
            contactEmail: currentLead.contactEmail || "",
            companyName: currentLead.companyName || "",
            title: currentLead.title || "",
            intendedProductId: currentLead.intendedProductId || "",
            intendedProduct: currentLead.intendedProduct || "",
            budget: currentLead.budget || "",
            note: currentLead.note || "",
          });
          const numericBudget = currentLead.budget ? currentLead.budget.replace(/[^0-9]/g, "") : "";
          setConvertForm((prev) => ({
            ...prev,
            customerName: currentLead.companyName || `${currentLead.contactName}的企业`,
            opportunityName: `${currentLead.companyName || currentLead.contactName}-首单项目`,
            expectedAmount: numericBudget || prev.expectedAmount,
            demandNote: currentLead.note || "",
          }));
        }
        if (insightRes.ok && insightRes.data) {
          setInsights(insightRes.data);
        }
      } catch {
        // Fallback
      }
    });
  }, [lead.id]);

  useEffect(() => {
    let ignore = false;
    if (activePanel === "convert" && existingCustomers.length === 0) {
      startTransition(async () => {
        setLoadingCustomers(true);
        try {
          const res = await listCustomersAction();
          if (!ignore && res.ok && res.data) {
            const list = res.data.items.map((c) => ({
              id: c.id,
              name: c.name,
              customerType: c.customerType,
              ownerName: c.ownerName,
            }));
            setExistingCustomers(list);
            if (lead.companyName) {
              const matched = list.find((c) => c.name.toLowerCase() === lead.companyName!.toLowerCase());
              if (matched) {
                setSelectedCustomerId(matched.id);
              }
            }
          }
        } finally {
          if (!ignore) setLoadingCustomers(false);
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [activePanel, existingCustomers.length, lead.companyName]);

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
        if (currentIndex < leadsList.length - 1) {
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
  }, [currentIndex, leadsList.length, onNavigate, onClose]);

  // Actions
  async function submitActivity(e: FormEvent) {
    e.preventDefault();
    if (!activityForm.summary.trim()) {
      setError("请填写跟进纪要");
      return;
    }
    setError(null);
    setPending(true);
    await runAction(
      logActivityAction({
        leadId: lead.id,
        type: activityForm.type,
        outcome: activityForm.type === "NOTE" ? undefined : activityForm.outcome,
        summary: activityForm.summary.trim(),
        occurredAt: new Date(activityForm.occurredAt),
        nextFollowUpAt: activityForm.nextFollowUpAt ? new Date(activityForm.nextFollowUpAt) : undefined,
      }),
      () => {
        setActivityForm({
          type: "CALL",
          outcome: "CONNECTED",
          summary: "",
          occurredAt: dateInputValue(new Date()),
          nextFollowUpAt: "",
        });
        onRefresh();
      },
    );
    setPending(false);
  }

  async function submitQualify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    await runAction(qualifyLeadAction({ leadId: lead.id, note: qualifyNote.trim() || undefined }), () => {
      setActivePanel("convert");
      onRefresh();
    });
    setPending(false);
  }

  const handleAddConvertProduct = (prodId: string) => {
    const prod = availableProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setConvertProducts((prev) => {
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

  const handleRemoveConvertProduct = (prodId: string) => {
    setConvertProducts((prev) => prev.filter((p) => p.productId !== prodId));
  };

  const handleUpdateConvertProduct = (prodId: string, quantity: number, discountRate: number) => {
    setConvertProducts((prev) =>
      prev.map((p) =>
        p.productId === prodId
          ? { ...p, quantity: Math.max(1, quantity), discountRate: Math.min(100, Math.max(1, discountRate)) }
          : p,
      ),
    );
  };

  const computedConvertProductsTotal = convertProducts.reduce(
    (sum, p) => sum + Math.round((p.unitPrice * p.quantity * p.discountRate) / 100),
    0,
  );

  async function submitConvert(e: FormEvent) {
    e.preventDefault();
    if (convertMode === "EXISTING") {
      if (!selectedCustomerId) {
        setError("请选择要关联的已有客户档案");
        return;
      }
      if (!convertForm.opportunityName.trim()) {
        setError("请填写立项商机名称");
        return;
      }
    } else {
      if (!convertForm.customerName.trim() || !convertForm.opportunityName.trim()) {
        setError("请填写完整的客户名称与商机名称");
        return;
      }
    }
    setError(null);
    setPending(true);
    const totalAmountInCents =
      computedConvertProductsTotal > 0
        ? computedConvertProductsTotal
        : convertForm.expectedAmount
        ? Math.round(Number(convertForm.expectedAmount) * 100)
        : undefined;
    const selectedCust = existingCustomers.find((c) => c.id === selectedCustomerId);

    const lineItems = convertProducts.map((p) => ({
      productId: p.productId,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      discountRate: p.discountRate,
    }));

    const res = await convertLeadToCustomer({
      leadId: lead.id,
      linkToExistingCustomerId: convertMode === "EXISTING" ? selectedCustomerId : undefined,
      customerType: convertMode === "NEW" ? convertForm.customerType : undefined,
      customerName: convertMode === "EXISTING" ? (selectedCust?.name || convertForm.customerName.trim()) : convertForm.customerName.trim(),
      industry: convertMode === "NEW" && convertForm.customerType === "ENTERPRISE" ? (convertForm.industry.trim() || undefined) : undefined,
      region: convertMode === "NEW" ? (convertForm.region.trim() || undefined) : undefined,
      size: convertMode === "NEW" && convertForm.customerType === "ENTERPRISE" ? convertForm.size : undefined,
      contactName: lead.contactName,
      contactPhone: lead.contactPhone,
      contactEmail: lead.contactEmail || undefined,
      contactTitle: lead.title || undefined,
      contactRoleTag: convertForm.contactRoleTag,
      opportunityName: convertForm.opportunityName.trim(),
      expectedAmount: totalAmountInCents,
      expectedCloseAt: convertForm.expectedCloseAt ? new Date(convertForm.expectedCloseAt) : undefined,
      demandNote: convertForm.demandNote.trim() || "线索转化立项",
      lineItems: lineItems.length > 0 ? lineItems : undefined,
    });
    if (res.ok) {
      setConvertProducts([]);
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitAssign(e: FormEvent) {
    e.preventDefault();
    if (!assigneeId) return;
    setError(null);
    setPending(true);
    await runAction(assignLeadAction({ leadId: lead.id, assigneeUserId: assigneeId }), () => {
      onRefresh();
    });
    setPending(false);
  }

  async function submitReschedule(e: FormEvent) {
    e.preventDefault();
    if (!lead.openTask || !rescheduleDue) return;
    setError(null);
    setPending(true);
    await runAction(rescheduleTaskAction({ taskId: lead.openTask.id, dueAt: new Date(rescheduleDue) }), () => {
      onRefresh();
    });
    setPending(false);
  }

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    await runAction(
      updateLeadAction({
        leadId: lead.id,
        contactName: editForm.contactName.trim(),
        contactPhone: editForm.contactPhone.trim(),
        contactEmail: editForm.contactEmail.trim() || null,
        companyName: editForm.companyName.trim() || null,
        title: editForm.title.trim() || null,
        intendedProductId: editForm.intendedProductId.trim() || null,
        intendedProduct: editForm.intendedProduct.trim() || null,
        budget: editForm.budget.trim() || null,
        note: editForm.note.trim() || null,
      }),
      () => {
        onRefresh();
      },
    );
    setPending(false);
  }

  async function submitDiscard(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    await runAction(discardLeadAction({ leadId: lead.id, reason: discardReason, note: discardNote.trim() || undefined }), () => {
      onRefresh();
    });
    setPending(false);
  }

  async function handleAcceptInsight(insight: InsightListItem) {
    setError(null);
    setPending(true);
    try {
      const due = insight.suggestedDueAt ? new Date(insight.suggestedDueAt) : new Date(Date.now() + 24 * 3600 * 1000);
      const res = await acceptSalesInsight({ insightId: insight.id, dueAt: due });
      if (res.ok) {
        setInsights((prev) => prev.filter((i) => i.id !== insight.id));
        onRefresh();
      } else {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDismissInsight(insightId: string) {
    setError(null);
    setPending(true);
    try {
      const res = await dismissSalesInsight({ insightId, reason: "NOT_APPLICABLE" as InsightDismissReason });
      if (res.ok) {
        setInsights((prev) => prev.filter((i) => i.id !== insightId));
        onRefresh();
      } else {
        setError(res.message);
      }
    } finally {
      setPending(false);
    }
  }

  const due = lead.openTask ? formatDue(lead.openTask.dueAt) : null;
  const canConvert = lead.status === "QUALIFIED" && Boolean(lead.ownerUserId);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-950/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`线索全景工作台 - ${lead.contactName}`}
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
                {currentIndex + 1} / {leadsList.length}
              </span>
              <button
                type="button"
                disabled={currentIndex >= leadsList.length - 1}
                onClick={() => onNavigate(currentIndex + 1)}
                className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-30"
                title="查看下一条 (快捷键 ↓ 或 J)"
              >
                <span>↓</span>
              </button>
            </div>

            <div className="h-4 w-px bg-slate-200" />

            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-950">{lead.contactName}</span>
              {lead.companyName && (
                <span className="text-xs text-slate-500 font-medium">· {lead.companyName}</span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                lead.status === "CONVERTED"
                  ? "bg-teal-100 text-teal-800"
                  : lead.status === "QUALIFIED"
                  ? "bg-emerald-100 text-emerald-800"
                  : lead.status === "CONTACTED"
                  ? "bg-blue-100 text-blue-800"
                  : lead.status === "DISCARDED"
                  ? "bg-slate-200 text-slate-600"
                  : "bg-amber-100 text-amber-800"
              }`}>
                {statusLabel(lead.status)}
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
          
          {/* 左栏：核心档案、属性矩阵、联系方式 */}
          <section className="lg:col-span-3 flex flex-col bg-slate-50/60 p-5 overflow-y-auto space-y-4">
            {/* 意向评分卡 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">意向度评分</span>
                <span className={`font-mono text-base font-bold px-2 py-0.5 rounded ${
                  (lead.score ?? 0) >= 80
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : (lead.score ?? 0) >= 60
                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                    : "bg-slate-100 text-slate-600"
                }`}>
                  {lead.score ?? 0} <span className="text-[10px] font-normal text-slate-400">/100</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {lead.scoreReason || "系统已基于企业规模与行业匹配度完成基础评分。"}
              </p>
            </div>

            {/* 核心联系方式与属性卡 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-3 text-xs">
              <h3 className="font-bold text-slate-900 text-xs border-b border-slate-100 pb-2 flex items-center justify-between">
                <span>线索属性</span>
                <button
                  type="button"
                  onClick={() => setActivePanel("edit")}
                  className="text-[11px] text-blue-600 hover:underline font-normal"
                >
                  编辑
                </button>
              </h3>

              <div className="space-y-2 text-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">联系电话</span>
                  <MaskedPhone
                    phone={lead.contactPhone}
                    entityType="LEAD"
                      reason="线索跟进抽屉电话联络"
                    entityId={lead.id}
                    showCopy={true}
                  />
                </div>

                {lead.contactEmail && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">电子邮箱</span>
                    <a href={`mailto:${lead.contactEmail}`} className="text-blue-600 hover:underline truncate max-w-[140px]">
                      {lead.contactEmail}
                    </a>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">所属企业</span>
                  <span className="font-medium text-slate-900 truncate max-w-[140px]">
                    {lead.companyName || "未填写"}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">职位头衔</span>
                  <span className="text-slate-800">{lead.title || "未填写"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">来源渠道</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {sourceLabel(lead.source)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">负责人</span>
                  <span className="font-semibold text-slate-900">{lead.ownerName || "公海未分配"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">录入时间</span>
                  <span className="text-slate-500 font-mono text-[11px]">{formatDate(lead.createdAt)}</span>
                </div>
              </div>
            </div>

            {/* 客户意向产品与业务诉求卡 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-900">产品意向</span>
                  {lead.status === "QUALIFIED" || lead.status === "CONVERTED" ? (
                    <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 text-[10px] font-semibold">
                      已核实
                    </span>
                  ) : (
                    <span className="rounded bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 text-[10px] font-medium">
                      待核实
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActivePanel("edit")}
                  className="text-[11px] text-blue-600 hover:underline font-normal cursor-pointer"
                >
                  编辑
                </button>
              </div>

              <div className="space-y-2.5 text-slate-700">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">意向产品</span>
                  {lead.intendedProduct ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-2.5 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {lead.intendedProductCategory && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100/80 text-blue-800 font-semibold">
                            {lead.intendedProductCategory}
                          </span>
                        )}
                        <span className="font-bold text-blue-950 text-xs">{lead.intendedProduct}</span>
                        {lead.intendedProductCode && (
                          <span className="text-[10px] text-blue-600/80 font-mono">({lead.intendedProductCode})</span>
                        )}
                      </div>
                      {(lead.intendedProductUnitPrice != null || lead.intendedProductPricingModel) && (
                        <div className="text-[11px] text-slate-600 flex items-center gap-2 pt-0.5">
                          <span>标准单价:</span>
                          <span className="font-mono font-semibold text-slate-900">
                            ¥{((lead.intendedProductUnitPrice || 0) / 100).toLocaleString()}
                          </span>
                          {lead.intendedProductUnit && <span className="text-slate-500">/ {lead.intendedProductUnit}</span>}
                          {lead.intendedProductPricingModel && (
                            <span className="text-[10px] text-slate-400">({formatPricingModel(lead.intendedProductPricingModel)})</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">未录入</span>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-100/80">
                  <span className="text-slate-400">预估预算</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {lead.budget || "待确认"}
                  </span>
                </div>

                <div className="pt-1 border-t border-slate-100/80">
                  <span className="text-slate-400 block mb-1">需求描述</span>
                  {lead.note ? (
                    <p className="text-slate-800 bg-slate-50 p-2.5 rounded-md border border-slate-100 whitespace-pre-wrap leading-relaxed text-[11px]">
                      {lead.note}
                    </p>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">暂无需求说明</span>
                  )}
                </div>
              </div>
            </div>

            {/* AI 拓客初次触达首响话术（仅在开启 AI 功能时显示） */}
            {isAiCopilotEnabled && (
              <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-blue-50/50 p-4 shadow-sm space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-950 flex items-center gap-1.5 text-xs">
                    <svg className="w-4 h-4 text-indigo-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>AI 拓客首响触达话术</span>
                  </span>
                  {outreachPitch && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const text = getActivePitchText(outreachPitch, pitchTab);
                          navigator.clipboard.writeText(text);
                          setCopiedPitch(true);
                          setTimeout(() => setCopiedPitch(false), 2000);
                        }}
                        className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 transition"
                      >
                        {copiedPitch ? "已复制" : "复制当前话术"}
                      </button>
                    </div>
                  )}
                </div>

                {!outreachPitch ? (
                  <div className="space-y-2">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      基于客户行业、线索来源与业务诉求，自动生成无套路、高回复率的专属破冰文案（支持企微微信首发、加微验证与电话开场）。
                    </p>
                    <button
                      type="button"
                      disabled={isGeneratingPitch}
                      onClick={handleGeneratePitch}
                      className="w-full py-2 px-3 rounded-lg bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-60"
                    >
                      {isGeneratingPitch ? (
                        <>
                          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span>正在结合企业背景智能生成...</span>
                        </>
                      ) : (
                        <span>一键生成定制首响触达文案</span>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* 场景切换 Tab */}
                    <div className="flex rounded-lg bg-indigo-100/70 p-0.5 text-[11px] font-medium">
                      <button
                        type="button"
                        onClick={() => setPitchTab("full")}
                        className={`flex-1 py-1 rounded-md transition ${
                          pitchTab === "full" ? "bg-white text-indigo-950 font-bold shadow-2xs" : "text-indigo-700 hover:text-indigo-950"
                        }`}
                      >
                        推荐全文
                      </button>
                      <button
                        type="button"
                        onClick={() => setPitchTab("wechatMsg")}
                        className={`flex-1 py-1 rounded-md transition ${
                          pitchTab === "wechatMsg" ? "bg-white text-indigo-950 font-bold shadow-2xs" : "text-indigo-700 hover:text-indigo-950"
                        }`}
                      >
                        企微首发
                      </button>
                      <button
                        type="button"
                        onClick={() => setPitchTab("friendReq")}
                        className={`flex-1 py-1 rounded-md transition ${
                          pitchTab === "friendReq" ? "bg-white text-indigo-950 font-bold shadow-2xs" : "text-indigo-700 hover:text-indigo-950"
                        }`}
                      >
                        加微验证
                      </button>
                      <button
                        type="button"
                        onClick={() => setPitchTab("phone")}
                        className={`flex-1 py-1 rounded-md transition ${
                          pitchTab === "phone" ? "bg-white text-indigo-950 font-bold shadow-2xs" : "text-indigo-700 hover:text-indigo-950"
                        }`}
                      >
                        电话开场
                      </button>
                    </div>

                    {/* 文案展示区 */}
                    <div className="relative group">
                      <div className="text-xs text-slate-800 bg-white p-3 rounded-lg border border-indigo-100 whitespace-pre-wrap leading-relaxed shadow-2xs font-normal max-h-48 overflow-y-auto">
                        {getActivePitchText(outreachPitch, pitchTab)}
                      </div>
                    </div>

                    {/* 底部操作条：一键填入跟进 + 重新生成 */}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          const text = getActivePitchText(outreachPitch, pitchTab);
                          setActivePanel("activity");
                          setActivityForm((prev) => ({
                            ...prev,
                            type: pitchTab === "phone" ? "CALL" : "MESSAGE",
                            summary: text,
                          }));
                          setAppliedPitchTip(true);
                          setTimeout(() => setAppliedPitchTip(false), 3000);
                        }}
                        className="inline-flex h-7 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 shadow-xs gap-1.5 transition active:scale-95"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>一键填入跟进记录</span>
                      </button>

                      <button
                        type="button"
                        disabled={isGeneratingPitch}
                        onClick={handleGeneratePitch}
                        className="text-[11px] text-slate-400 hover:text-slate-700 underline font-medium transition"
                      >
                        {isGeneratingPitch ? "生成中..." : "换一批/重新生成"}
                      </button>
                    </div>

                    {appliedPitchTip && (
                      <div className="p-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5 animate-fadeIn">
                        <span>✅ 已将触达话术填入跟进纪要，可在中栏直接提交！</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 待办 SLA 警示 */}
            {due && (
              <div className={`rounded-lg border p-3.5 text-xs shadow-2xs ${
                due.overdue ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">下一步待办</span>
                  <button
                    type="button"
                    onClick={() => setActivePanel("reschedule")}
                    className="text-[11px] underline font-medium"
                  >
                    改约
                  </button>
                </div>
                <p className="mt-1 font-semibold">{due.label}</p>
              </div>
            )}

            {/* 重复预警卡片 */}
            {lead.isPossibleDuplicate && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 shadow-2xs">
                <span className="font-bold">发现疑似重复线索</span>
                <p className="mt-1 text-[11px] text-amber-800">
                  库中存在相同电话或相似企业档案，可与负责人核对后合并。
                </p>
              </div>
            )}
          </section>

          {/* 中栏：阶段步进条 + 原地动作录入器 + 动态时间轴 */}
          <main className="lg:col-span-6 flex flex-col p-5 overflow-y-auto space-y-5 bg-white">
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {error}
              </div>
            )}

            {/* 阶段推进 Chevron 步进条 */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 shadow-2xs">
              <div className="flex items-center gap-1.5">
                {STAGES.map((s, idx) => {
                  const isCurrent = lead.status === s.key;
                  const currentIdx = STAGES.findIndex((item) => item.key === lead.status);
                  const isPassed = currentIdx > idx;

                  return (
                    <div
                      key={s.key}
                      className={`flex-1 py-1.5 px-2 rounded text-center text-xs font-semibold transition ${
                        isCurrent
                          ? "bg-slate-900 text-white shadow-xs"
                          : isPassed
                          ? "bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium"
                          : "bg-white border border-slate-200/80 text-slate-400"
                      }`}
                    >
                      <div className="text-[10px] opacity-70 font-normal">第 {idx + 1} 步</div>
                      <div>{s.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 原地动作录入器 (Action Composer) */}
            {!terminal ? (
              !lead.ownerUserId ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-4 shadow-2xs space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-950 font-bold text-xs">该线索当前处于公海池（未分配责任人）</span>
                  </div>
                  <p className="text-xs text-blue-900 leading-relaxed">
                    根据销售数据管理规范，公海线索严禁直接记录跟进或立项商机。请先从公海认领为个人负责线索（或由主管指派责任人）后，方可开展后续跟进与商机立项。
                  </p>
                  <div className="pt-1">
                    {isManager ? (
                      <form onSubmit={submitAssign} className="flex flex-wrap items-center gap-2">
                        <select
                          required
                          value={assigneeId}
                          onChange={(e) => setAssigneeId(e.target.value)}
                          className="h-8 rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-800 outline-none"
                        >
                          <option value="">选择指派的销售专员...</option>
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ({u.role})
                            </option>
                          ))}
                        </select>
                        <button type="submit" className={buttonClass("primary")} disabled={pending || !assigneeId}>
                          {pending ? "指派中..." : "确认指派责任人"}
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={async () => {
                          setError(null);
                          setPending(true);
                          await runAction(assignLeadAction({ leadId: lead.id }), () => {
                            onRefresh();
                          });
                          setPending(false);
                        }}
                        className="inline-flex h-8 items-center justify-center rounded-md bg-blue-600 px-3.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-xs transition disabled:opacity-50"
                      >
                        {pending ? "认领中..." : "立即从公海认领"}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 shadow-2xs space-y-3">
                  {/* Tab 切换栏 */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-2">
                    <button
                      type="button"
                      onClick={() => setActivePanel("activity")}
                      className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                        activePanel === "activity"
                          ? "bg-slate-900 text-white shadow-2xs"
                          : "text-slate-600 hover:bg-slate-200/60"
                      }`}
                    >
                      记录跟进
                    </button>

                  {lead.status === "CONTACTED" && (
                    <button
                      type="button"
                      onClick={() => setActivePanel("qualify")}
                      className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                        activePanel === "qualify"
                          ? "bg-slate-900 text-white shadow-2xs"
                          : "text-indigo-700 hover:bg-indigo-50"
                      }`}
                    >
                      确认需求
                    </button>
                  )}

                  {canConvert && (
                    <button
                      type="button"
                      onClick={() => setActivePanel("convert")}
                      className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                        activePanel === "convert"
                          ? "bg-emerald-800 text-white shadow-2xs"
                          : "bg-emerald-700 text-white hover:bg-emerald-800"
                      }`}
                    >
                      转客户立项
                    </button>
                  )}

                  {isManager && (
                    <button
                      type="button"
                      onClick={() => setActivePanel("assign")}
                      className={`rounded px-2.5 py-1 text-xs font-bold transition ${
                        activePanel === "assign"
                          ? "bg-slate-900 text-white shadow-2xs"
                          : "text-slate-600 hover:bg-slate-200/60"
                      }`}
                    >
                      指派负责人
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setActivePanel("discard")}
                    className={`ml-auto rounded px-2 py-1 text-xs font-medium transition ${
                      activePanel === "discard" ? "bg-red-600 text-white" : "text-red-600 hover:bg-red-50"
                    }`}
                  >
                    退回公海 / 放弃
                  </button>
                </div>

                {/* 1. 记跟进表单 */}
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
                          {activityTypes.map(([val, label]) => (
                            <option key={val} value={val}>
                              {label}
                            </option>
                          ))}
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
                            {outcomes.map(([val, label]) => (
                              <option key={val} value={val}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-700">跟进纪要 / 客户反馈 *</label>
                        <div className="flex items-center gap-2">
                          {outreachPitch && (
                            <button
                              type="button"
                              onClick={() => {
                                const text = getActivePitchText(outreachPitch, pitchTab);
                                setActivityForm((prev) => ({
                                  ...prev,
                                  type: pitchTab === "phone" ? "CALL" : "MESSAGE",
                                  summary: text,
                                }));
                                setAppliedPitchTip(true);
                                setTimeout(() => setAppliedPitchTip(false), 2500);
                              }}
                              className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200 transition"
                            >
                              引用 AI 触达话术
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={async () => {
                              if (!activityForm.summary.trim()) return;
                              const res = await parseQuickFollowup({ text: activityForm.summary });
                              if (res.ok && res.data) {
                                setActivityForm((prev) => ({
                                  ...prev,
                                  type: res.data.suggestedType || prev.type,
                                  outcome: res.data.suggestedOutcome || prev.outcome,
                                  summary: res.data.cleanSummary || prev.summary,
                                  nextFollowUpAt: res.data.suggestedNextFollowUpAt
                                    ? dateInputValue(res.data.suggestedNextFollowUpAt)
                                    : prev.nextFollowUpAt,
                                }));
                              }
                            }}
                            className="text-[11px] font-semibold text-slate-600 hover:text-slate-900"
                          >
                            智能提炼
                          </button>
                        </div>
                      </div>
                      <textarea
                        required
                        rows={3}
                        value={activityForm.summary}
                        onChange={(e) => setActivityForm({ ...activityForm, summary: e.target.value })}
                        placeholder="输入沟通核心进展、客户意向与后续安排，或点击上方【引用 AI 触达话术】..."
                        className={inputClass()}
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">发生时间</label>
                        <input
                          type="datetime-local"
                          value={activityForm.occurredAt}
                          onChange={(e) => setActivityForm({ ...activityForm, occurredAt: e.target.value })}
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
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button type="submit" className={buttonClass("primary")} disabled={pending}>
                        {pending ? "保存中..." : "保存跟进记录"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 2. 需求合格确认表单 */}
                {activePanel === "qualify" && (
                  <form onSubmit={submitQualify} className="space-y-3">
                    <p className="text-xs text-slate-600 leading-relaxed">
                      已核实客户真实业务需求与采购意向，确认后即可转为正式客户并立项首单商机。
                    </p>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-slate-700">需求确认要点 *</label>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {qualifyNote.length}/500 字
                        </span>
                      </div>
                      <textarea
                        required
                        rows={3}
                        maxLength={500}
                        value={qualifyNote}
                        onChange={(e) => setQualifyNote(e.target.value)}
                        placeholder="记录客户明确的业务痛点、采购意向、预算范围与期望交付节点..."
                        className={textareaClass()}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="submit" className={buttonClass("primary")} disabled={pending}>
                        {pending ? "提交中..." : "确认需求"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 3. 转客户立项商机表单 */}
                {activePanel === "convert" && (
                  <form onSubmit={submitConvert} className="space-y-4">
                    {/* 模式选择：新建客户主体 vs 关联已有客户 */}
                    <div className="flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setConvertMode("NEW")}
                        className={`flex-1 rounded py-1 font-semibold transition ${
                          convertMode === "NEW"
                            ? "bg-white text-slate-900 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        新建客户主体
                      </button>
                      <button
                        type="button"
                        onClick={() => setConvertMode("EXISTING")}
                        className={`flex-1 rounded py-1 font-semibold transition ${
                          convertMode === "EXISTING"
                            ? "bg-white text-slate-900 shadow-xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        关联至已有客户
                      </button>
                    </div>

                    {convertMode === "NEW" ? (
                      <div className="rounded-lg border border-teal-200 bg-teal-50/40 p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-teal-950">
                            1. 建立正式客户档案
                          </span>
                          {/* 客户类型切换器 */}
                          <div className="inline-flex rounded-md border border-teal-300 bg-white p-0.5 text-xs shadow-2xs">
                            <button
                              type="button"
                              onClick={() => setConvertForm((prev) => ({
                                ...prev,
                                customerType: "ENTERPRISE",
                                customerName: lead.companyName || `${lead.contactName}的企业`,
                              }))}
                              className={`rounded px-2.5 py-0.5 font-semibold transition ${
                                convertForm.customerType === "ENTERPRISE"
                                  ? "bg-teal-800 text-white shadow-xs"
                                  : "text-teal-900 hover:bg-teal-50"
                              }`}
                            >
                              单位客户
                            </button>
                            <button
                              type="button"
                              onClick={() => setConvertForm((prev) => ({
                                ...prev,
                                customerType: "INDIVIDUAL",
                                customerName: `${lead.contactName} (个人客户)`,
                              }))}
                              className={`rounded px-2.5 py-0.5 font-semibold transition ${
                                convertForm.customerType === "INDIVIDUAL"
                                  ? "bg-teal-800 text-white shadow-xs"
                                  : "text-teal-900 hover:bg-teal-50"
                              }`}
                            >
                              个人客户
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-xs font-semibold text-slate-700">
                              {convertForm.customerType === "ENTERPRISE" ? "企业名称 *" : "客户名称 *"}
                            </label>
                            <input
                              required
                              value={convertForm.customerName}
                              onChange={(e) => setConvertForm({ ...convertForm, customerName: e.target.value })}
                              placeholder={convertForm.customerType === "ENTERPRISE" ? "如：北京科技有限公司" : "如：张总 (个人客户)"}
                              className={inputClass()}
                            />
                          </div>

                          {convertForm.customerType === "ENTERPRISE" && (
                            <>
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">所属行业</label>
                                <input
                                  value={convertForm.industry}
                                  onChange={(e) => setConvertForm({ ...convertForm, industry: e.target.value })}
                                  placeholder="如：智能制造 / 医疗"
                                  className={inputClass()}
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">企业规模</label>
                                <select
                                  value={convertForm.size}
                                  onChange={(e) => setConvertForm({ ...convertForm, size: e.target.value as typeof convertForm.size })}
                                  className={inputClass()}
                                >
                                  <option value="1-20">1-20 人</option>
                                  <option value="21-100">21-100 人</option>
                                  <option value="101-500">101-500 人</option>
                                  <option value="501-1000">501-1000 人</option>
                                  <option value="1000+">1000+ 人</option>
                                </select>
                              </div>
                            </>
                          )}

                          <div className={convertForm.customerType === "INDIVIDUAL" ? "sm:col-span-2" : ""}>
                            <label className="mb-1 block text-xs font-semibold text-slate-700">所在地区</label>
                            <input
                              value={convertForm.region}
                              onChange={(e) => setConvertForm({ ...convertForm, region: e.target.value })}
                              placeholder="如：华东 / 上海"
                              className={inputClass()}
                            />
                          </div>

                          {/* 联系人决策链角色选择 */}
                          <div className={convertForm.customerType === "INDIVIDUAL" ? "sm:col-span-2" : ""}>
                            <label className="mb-1 block text-xs font-semibold text-slate-700">决策链角色</label>
                            <select
                              value={convertForm.contactRoleTag}
                              onChange={(e) => setConvertForm({ ...convertForm, contactRoleTag: e.target.value as typeof convertForm.contactRoleTag })}
                              className={inputClass()}
                            >
                              <option value="DECISION_MAKER">最终决策人</option>
                              <option value="TECH_EVALUATOR">技术评估人</option>
                              <option value="PROCUREMENT">商务采购</option>
                              <option value="USER">业务使用人</option>
                              <option value="FINANCE">财务对接</option>
                              <option value="OTHER">其他</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3.5 space-y-3">
                        <div className="text-xs font-bold text-purple-950">
                          1. 关联已有客户
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">选择客户 *</label>
                          {loadingCustomers ? (
                            <div className="text-xs text-slate-500 py-2">加载客户列表中...</div>
                          ) : (
                            <select
                              required
                              value={selectedCustomerId}
                              onChange={(e) => setSelectedCustomerId(e.target.value)}
                              className={inputClass()}
                            >
                              <option value="">请选择要关联的已有客户...</option>
                              {existingCustomers.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name} {c.customerType === "INDIVIDUAL" ? "[个人客户]" : "[单位客户]"} ({c.ownerName || "已分配"})
                                </option>
                              ))}
                            </select>
                          )}
                          <p className="mt-1 text-[11px] text-slate-500">
                            线索联系人「{lead.contactName} ({lead.contactPhone})」将作为新联系人自动追加至该客户名下。
                          </p>
                          {(() => {
                            const sel = existingCustomers.find((c) => c.id === selectedCustomerId);
                            if (!sel) return null;
                            const oppOwner = sel.ownerName || "已分配";
                            const leadOwner = lead.ownerName || lead.ownerUserId;
                            // 归属将转移时必须显式提示：商机归属客户负责人（原销售优先），
                            // 不是当前线索跟进人——管理员代操作时尤其容易意外易主
                            return oppOwner && leadOwner && sel.ownerName !== leadOwner ? (
                              <p className="mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed">
                                注意：新商机将归属该客户负责人「{oppOwner}」，而非当前线索跟进人「{leadOwner}」（客户归属优先保持原销售）。
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] text-slate-400">
                                新商机将归属该客户负责人「{oppOwner}」。
                              </p>
                            );
                          })()}
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">决策链角色</label>
                          <select
                            value={convertForm.contactRoleTag}
                            onChange={(e) => setConvertForm({ ...convertForm, contactRoleTag: e.target.value as typeof convertForm.contactRoleTag })}
                            className={inputClass()}
                          >
                            <option value="DECISION_MAKER">最终决策人</option>
                            <option value="TECH_EVALUATOR">技术评估人</option>
                            <option value="PROCUREMENT">商务采购</option>
                            <option value="USER">业务使用人</option>
                            <option value="FINANCE">财务对接</option>
                            <option value="OTHER">其他</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3.5 space-y-3">
                      <div className="text-xs font-bold text-blue-950">
                        2. 商机信息
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">商机名称 *</label>
                          <input
                            required
                            value={convertForm.opportunityName}
                            onChange={(e) => setConvertForm({ ...convertForm, opportunityName: e.target.value })}
                            className={inputClass()}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">
                            预估金额 (元) {computedConvertProductsTotal > 0 && <span className="text-blue-600 font-normal">· 已按选配产品自动计算</span>}
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={computedConvertProductsTotal > 0 ? (computedConvertProductsTotal / 100).toString() : convertForm.expectedAmount}
                            onChange={(e) => setConvertForm({ ...convertForm, expectedAmount: e.target.value })}
                            disabled={computedConvertProductsTotal > 0}
                            placeholder={computedConvertProductsTotal > 0 ? "" : "例如：50000"}
                            className={`${inputClass()} ${computedConvertProductsTotal > 0 ? "bg-blue-50/50 font-bold text-blue-900 font-mono" : ""}`}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-semibold text-slate-700">预计成单日期</label>
                          <input
                            type="date"
                            min={localDateValue(new Date())}
                            value={convertForm.expectedCloseAt}
                            onChange={(e) => setConvertForm({ ...convertForm, expectedCloseAt: e.target.value })}
                            className={inputClass()}
                          />
                        </div>

                        {/* 产品明细选择与配置区 */}
                        <div className="sm:col-span-2 space-y-2 pt-1 border-t border-blue-200/60">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-blue-950">
                                选配产品明细
                              </span>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                选择产品将自动计算预估金额
                              </p>
                            </div>
                            {availableProducts.length > 0 && (
                              <select
                                onChange={(e) => {
                                  if (e.target.value) {
                                    handleAddConvertProduct(e.target.value);
                                    e.target.value = "";
                                  }
                                }}
                                defaultValue=""
                                className="rounded-lg border border-blue-200 bg-white px-2.5 py-1 text-xs text-blue-900 font-semibold shadow-2xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="" disabled>+ 添加产品...</option>
                                {availableProducts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} · ￥{(p.unitPrice / 100).toLocaleString()}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>

                          {convertProducts.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/30 p-2.5 text-center text-xs text-slate-400">
                              暂未添加产品明细，可从产品库选择或手动输入金额。
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-2xs">
                                {convertProducts.map((cp) => {
                                  const lineSubtotal = Math.round((cp.unitPrice * cp.quantity * cp.discountRate) / 100);
                                  return (
                                    <div key={cp.productId} className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                      <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-slate-900 truncate">{cp.productName}</div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                          基准单价: ￥{(cp.unitPrice / 100).toLocaleString()}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3 shrink-0">
                                        <div className="flex items-center gap-1">
                                          <span className="text-slate-500 text-[11px]">数量:</span>
                                          <input
                                            type="number"
                                            min="1"
                                            value={cp.quantity}
                                            onChange={(e) => handleUpdateConvertProduct(cp.productId, Number(e.target.value), cp.discountRate)}
                                            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-center font-mono text-xs"
                                          />
                                        </div>
                                        <div className="flex items-center gap-1">
                                          <span className="text-slate-500 text-[11px]">折扣%:</span>
                                          <input
                                            type="number"
                                            min="1"
                                            max="100"
                                            value={cp.discountRate}
                                            onChange={(e) => handleUpdateConvertProduct(cp.productId, cp.quantity, Number(e.target.value))}
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
                                          onClick={() => handleRemoveConvertProduct(cp.productId)}
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
                                  已选 <span className="font-bold text-slate-800">{convertProducts.length}</span> 款产品
                                </span>
                                <div className="text-right">
                                  <span className="text-slate-500 mr-2">产品核算总价:</span>
                                  <span className="font-mono font-bold text-blue-700 text-sm">
                                    ￥{(computedConvertProductsTotal / 100).toLocaleString()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="sm:col-span-2">
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold text-slate-700">需求说明</label>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {convertForm.demandNote.length}/500 字
                            </span>
                          </div>
                          <textarea
                            rows={3}
                            maxLength={500}
                            value={convertForm.demandNote}
                            onChange={(e) => setConvertForm({ ...convertForm, demandNote: e.target.value })}
                            placeholder="记录转化商机立项的核心业务诉求、预期交付范围与特殊条款约定..."
                            className={textareaClass()}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button type="submit" className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-700 px-4 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50 transition" disabled={pending}>
                        {pending ? "转化中..." : convertMode === "EXISTING" ? "关联至客户并立项新商机" : "转为正式客户并立项商机"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 4. 派单表单 */}
                {activePanel === "assign" && (
                  <form onSubmit={submitAssign} className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">指派跟进负责人 *</label>
                      <select
                        value={assigneeId}
                        onChange={(e) => setAssigneeId(e.target.value)}
                        className={inputClass()}
                      >
                        <option value="">请选择负责人</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="submit" className={buttonClass("primary")} disabled={pending}>
                        {pending ? "指派中..." : "确认派单"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 5. 放弃表单 */}
                {activePanel === "discard" && (
                  <form onSubmit={submitDiscard} className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">放弃原因 *</label>
                      <select
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                        className={inputClass()}
                      >
                        {discardReasons.map(([val, label]) => (
                          <option key={val} value={val}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">放弃说明</label>
                      <textarea
                        rows={2}
                        value={discardNote}
                        onChange={(e) => setDiscardNote(e.target.value)}
                        className={inputClass()}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="submit" className={buttonClass("danger")} disabled={pending}>
                        {pending ? "提交中..." : "确认放弃此线索"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 6. 编辑资料 */}
                {activePanel === "edit" && (
                  <form onSubmit={submitEdit} className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">联系人姓名 *</label>
                        <input
                          required
                          value={editForm.contactName}
                          onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                          className={inputClass()}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">联系电话 *</label>
                        <input
                          required
                          value={editForm.contactPhone}
                          onChange={(e) => setEditForm({ ...editForm, contactPhone: e.target.value })}
                          className={inputClass()}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">所属企业</label>
                        <input
                          value={editForm.companyName}
                          onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                          className={inputClass()}
                          placeholder="企业全称或品牌名"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">职位头衔</label>
                        <input
                          value={editForm.title}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className={inputClass()}
                          placeholder="例如：采购总监 / CTO"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">电子邮箱</label>
                        <input
                          type="email"
                          value={editForm.contactEmail}
                          onChange={(e) => setEditForm({ ...editForm, contactEmail: e.target.value })}
                          className={inputClass()}
                          placeholder="name@company.com"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">预估采购预算</label>
                        <input
                          value={editForm.budget}
                          onChange={(e) => setEditForm({ ...editForm, budget: e.target.value })}
                          className={inputClass()}
                          placeholder="例如：10-20万 / 50000"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-semibold text-slate-700">意向产品 (基于产品配置)</label>
                        <div className="space-y-1.5">
                          {availableProducts.length > 0 ? (
                            <>
                              <select
                                value={customProductMode ? "__CUSTOM__" : editForm.intendedProductId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val === "__CUSTOM__") {
                                    setCustomProductMode(true);
                                    setEditForm({ ...editForm, intendedProductId: "", intendedProduct: "" });
                                  } else if (val === "") {
                                    setCustomProductMode(false);
                                    setEditForm({ ...editForm, intendedProductId: "", intendedProduct: "" });
                                  } else {
                                    setCustomProductMode(false);
                                    const p = availableProducts.find((item) => item.id === val);
                                    if (p) {
                                      setEditForm({
                                        ...editForm,
                                        intendedProductId: p.id,
                                        intendedProduct: p.name,
                                        budget: editForm.budget || (p.unitPrice ? `¥${(p.unitPrice / 100).toLocaleString()}` : editForm.budget),
                                      });
                                    }
                                  }
                                }}
                                className={inputClass()}
                              >
                                <option value="">-- 请选择配置库中的意向产品 --</option>
                                {Object.entries(groupedAvailableProducts).map(([category, prods]) => (
                                  <optgroup key={category} label={category}>
                                    {prods.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name} ({p.code}) · ¥{(p.unitPrice / 100).toLocaleString()}/{p.unit} [{formatPricingModel(p.pricingModel)}]
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                                <option value="__CUSTOM__">＋ 手动输入其他非标/定制产品需求...</option>
                              </select>

                              {customProductMode && (
                                <input
                                  autoFocus
                                  value={editForm.intendedProduct}
                                  onChange={(e) => setEditForm({ ...editForm, intendedProductId: "", intendedProduct: e.target.value })}
                                  className={inputClass()}
                                  placeholder="请输入定制或非标产品需求名称..."
                                />
                              )}
                            </>
                          ) : (
                            <div className="space-y-1">
                              <input
                                value={editForm.intendedProduct}
                                onChange={(e) => setEditForm({ ...editForm, intendedProductId: "", intendedProduct: e.target.value })}
                                className={inputClass()}
                                placeholder="例如：企业旗舰版 / 私有化部署"
                              />
                              <p className="text-[10px] text-slate-400">
                                当前系统尚未配置产品库，可在「产品配置」中添加标准产品目录。
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-semibold text-slate-700">业务诉求与痛点描述</label>
                        <textarea
                          rows={3}
                          value={editForm.note}
                          onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                          className={textareaClass()}
                          placeholder="明确客户的业务诉求、核心痛点、系统对接要求或排期预期..."
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setActivePanel("overview")} className={buttonClass()}>
                        取消
                      </button>
                      <button type="submit" className={buttonClass("primary")} disabled={pending}>
                        {pending ? "保存中..." : "保存修改"}
                      </button>
                    </div>
                  </form>
                )}

                {/* 7. 改约 */}
                {activePanel === "reschedule" && (
                  <form onSubmit={submitReschedule} className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">新待办截止时间 *</label>
                      <input
                        required
                        type="datetime-local"
                        value={rescheduleDue}
                        onChange={(e) => setRescheduleDue(e.target.value)}
                        className={inputClass()}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button type="submit" className={buttonClass("primary")} disabled={pending}>
                        {pending ? "提交中..." : "确认改约"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )
          ) : (
              lead.status === "CONVERTED" || detail?.convertedCustomer ? (
                <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/70 via-emerald-50/30 to-white p-4 shadow-2xs space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-100 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-600 text-white font-bold text-xs">
                        已转客户
                      </span>
                      <span className="text-xs text-slate-600 font-medium">已生成关联客户与商机</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detail?.convertedCustomer && (
                      <div className="rounded-lg border border-teal-200 bg-white p-3 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400 text-[11px]">
                          <span className="font-semibold">关联客户</span>
                          <span className="text-[10.5px] px-1.5 py-0.2 rounded bg-teal-50 text-teal-700 font-medium">客户池</span>
                        </div>
                        <div className="font-bold text-slate-900 text-xs truncate">
                          {detail.convertedCustomer.name}
                        </div>
                        <div className="pt-1">
                          <Link
                            href={`/customers/${detail.convertedCustomer.id}`}
                            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-semibold"
                          >
                            <span>查看客户档案</span>
                            <span>→</span>
                          </Link>
                        </div>
                      </div>
                    )}

                    {detail?.convertedOpportunity && (
                      <div className="rounded-lg border border-emerald-200 bg-white p-3 space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400 text-[11px]">
                          <span className="font-semibold">关联商机</span>
                          <span className="text-[10.5px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium">商机看板</span>
                        </div>
                        <div className="font-bold text-slate-900 text-xs truncate">
                          {detail.convertedOpportunity.name}
                        </div>
                        <div className="pt-1">
                          <Link
                            href={`/opportunities/${detail.convertedOpportunity.id}`}
                            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
                          >
                            <span>查看商机详情</span>
                            <span>→</span>
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 shadow-2xs">
                  <span className="font-semibold text-slate-600">该线索已放弃归档。</span>
                </div>
              )
            )}

            {/* 全息互动时间轴 */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center justify-between">
                <span>互动与推进时间轴</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  共 {detail?.activities?.length || 0} 条记录
                </span>
              </h3>

              {loading ? (
                <div className="py-6 text-center text-xs text-slate-400">加载动态中...</div>
              ) : !detail?.activities?.length ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  暂无历史跟进记录。
                </div>
              ) : (
                <div className="relative pl-4 space-y-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {detail.activities.map((act) => (
                    <div key={act.id} className="relative">
                      <span className="absolute -left-4 top-1.5 flex h-2 w-2 rounded-full bg-slate-400" />
                      <div className="rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 text-xs shadow-2xs">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-900">
                            {act.userName} 记录了 {act.type === "CALL" ? "电话沟通" : "跟进纪要"}
                          </span>
                          <span className="font-mono text-slate-400">{formatDate(act.occurredAt)}</span>
                        </div>
                        <p className="mt-1 text-slate-700 whitespace-pre-wrap">{act.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* 右栏：AI销售教练质检、智能建议与推荐打法 */}
          <aside className="lg:col-span-3 flex flex-col bg-slate-50/40 p-5 overflow-y-auto space-y-4">
            {/* AI 销售教练洞察建议卡 */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                AI 销售教练质检 ({insights.length})
              </h3>

              {insights.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-xs text-slate-500 shadow-2xs">
                  <span className="text-emerald-700 font-semibold">推进节奏良好</span>
                  <p className="text-[11px] text-slate-400 mt-1">暂无超时或停滞风险预警。</p>
                </div>
              ) : (
                insights.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-indigo-200/80 bg-indigo-50/40 p-3.5 text-xs text-slate-800 shadow-2xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-indigo-950 flex items-center gap-1">
                        <span className="rounded bg-indigo-200 px-1 py-0.2 text-[10px] text-indigo-900 font-bold">
                          {item.severity === "HIGH_RISK" ? "高风险" : "建议"}
                        </span>
                        {item.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{item.summary}</p>
                    {item.suggestedAction && (
                      <p className="text-[11px] font-semibold text-indigo-900">
                        建议动作：{item.suggestedAction}
                      </p>
                    )}
                    {!terminal && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={() => handleAcceptInsight(item)}
                          disabled={pending}
                          className="rounded bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 shadow-2xs"
                        >
                          采纳建待办
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDismissInsight(item.id)}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                        >
                          忽略
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 销售打法推荐 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs space-y-2 text-xs">
              <h3 className="font-bold text-slate-900">
                推荐转化打法
              </h3>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                针对 {(lead.score ?? 0) >= 80 ? "高分优质线索" : "常规线索"}：建议在首次建联时明确其决策链、预算周期与核心痛点，并在 24 小时内完成首通电话。
              </p>
            </div>
          </aside>
        </div>
      </aside>
    </>
  );
}
