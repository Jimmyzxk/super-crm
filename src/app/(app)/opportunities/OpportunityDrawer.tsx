"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  advanceStage,
  getOpportunityDetail,
  getOpportunityTimeline,
  loseOpportunity,
  revertStage,
  transferOpportunity,
  updateOpportunity,
  winOpportunity,
} from "@/core/opportunity/actions";
import { getAssignableUsers } from "@/core/leads/actions";
import { logActivity, rescheduleTask } from "@/core/followup/actions";
import { acceptSalesInsight, dismissSalesInsight, getSalesInsights } from "@/core/insight/actions";
import {
  listDealInterventionsAction,
  requestManagerInterventionAction,
  resolveManagerInterventionAction,
} from "@/core/collaboration/actions";
import type { DealInterventionItem, InterventionType } from "@/core/collaboration/types";
import type { InsightDismissReason, InsightListItem } from "@/core/insight/types";
import type { OpportunityDetail, OpportunityList, OpportunityStage } from "@/core/opportunity/types";
import { activeStages, lostReasons } from "@/core/opportunity/types";
import { formatAmountInCents, stageLabel } from "@/core/shared/display";
import { dateInputValue, formatDateOnly, localDateValue, parseLocalDate, parseLocalDateTime } from "@/core/shared/date";
import OpportunityLineItemsSection from "./OpportunityLineItemsSection";
import DealCopilotPanel from "./DealCopilotPanel";
import MaskedPhone from "@/core/security/MaskedPhone";

export type OpportunityItem = OpportunityList["items"][number];
export type OpportunityDrawerPanel =
  | "advance"
  | "win"
  | "activity"
  | "revert"
  | "reschedule"
  | "edit"
  | "lost"
  | "overview"
  | "intervention"
  | "transfer";

interface Props {
  opportunity: OpportunityItem | null;
  opportunitiesList: OpportunityItem[];
  currentIndex: number;
  initialPanel?: OpportunityDrawerPanel;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onRefresh: () => void;
  isAiCopilotEnabled?: boolean;
  canTransfer?: boolean;
  assignableUsers?: Array<{ id: string; name: string; role?: string }>;
}

const inputClass = () =>
  "min-h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900";

const textareaClass = () =>
  "w-full rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-2xs resize-y min-h-[84px] placeholder:text-slate-400";

const buttonClass = (variant: "primary" | "secondary" | "danger" = "secondary") => {
  if (variant === "primary") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition";
  }
  if (variant === "danger") {
    return "inline-flex h-8 items-center justify-center rounded-md bg-red-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-red-700 disabled:opacity-50 transition";
  }
  return "inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition shadow-2xs";
};

const STAGES: Array<{ key: OpportunityStage; label: string; slaDays: number }> = [
  { key: "DISCOVERY", label: "需求确认", slaDays: 7 },
  { key: "PROPOSAL", label: "方案报价", slaDays: 14 },
  { key: "NEGOTIATION", label: "商务谈判", slaDays: 14 },
];

export default function OpportunityDrawer(props: Props) {
  if (!props.opportunity) return null;
  return <OpportunityDrawerInner key={props.opportunity.id} {...props} opportunity={props.opportunity} />;
}

function OpportunityDrawerInner({
  opportunity,
  opportunitiesList,
  currentIndex,
  initialPanel,
  onClose,
  onNavigate,
  onRefresh,
  isAiCopilotEnabled = false,
  canTransfer = false,
  assignableUsers = [],
}: Props & { opportunity: OpportunityItem }) {
  const terminal = opportunity.stage === "WON" || opportunity.stage === "LOST";
  const [activePanel, setActivePanel] = useState<OpportunityDrawerPanel>(() => {
    if (!terminal && initialPanel && initialPanel !== "overview") return initialPanel;
    return opportunity.stage === "NEGOTIATION" ? "win" : "advance";
  });

  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [stageHistory, setStageHistory] = useState<OpportunityDetail["stageHistory"]>([]);
  const [activities, setActivities] = useState<OpportunityDetail["activities"]>([]);
  const [insights, setInsights] = useState<InsightListItem[]>([]);
  const [detailLoading, startDetailTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"workbench" | "overview">("workbench");

  // Form states
  const [advanceNote, setAdvanceNote] = useState("");
  const [revertNote, setRevertNote] = useState("");
  const [winAmount, setWinAmount] = useState(() =>
    opportunity.expectedAmount ? (Number(opportunity.expectedAmount) / 100).toString() : "",
  );
  const [winDate, setWinDate] = useState(() => localDateValue(new Date()));
  const [lostReason, setLostReason] = useState<(typeof lostReasons)[number]>("PRICE");
  const [lostNote, setLostNote] = useState("");
  const [activityForm, setActivityForm] = useState<{
    type: "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
    outcome: "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED";
    summary: string;
    nextFollowUpAt: string;
  }>({
    type: "CALL",
    outcome: "CONNECTED",
    summary: "",
    nextFollowUpAt: "",
  });
  const [editForm, setEditForm] = useState({
    name: opportunity.name,
    expectedAmount: opportunity.expectedAmount ? (Number(opportunity.expectedAmount) / 100).toString() : "",
    expectedCloseAt: opportunity.expectedCloseAt ? opportunity.expectedCloseAt.slice(0, 10) : "",
    demandNote: "",
  });
  const [rescheduleDueAt, setRescheduleDueAt] = useState(() =>
    opportunity.openTaskDueAt ? dateInputValue(new Date(opportunity.openTaskDueAt)) : "",
  );

  // 商机转移状态
  const [transferUsers, setTransferUsers] = useState<Array<{ id: string; name: string; role?: string }>>(assignableUsers);
  const [transferSearchQuery, setTransferSearchQuery] = useState("");
  const [transferToUserId, setTransferToUserId] = useState("");
  const [transferReason, setTransferReason] = useState("MULTI_PRODUCT_COLLAB");
  const [transferNote, setTransferNote] = useState("");

  useEffect(() => {
    if (canTransfer && assignableUsers.length === 0) {
      getAssignableUsers().then((res) => {
        if (res.ok && res.data) setTransferUsers(res.data);
      });
    }
  }, [canTransfer, assignableUsers]);

  // 主管协同介入状态
  const [interventions, setInterventions] = useState<DealInterventionItem[]>([]);
  const [interventionType, setInterventionType] = useState<InterventionType>("STRATEGY_COACHING");
  const [interventionNote, setInterventionNote] = useState("");
  const [resolvingInterventionId, setResolvingInterventionId] = useState<string | null>(null);
  const [managerFeedback, setManagerFeedback] = useState("");
  const [coachingNotes, setCoachingNotes] = useState("");

  async function submitTransfer(e: FormEvent) {
    e.preventDefault();
    if (pending || !transferToUserId) return;
    setPending(true);
    setError(null);
    const res = await transferOpportunity({
      opportunityId: opportunity.id,
      toOwnerUserId: transferToUserId,
      reason: transferReason,
      note: transferNote.trim() || undefined,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.message);
    } else {
      onRefresh();
    }
  }

  // Load detail, timeline, insights & interventions
  useEffect(() => {
    startDetailTransition(async () => {
      try {
        const [detailRes, timelineRes, insightRes, interventionRes] = await Promise.all([
          getOpportunityDetail(opportunity.id),
          getOpportunityTimeline(opportunity.id, 50),
          getSalesInsights({ subjectType: "opportunity", subjectId: opportunity.id }),
          listDealInterventionsAction({ opportunityId: opportunity.id }),
        ]);
        if (detailRes.ok && detailRes.data) {
          setDetail(detailRes.data);
          setEditForm({
            name: detailRes.data.opportunity.name,
            expectedAmount: detailRes.data.opportunity.expectedAmount
              ? (Number(detailRes.data.opportunity.expectedAmount) / 100).toString()
              : "",
            expectedCloseAt: detailRes.data.opportunity.expectedCloseAt
              ? detailRes.data.opportunity.expectedCloseAt.slice(0, 10)
              : "",
            demandNote: detailRes.data.opportunity.demandNote || "",
          });
        }
        if (timelineRes.ok && timelineRes.data) {
          setStageHistory(timelineRes.data.stageHistory);
          setActivities(timelineRes.data.activities);
        }
        if (insightRes.ok && insightRes.data) {
          setInsights(insightRes.data);
        }
        if (interventionRes.ok && interventionRes.data) {
          setInterventions(interventionRes.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载商机档案与时间线失败，请重试");
      }
    });
  }, [opportunity.id]);

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
        if (currentIndex < opportunitiesList.length - 1) {
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
  }, [currentIndex, opportunitiesList.length, onNavigate, onClose]);

  const nextStage = activeStages[activeStages.indexOf(opportunity.stage as (typeof activeStages)[number]) + 1] as
    | OpportunityStage
    | undefined;
  const prevStage = activeStages[activeStages.indexOf(opportunity.stage as (typeof activeStages)[number]) - 1] as
    | OpportunityStage
    | undefined;

  async function submitAdvance(e: FormEvent) {
    e.preventDefault();
    if (!nextStage) return;
    setError(null);
    setPending(true);
    const res = await advanceStage({
      opportunityId: opportunity.id,
      fromStage: opportunity.stage as (typeof activeStages)[number],
      toStage: nextStage,
      note: advanceNote.trim() || undefined,
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitRevert(e: FormEvent) {
    e.preventDefault();
    if (!prevStage) return;
    setError(null);
    setPending(true);
    const res = await revertStage({
      opportunityId: opportunity.id,
      fromStage: opportunity.stage as (typeof activeStages)[number],
      toStage: prevStage,
      note: revertNote.trim() || undefined,
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitWin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountInCents = Math.round(Number(winAmount) * 100);
    if (!Number.isSafeInteger(amountInCents) || amountInCents < 0) {
      setError("成交金额必须是非负数值");
      return;
    }
    setPending(true);
    const res = await winOpportunity({
      opportunityId: opportunity.id,
      actualAmount: amountInCents,
      actualCloseAt: parseLocalDate(winDate),
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitLost(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await loseOpportunity({
      opportunityId: opportunity.id,
      reason: lostReason,
      note: lostNote.trim() || undefined,
    });
    if (res.ok) {
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
      opportunityId: opportunity.id,
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

  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountInCents = editForm.expectedAmount ? Math.round(Number(editForm.expectedAmount) * 100) : undefined;
    setPending(true);
    const res = await updateOpportunity({
      opportunityId: opportunity.id,
      name: editForm.name.trim(),
      expectedAmount: amountInCents,
      expectedCloseAt: editForm.expectedCloseAt ? new Date(editForm.expectedCloseAt) : undefined,
      demandNote: editForm.demandNote.trim() || undefined,
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitReschedule(e: FormEvent) {
    e.preventDefault();
    if (!opportunity.openTaskId || !rescheduleDueAt) return;
    setError(null);
    setPending(true);
    const res = await rescheduleTask({
      taskId: opportunity.openTaskId,
      dueAt: new Date(rescheduleDueAt),
    });
    if (res.ok) {
      onRefresh();
    } else {
      setError(res.message);
    }
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
  async function submitRequestIntervention(e: FormEvent) {
    e.preventDefault();
    if (!interventionNote.trim()) {
      setError("请填写协同诉求与推进卡点");
      return;
    }
    setError(null);
    setPending(true);
    const res = await requestManagerInterventionAction({
      opportunityId: opportunity.id,
      interventionType,
      requestNote: interventionNote.trim(),
    });
    if (res.ok) {
      setInterventionNote("");
      const listRes = await listDealInterventionsAction({ opportunityId: opportunity.id });
      if (listRes.ok) setInterventions(listRes.data);
      onRefresh();
    } else {
      setError(res.message);
    }
    setPending(false);
  }

  async function submitResolveIntervention(interventionId: string, status: "RESOLVED" | "REJECTED") {
    if (!managerFeedback.trim()) {
      setError("请填写主管指导意见或批复结论");
      return;
    }
    setError(null);
    setPending(true);
    const res = await resolveManagerInterventionAction({
      interventionId,
      status,
      managerFeedback: managerFeedback.trim(),
      coachingNotes: coachingNotes.trim() || undefined,
    });
    if (res.ok) {
      setResolvingInterventionId(null);
      setManagerFeedback("");
      setCoachingNotes("");
      const listRes = await listDealInterventionsAction({ opportunityId: opportunity.id });
      if (listRes.ok) setInterventions(listRes.data);
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
        aria-label={`商机全景工作台 - ${opportunity.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-5xl xl:max-w-6xl 2xl:max-w-[1240px] flex-col border-l border-slate-200 bg-white shadow-2xl transition-all duration-300 ease-out"
      >
        {/* 1. 顶部上下文导航栏 */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/90 bg-slate-50/95 px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            {/* 上下翻页导航 */}
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
              <button
                type="button"
                disabled={currentIndex <= 0}
                onClick={() => onNavigate(currentIndex - 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition"
                title="查看上一条 (快捷键 ↑ 或 K)"
              >
                <span>↑</span>
              </button>
              <span className="px-2 text-xs font-mono text-slate-500 font-medium">
                {currentIndex + 1} / {opportunitiesList.length}
              </span>
              <button
                type="button"
                disabled={currentIndex >= opportunitiesList.length - 1}
                onClick={() => onNavigate(currentIndex + 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition"
                title="查看下一条 (快捷键 ↓ 或 J)"
              >
                <span>↓</span>
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200" />

            {/* 商机核心标题与客户 */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-slate-950 truncate max-w-sm sm:max-w-md">
                  {opportunity.name}
                </h2>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${
                  opportunity.stage === "WON"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : opportunity.stage === "LOST"
                    ? "bg-slate-100 text-slate-600 border border-slate-200"
                    : "bg-blue-50 text-blue-700 border border-blue-200"
                }`}>
                  {stageLabel(opportunity.stage)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <Link
                  href="/customers"
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12l6 4.5V21" />
                  </svg>
                  <span>{opportunity.customerName}</span>
                </Link>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500">负责人: <strong className="text-slate-700 font-semibold">{opportunity.ownerName}</strong></span>
              </div>
            </div>
          </div>

          {/* 右侧核心商务数值与操作 */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-3">
              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">预估金额</div>
                <div className="font-mono font-bold text-slate-950 text-sm">
                  {formatAmountInCents(opportunity.expectedAmount)}
                </div>
              </div>

              <div className="h-6 w-px bg-slate-200" />

              <div className="text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">预计结单</div>
                <div className="font-mono text-xs text-slate-700 font-semibold">
                  {opportunity.expectedCloseAt ? formatDateOnly(opportunity.expectedCloseAt) : "未设置"}
                </div>
              </div>
            </div>

            {/* 中小屏幕视图切换器 */}
            <div className="flex xl:hidden rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewTab("workbench")}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition ${
                  viewTab === "workbench"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                推进工作台
              </button>
              <button
                type="button"
                onClick={() => setViewTab("overview")}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition ${
                  viewTab === "overview"
                    ? "bg-white text-slate-900 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                画像与质检
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-2xs transition"
              title="收起工作台 (ESC)"
            >
              关闭
            </button>
          </div>
        </header>

        {/* 2. 现代响应式宽幅工作台 */}
        <div className="grid flex-1 grid-cols-1 xl:grid-cols-12 min-h-0 overflow-hidden divide-y xl:divide-y-0 xl:divide-x divide-slate-200/80">
          
          {/* 主栏 (67% 宽屏占比)：阶段步进条 + 原地动作录入器 + 报价商品 + 商务谈判全息动态 */}
          <main className={`xl:col-span-8 flex flex-col p-5 sm:p-6 overflow-y-auto min-h-0 h-full pb-24 space-y-6 bg-white ${viewTab !== "workbench" ? "hidden xl:flex" : "flex"}`}>
            {error && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {error}
              </div>
            )}

            {/* 阶段步进与推进动作中枢 (一体化设计：消除双层嵌套灰框，比例舒适自然) */}
            {!terminal ? (
              <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
                {/* 1. Chevron 阶段流转里程碑 */}
                <div className="border-b border-slate-100 bg-slate-50/70 p-3.5">
                  <div className="flex items-center justify-between text-[11px] mb-2 px-1 text-slate-500">
                    <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                      </svg>
                      <span>商机生命周期阶段</span>
                    </span>
                    <span className="font-mono text-slate-400">当前处于：{stageLabel(opportunity.stage)} 阶段</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {STAGES.map((s, idx) => {
                      const isCurrent = opportunity.stage === s.key;
                      const currentStageIndex = (activeStages as readonly string[]).includes(opportunity.stage)
                        ? (activeStages as readonly string[]).indexOf(opportunity.stage)
                        : opportunity.stage === "WON"
                        ? 99
                        : -1;
                      const stageIndex = (activeStages as readonly string[]).indexOf(s.key);
                      const isPassed = currentStageIndex > stageIndex;

                      return (
                        <div
                          key={s.key}
                          className={`flex-1 py-2 px-3 rounded-lg text-center transition-all ${
                            isCurrent
                              ? "bg-slate-900 text-white shadow-xs font-semibold"
                              : isPassed
                              ? "bg-emerald-50 text-emerald-800 border border-emerald-200/90 font-medium"
                              : "bg-white border border-slate-200/80 text-slate-400"
                          }`}
                        >
                          <div className="text-[10px] opacity-70 font-mono">第 {idx + 1} 阶段</div>
                          <div className="text-xs font-semibold mt-0.5">{s.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 动作快捷切换栏 (区分核心动作与异常/辅助操作) */}
                <div className="border-b border-slate-100 bg-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-400 mr-1">推进操作:</span>
                    {opportunity.stage === "NEGOTIATION" ? (
                      <button
                        type="button"
                        onClick={() => setActivePanel("win")}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
                          activePanel === "win"
                            ? "bg-emerald-700 text-white border-emerald-700 shadow-xs"
                            : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200 shadow-2xs"
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.25h13.5v1.986m-2.48 5.228A6.003 6.003 0 0021.666 4.756c-.962-.203-1.934-.377-2.916-.52v.264c0 2.108-.966 3.99-2.48 5.228m0 0a7.5 7.5 0 01-5.007 1.892 7.5 7.5 0 01-5.007-1.892" />
                        </svg>
                        <span>确认赢单</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setActivePanel("advance")}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
                          activePanel === "advance"
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "text-slate-700 bg-white hover:bg-slate-50 border-slate-200 shadow-2xs"
                        }`}
                      >
                        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        <span>推进阶段</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setActivePanel("activity")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
                        activePanel === "activity"
                          ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                          : "text-slate-700 bg-white hover:bg-slate-50 border-slate-200 shadow-2xs"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                      <span>写跟进</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActivePanel("intervention")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition border ${
                        activePanel === "intervention"
                          ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                          : "text-amber-800 bg-amber-50/80 hover:bg-amber-100 border-amber-200 shadow-2xs"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <span>申请协同</span>
                      {interventions.filter((i) => i.status === "REQUESTED").length > 0 && (
                        <span className="rounded-full bg-red-600 text-white text-[9px] px-1 font-mono font-bold">
                          {interventions.filter((i) => i.status === "REQUESTED").length}
                        </span>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-slate-400 mr-0.5">流转处理:</span>
                    {prevStage && (
                      <button
                        type="button"
                        onClick={() => setActivePanel("revert")}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition border ${
                          activePanel === "revert"
                            ? "bg-amber-700 text-white border-amber-700 shadow-xs"
                            : "bg-white text-amber-800 border-amber-200/90 hover:bg-amber-50 shadow-2xs"
                        }`}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                        <span>回退阶段</span>
                      </button>
                    )}
                    {opportunity.openTaskId && (
                      <button
                        type="button"
                        onClick={() => setActivePanel("reschedule")}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition border ${
                          activePanel === "reschedule"
                            ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-2xs"
                        }`}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                        </svg>
                        <span>调整改期</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActivePanel("lost")}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition border ${
                        activePanel === "lost"
                          ? "bg-rose-700 text-white border-rose-700 shadow-xs"
                          : "bg-white text-rose-700 border-rose-200 hover:bg-rose-50 shadow-2xs"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span>输单归档</span>
                    </button>
                    {canTransfer && !terminal && (
                      <button
                        type="button"
                        onClick={() => setActivePanel("transfer")}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition border ${
                          activePanel === "transfer"
                            ? "bg-indigo-700 text-white border-indigo-700 shadow-xs"
                            : "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50 shadow-2xs"
                        }`}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                        </svg>
                        <span>转移归属</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 3. 动作录入表单区 */}
                <div className="p-4 bg-slate-50/40">
                  {/* 1. 推进阶段表单 */}
                  {activePanel === "advance" && (
                    <form onSubmit={submitAdvance} className="space-y-3.5">
                      <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </span>
                          <span className="font-semibold text-indigo-950">
                            正在操作：推进商机阶段 →「{stageLabel(nextStage || "")}」
                          </span>
                        </div>
                        <span className="text-[11px] text-indigo-700">记录商务共识与推进依据</span>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          推进依据与共识说明
                        </label>
                        <textarea
                          rows={3}
                          value={advanceNote}
                          onChange={(e) => setAdvanceNote(e.target.value)}
                          placeholder="例如：方案已获业务部门认可，预算已通过审批，下一步进行合同商务条款确认..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-slate-400">
                          将同步更新阶段分析与 SLA 时效
                        </span>
                        <button type="submit" className={buttonClass("primary")} disabled={pending}>
                          {pending ? "推进中..." : `确认推进至 ${stageLabel(nextStage || "")}`}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 2. 确认赢单结案表单 */}
                  {activePanel === "win" && (
                    <form onSubmit={submitWin} className="space-y-3.5">
                      <div className="rounded-lg bg-emerald-50/70 border border-emerald-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          </span>
                          <span className="font-semibold text-emerald-950">
                            正在操作：确认赢单结案 (Won)
                          </span>
                        </div>
                        <span className="text-[11px] text-emerald-800">将计入销售业绩并沉淀复盘案例</span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">实际成交金额 (元) *</label>
                          <input
                            required
                            type="number"
                            min="0"
                            value={winAmount}
                            onChange={(e) => setWinAmount(e.target.value)}
                            className={inputClass()}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">结单日期 *</label>
                          <input
                            required
                            type="date"
                            value={winDate}
                            onChange={(e) => setWinDate(e.target.value)}
                            className={inputClass()}
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button type="submit" className={buttonClass("primary")} disabled={pending}>
                          {pending ? "保存中..." : "确认赢单结案"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 3. 记跟进表单 */}
                  {activePanel === "activity" && (
                    <form onSubmit={submitActivity} className="space-y-3.5">
                      <div className="rounded-lg bg-slate-100/80 border border-slate-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </span>
                          <span className="font-semibold text-slate-900">
                            正在操作：录入商机跟进纪要
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">记录最新商机沟通情况与下一步行动</span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">跟进方式 *</label>
                          <select
                            value={activityForm.type}
                            onChange={(e) => setActivityForm({ ...activityForm, type: e.target.value as typeof activityForm.type })}
                            className={inputClass()}
                          >
                            <option value="CALL">电话沟通</option>
                            <option value="MEETING">会议洽谈</option>
                            <option value="VISIT">现场拜访</option>
                            <option value="MESSAGE">企微/微信</option>
                            <option value="NOTE">内部记录</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">跟进结果 *</label>
                          <select
                            value={activityForm.outcome}
                            onChange={(e) => setActivityForm({ ...activityForm, outcome: e.target.value as typeof activityForm.outcome })}
                            className={inputClass()}
                          >
                            <option value="INTERESTED">意向明确</option>
                            <option value="CONNECTED">正常沟通</option>
                            <option value="NO_ANSWER">未接通/未回复</option>
                            <option value="REFUSED">明确拒绝</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">跟进纪要 *</label>
                        <textarea
                          required
                          rows={3}
                          value={activityForm.summary}
                          onChange={(e) => setActivityForm({ ...activityForm, summary: e.target.value })}
                          placeholder="记录沟通内容、客户关注重点与下一步行动..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 items-end">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">下次跟进时间 (选填)</label>
                          <input
                            type="datetime-local"
                            value={activityForm.nextFollowUpAt}
                            onChange={(e) => setActivityForm({ ...activityForm, nextFollowUpAt: e.target.value })}
                            className={inputClass()}
                          />
                        </div>
                        <div className="flex justify-end">
                          <button type="submit" className={buttonClass("primary")} disabled={pending}>
                            {pending ? "保存中..." : "保存跟进记录"}
                          </button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* 4. 阶段回退表单 */}
                  {activePanel === "revert" && (
                    <form onSubmit={submitRevert} className="space-y-3.5">
                      <div className="rounded-lg bg-amber-50/70 border border-amber-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-600 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                            </svg>
                          </span>
                          <span className="font-semibold text-amber-950">
                            正在操作：回退商机阶段 ←「{stageLabel(prevStage || "")}」
                          </span>
                        </div>
                        <span className="text-[11px] text-amber-800">请注明回退原因与整改计划</span>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          回退原因说明 *
                        </label>
                        <textarea
                          required
                          rows={3}
                          value={revertNote}
                          onChange={(e) => setRevertNote(e.target.value)}
                          placeholder="说明阶段回退原因（如方案需调整、条款重审等）..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button type="submit" className={buttonClass("primary")} disabled={pending}>
                          {pending ? "提交中..." : "确认回退阶段"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 5. 丢单复盘表单 */}
                  {activePanel === "lost" && (
                    <form onSubmit={submitLost} className="space-y-3.5">
                      <div className="rounded-lg bg-rose-50/70 border border-rose-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </span>
                          <span className="font-semibold text-rose-950">
                            正在操作：商机输单归档 (Lost)
                          </span>
                        </div>
                        <span className="text-[11px] text-rose-800">记录失单原因以沉淀经验</span>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">输单原因 *</label>
                        <select
                          value={lostReason}
                          onChange={(e) => setLostReason(e.target.value as (typeof lostReasons)[number])}
                          className={inputClass()}
                        >
                          <option value="PRICE">价格因素 / 预算不足</option>
                          <option value="COMPETITOR">选择竞品</option>
                          <option value="NO_BUDGET">项目预算取消</option>
                          <option value="NO_DECISION">客户暂缓决策</option>
                          <option value="TIMING">推进时机不成熟</option>
                          <option value="OTHER">其他原因</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">输单分析与复盘</label>
                        <textarea
                          rows={3}
                          value={lostNote}
                          onChange={(e) => setLostNote(e.target.value)}
                          placeholder="记录核心失误、竞品动态及后续跟进可能..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button type="submit" className={buttonClass("danger")} disabled={pending}>
                          {pending ? "提交中..." : "确认输单归档"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 6. 编辑商机资料 */}
                  {activePanel === "edit" && (
                    <form onSubmit={submitEdit} className="space-y-3.5">
                      <div className="rounded-lg bg-slate-100/80 border border-slate-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </span>
                          <span className="font-semibold text-slate-900">
                            正在操作：编辑商机基础资料
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">修改商机名称、金额与需求范围</span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">商机名称 *</label>
                          <input
                            required
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className={inputClass()}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">预估金额 (元)</label>
                          <input
                            type="number"
                            min="0"
                            value={editForm.expectedAmount}
                            onChange={(e) => setEditForm({ ...editForm, expectedAmount: e.target.value })}
                            className={inputClass()}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">预计结单日期</label>
                        <input
                          type="date"
                          value={editForm.expectedCloseAt}
                          onChange={(e) => setEditForm({ ...editForm, expectedCloseAt: e.target.value })}
                          className={inputClass()}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-semibold text-slate-700">核心需求与交付范围</label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {editForm.demandNote.length}/500 字
                          </span>
                        </div>
                        <textarea
                          rows={3}
                          maxLength={500}
                          value={editForm.demandNote}
                          onChange={(e) => setEditForm({ ...editForm, demandNote: e.target.value })}
                          placeholder="明确客户痛点、预算范围与核心交付考核要求..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button type="submit" className={buttonClass("primary")} disabled={pending}>
                          {pending ? "保存中..." : "保存修改"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 7. 改约 */}
                  {activePanel === "reschedule" && (
                    <form onSubmit={submitReschedule} className="space-y-3.5">
                      <div className="rounded-lg bg-slate-100/80 border border-slate-200 p-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow-2xs">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                            </svg>
                          </span>
                          <span className="font-semibold text-slate-900">
                            正在操作：调整商机待办改期
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">重置该商机的下次跟进时限</span>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">新待办截止时间 *</label>
                        <input
                          required
                          type="datetime-local"
                          value={rescheduleDueAt}
                          onChange={(e) => setRescheduleDueAt(e.target.value)}
                          className={inputClass()}
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button type="submit" className={buttonClass("primary")} disabled={pending}>
                          {pending ? "提交中..." : "确认改期"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* 8. 主管协同战情室 */}
                  {activePanel === "intervention" && (
                    <div className="space-y-4">
                      {/* 历史与当前介入记录列表 */}
                      {interventions.length > 0 && (
                        <div className="space-y-3">
                          <span className="text-xs font-bold text-slate-900 block">协同记录</span>
                          {interventions.map((item) => (
                            <div
                              key={item.id}
                              className={`rounded-xl border p-3.5 text-xs space-y-2.5 transition ${
                                item.status === "REQUESTED"
                                  ? "border-amber-300 bg-amber-50/70"
                                  : item.status === "RESOLVED"
                                  ? "border-emerald-200 bg-emerald-50/50"
                                  : "border-slate-200 bg-white"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-900">
                                    {item.interventionType === "EXECUTIVE_SPONSOR"
                                      ? "高层领导陪访"
                                      : item.interventionType === "DISCOUNT_APPROVAL"
                                      ? "底价特批审批"
                                      : item.interventionType === "SOLUTION_SUPPORT"
                                      ? "技术方案答辩"
                                      : "谈判打法辅导"}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      item.status === "REQUESTED"
                                        ? "bg-amber-200 text-amber-900"
                                        : item.status === "RESOLVED"
                                        ? "bg-emerald-200 text-emerald-900"
                                        : "bg-slate-200 text-slate-700"
                                    }`}
                                  >
                                    {item.status === "REQUESTED"
                                      ? "待主管介入"
                                      : item.status === "RESOLVED"
                                      ? "已解决"
                                      : "已驳回"}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {new Date(item.createdAt).toLocaleString("zh-CN", {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>

                              <p className="text-slate-700 bg-white/80 p-2.5 rounded-lg border border-slate-200/60 leading-relaxed">
                                <span className="font-semibold text-slate-900">{item.requesterName || "销售专员"}：</span>
                                {item.requestNote}
                              </p>

                              {item.managerFeedback && (
                                <div className="p-2.5 bg-emerald-100/60 border border-emerald-200 rounded-lg text-emerald-950 space-y-1">
                                  <p className="font-semibold flex items-center gap-1">
                                    <span>主管批复 ({item.assignedManagerName || "业务主管"})：</span>
                                  </p>
                                  <p className="leading-relaxed">{item.managerFeedback}</p>
                                  {item.coachingNotes && (
                                    <p className="text-[11px] text-emerald-800 opacity-90 border-t border-emerald-200/60 pt-1 mt-1">
                                      指导策略：{item.coachingNotes}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* 主管解决介入表单 */}
                              {item.status === "REQUESTED" && (
                                <div className="pt-2 border-t border-amber-200/80 space-y-2">
                                  <label className="block font-semibold text-slate-900 text-xs">
                                    主管批复意见：
                                  </label>
                                  <textarea
                                    rows={2}
                                    value={resolvingInterventionId === item.id ? managerFeedback : ""}
                                    onChange={(e) => {
                                      setResolvingInterventionId(item.id);
                                      setManagerFeedback(e.target.value);
                                    }}
                                    placeholder="录入对该商机的谈判底线、打法建议或陪访安排..."
                                    className={textareaClass()}
                                  />
                                  <div className="flex justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => submitResolveIntervention(item.id, "REJECTED")}
                                      disabled={pending}
                                      className="px-3 py-1 text-slate-600 hover:text-slate-900 text-xs font-semibold rounded"
                                    >
                                      暂不介入
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => submitResolveIntervention(item.id, "RESOLVED")}
                                      disabled={pending}
                                      className="px-3.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-xs font-semibold shadow-xs"
                                    >
                                      {pending ? "处理中..." : "确认批复"}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 发起新的协同介入 */}
                      <form onSubmit={submitRequestIntervention} className="space-y-3.5 pt-2 border-t border-slate-200">
                        <span className="text-xs font-bold text-slate-900 block">发起协同请求</span>
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">协同类型 *</label>
                          <select
                            value={interventionType}
                            onChange={(e) => setInterventionType(e.target.value as InterventionType)}
                            className={inputClass()}
                          >
                            <option value="STRATEGY_COACHING">谈判策略辅导</option>
                            <option value="EXECUTIVE_SPONSOR">高层领导陪访</option>
                            <option value="DISCOUNT_APPROVAL">底价特批审批</option>
                            <option value="SOLUTION_SUPPORT">技术方案支持</option>
                          </select>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-semibold text-slate-700">协同诉求与卡点 *</label>
                          <textarea
                            required
                            rows={3}
                            value={interventionNote}
                            onChange={(e) => setInterventionNote(e.target.value)}
                            placeholder="说明需要协助的具体事项与卡点..."
                            className={textareaClass()}
                          />
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button type="submit" className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-md text-xs shadow-xs flex items-center gap-1.5" disabled={pending}>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            <span>{pending ? "提交中..." : "提交申请"}</span>
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* 9. 商机归属转移 */}
                  {activePanel === "transfer" && (
                    <form onSubmit={submitTransfer} className="space-y-3.5">
                      {/* 权责变动说明卡 */}
                      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 via-slate-50/40 to-white p-3.5 space-y-2 text-slate-700 shadow-2xs">
                        <div className="flex items-center justify-between text-xs border-b border-indigo-100/70 pb-2">
                          <span className="font-semibold text-slate-900">权责变更说明</span>
                          <span className="text-[11px] font-medium text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded">
                            多产品线协作
                          </span>
                        </div>
                        <div className="space-y-1.5 text-[11.5px]">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">商机负责人：</span>
                            <span>
                              <strong className="text-slate-800">{opportunity.ownerName}</strong>
                              {" → "}
                              <strong className="text-indigo-700">
                                {transferUsers.find((u) => u.id === transferToUserId)?.name || "请选择新负责人"}
                              </strong>
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">客户主档归属：</span>
                            <span className="font-medium text-slate-700">
                              保持不变（归属 {opportunity.customerOwnerName || "原客户负责人"}）
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">未完成跟进待办：</span>
                            <span className="font-medium text-emerald-700">自动改派至新负责人</span>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-700">目标负责人 *</label>
                          {transferUsers.length > 5 && (
                            <span className="text-[11px] text-slate-400">共 {transferUsers.length} 位在职成员</span>
                          )}
                        </div>

                        {transferUsers.length > 5 && (
                          <input
                            type="text"
                            value={transferSearchQuery}
                            onChange={(e) => setTransferSearchQuery(e.target.value)}
                            placeholder="输入姓名过滤成员..."
                            className={`${inputClass()} mb-1.5`}
                          />
                        )}

                        <select
                          required
                          value={transferToUserId}
                          onChange={(e) => setTransferToUserId(e.target.value)}
                          className={inputClass()}
                        >
                          <option value="">请选择目标负责人...</option>
                          {transferUsers
                            .filter((u) => {
                              if (!transferSearchQuery.trim()) return true;
                              const q = transferSearchQuery.toLowerCase();
                              return u.name.toLowerCase().includes(q) || (u.role && u.role.toLowerCase().includes(q));
                            })
                            .map((u) => {
                              const isCurrent = u.id === opportunity.ownerUserId || u.name === opportunity.ownerName;
                              const roleTag = u.role === "SALES" ? "销售" : u.role === "MANAGER" ? "主管" : u.role === "ADMIN" ? "管理员" : u.role || "";
                              return (
                                <option key={u.id} value={u.id} disabled={isCurrent}>
                                  {u.name} {roleTag ? `(${roleTag})` : ""} {isCurrent ? " · 当前负责人" : ""}
                                </option>
                              );
                            })}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">转移原因 *</label>
                        <select
                          value={transferReason}
                          onChange={(e) => setTransferReason(e.target.value)}
                          className={inputClass()}
                        >
                          <option value="MULTI_PRODUCT_COLLAB">多产品线协同分派（不同产品线由不同销售负责）</option>
                          <option value="REORG_DEAL">团队岗位调整 / 离职交接</option>
                          <option value="REASSIGN">主管重新调配</option>
                          <option value="CUSTOMER_REQUEST">客户指定更换跟进人</option>
                          <option value="OTHER">其他原因</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">交接说明 / 备注</label>
                        <textarea
                          rows={2}
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                          placeholder="补充转移动因或交接注意事项（选填，同步记录至审计留痕）..."
                          className={textareaClass()}
                        />
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="submit"
                          className={buttonClass("primary")}
                          disabled={pending || !transferToUserId || transferToUserId === opportunity.ownerUserId}
                        >
                          {pending ? "转移中..." : "确认转移"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 shadow-2xs">
                {opportunity.stage === "WON" ? (
                  <div className="flex items-center gap-2 font-bold text-emerald-800">
                    <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>该商机已赢单结案</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 font-semibold text-slate-600">
                    <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                    </svg>
                    <span>该商机已丢单归档</span>
                  </div>
                )}
              </div>
            )}

            {/* 商机产品与报价明细挂载 */}
            <OpportunityLineItemsSection
              opportunityId={opportunity.id}
              isTerminal={terminal}
              onTotalUpdated={() => onRefresh()}
            />

            {/* 阶段履历与商务动态时间轴 */}
            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-900 flex items-center justify-between">
                <span>流转与跟进记录</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  共 {stageHistory.length + activities.length} 条记录
                </span>
              </h3>

              {detailLoading ? (
                <div className="py-6 text-center text-xs text-slate-400">加载中...</div>
              ) : stageHistory.length === 0 && activities.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                  暂无推进记录
                </div>
              ) : (
                <div className="relative pl-4 space-y-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                  {[
                    ...stageHistory.map((s) => ({ ...s, isStage: true as const, time: new Date(s.createdAt).getTime() })),
                    ...activities.map((a) => ({ ...a, isStage: false as const, time: new Date(a.occurredAt).getTime() })),
                  ]
                    .sort((a, b) => b.time - a.time)
                    .map((item, idx) => (
                      <div key={item.id || idx} className="relative">
                        <span className={`absolute -left-4 top-2 flex h-2 w-2 rounded-full ring-2 ring-white ${
                          item.isStage ? "bg-indigo-500" : "bg-emerald-500"
                        }`} />
                        <div className="rounded-lg border border-slate-200/80 bg-white p-3 text-xs shadow-2xs space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {item.isStage ? (
                                <>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    阶段流转
                                  </span>
                                  <span className="font-bold text-slate-900">
                                    {item.fromStage ? stageLabel(item.fromStage) : "创建立项"} → {stageLabel(item.toStage)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                                    <span>经办人:</span>
                                    <span className="font-semibold text-slate-900">{item.operatorName || "历史成员"}</span>
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    {activityTypeLabel(item.type)}
                                  </span>
                                  {item.outcome && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                      {activityOutcomeLabel(item.outcome)}
                                    </span>
                                  )}
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50/80 text-emerald-800 border border-emerald-200">
                                    <span>跟进人:</span>
                                    <span className="font-semibold text-emerald-950">{item.userName || "历史成员"}</span>
                                  </span>
                                </>
                              )}
                            </div>
                            <span className="font-mono text-slate-400 text-[10px]">
                              {new Date(item.time).toLocaleString("zh-CN", {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                          <p className="text-slate-700 leading-relaxed break-words whitespace-pre-wrap bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                            {item.isStage ? item.note || "阶段流转记录" : item.summary}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </main>

          {/* 右侧边栏 (33% 宽屏占比)：商机档案卡 + 规则质检 + AI 销冠副驾驶 */}
          <aside className={`xl:col-span-4 flex flex-col bg-slate-50/60 p-5 sm:p-6 overflow-y-auto min-h-0 h-full pb-24 space-y-5 ${viewTab !== "overview" ? "hidden xl:flex" : "flex"}`}>
            {/* 1. 客户与关键决策人画像 */}
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3.5 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-1.5 font-bold text-slate-950 text-xs">
                  <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                  </div>
                  <span>客户与决策人画像</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setViewTab("workbench");
                    setActivePanel("edit");
                  }}
                  className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-0.5"
                >
                  <span>编辑</span>
                  <span>→</span>
                </button>
              </div>

              {/* 关键决策人与客户企业卡片 */}
              <div className="space-y-2">
                <div className="rounded-lg bg-slate-50/80 p-3 border border-slate-200/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 text-[11px]">关键决策人 (EB)</span>
                    {detail?.opportunity.contactTitle ? (
                      <span className="text-[10px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded font-medium">
                        {detail.opportunity.contactTitle}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">未注明职务</span>
                    )}
                  </div>
                  <div className="font-semibold text-slate-900 text-xs flex items-center justify-between">
                    <span>{opportunity.primaryContactName || "未指定主联系人"}</span>
                    {detail?.opportunity.contactPhone && (
                      <MaskedPhone
                        phone={detail.opportunity.contactPhone}
                        entityType="CUSTOMER"
                      reason="商机推进抽屉核对联系方式"
                        entityId={opportunity.customerId}
                        showCopy={true}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* 核心需求与交付范围展示 */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-700 block text-[11px] font-semibold">核心需求与交付范围</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {detail?.opportunity.demandNote ? `${detail.opportunity.demandNote.length} 字` : "未录入"}
                  </span>
                </div>
                {detail?.opportunity.demandNote ? (
                  <div className="p-3 bg-slate-50/60 rounded-xl border border-slate-200/80 text-xs text-slate-800 leading-relaxed break-words whitespace-pre-wrap font-normal">
                    {detail.opportunity.demandNote}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50/40 rounded-xl border border-dashed border-slate-200 text-[11px] text-slate-400 text-center">
                    暂未录入需求说明，点击右上角【编辑】补充
                  </div>
                )}
              </div>
            </div>

            {/* 2. 统一智能决策与战法导航 (深度整合：SLA 预警 + 事实规则质检 + AI 深度推演 NBA + 阶段打法基线) */}
            <DealCopilotPanel
              opportunityId={opportunity.id}
              customerName={opportunity.customerName}
              stage={opportunity.stage}
              isStalled={opportunity.isStalled}
              insights={insights}
              onAcceptInsight={handleAcceptInsight}
              onDismissInsight={handleDismissInsight}
              isInsightPending={pending}
              isTerminal={terminal}
              isAiCopilotEnabled={isAiCopilotEnabled}
              onApplyToActivity={(script) => {
                setViewTab("workbench");
                setActivePanel("activity");
                setActivityForm((prev) => ({
                  ...prev,
                  summary: prev.summary ? `${prev.summary}\n${script}` : script,
                }));
              }}
              onTriggerIntervention={(reason) => {
                setViewTab("workbench");
                setActivePanel("intervention");
                setInterventionNote(reason ? `【AI 智能诊断协同建议】：${reason}` : "");
              }}
            />
          </aside>
        </div>
      </aside>
    </>
  );
}

function activityTypeLabel(type: string) {
  return (
    {
      CALL: "电话沟通",
      MEETING: "会议洽谈",
      VISIT: "现场拜访",
      MESSAGE: "企微/微信",
      EMAIL: "商务邮件",
      NOTE: "内部纪要",
    }[type] ?? type
  );
}

function activityOutcomeLabel(outcome: string | null) {
  if (!outcome) return null;
  return (
    {
      INTERESTED: "意向明确",
      CONNECTED: "正常沟通",
      BUSY: "稍后联系",
      NO_ANSWER: "未接通/未回复",
      REJECTED: "暂无意向",
      REFUSED: "明确拒绝",
    }[outcome] ?? outcome
  );
}
