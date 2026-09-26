"use client";

import { FormEvent, MouseEvent, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  assignLeadAction,
  discardLeadAction,
  getLeadDetailAction,
  logActivityAction,
  mergeLeadAction,
  qualifyLeadAction,
  rescheduleTaskAction,
  restoreLeadAction,
  updateLeadAction,
} from "../actions";
import { convertLeadToCustomer } from "@/core/customer/actions";
import { acceptSalesInsight, dismissSalesInsight, getSalesInsights } from "@/core/insight/actions";
import { submitScoreFeedback } from "@/core/scoring/actions";
import { generateLeadOutreachPitchAction } from "@/core/ai-copilot/actions";
import type { LeadPitchScript } from "@/core/ai-copilot/types";
import type { InsightDismissReason, InsightListItem } from "@/core/insight/types";
import type { AssignableUser, LeadDetail, LeadRole } from "../types";
import { formatDate, formatDue, sourceLabel, statusLabel } from "../types";
import { dateInputValue, parseLocalDate } from "@/core/shared/date";
import { dueAtError, initialDueAt } from "../../today/presentation";
import { listProductsAction } from "@/core/products/actions";
import { type ProductItem, formatPricingModel } from "@/core/products/types";
import { useEffect, useMemo } from "react";
import MaskedPhone from "@/core/security/MaskedPhone";

type Props = {
  role: LeadRole;
  initialDetail: LeadDetail;
  assignableUsers: AssignableUser[];
  initialInsights: InsightListItem[];
  initialPanel: "convert" | null;
  pluginPanels?: ReactNode;
};
type Panel = "edit" | "activity" | "qualify" | "discard" | "assign" | "reschedule" | "convert" | null;
// 表单内部状态：受控 input 必须是 string（空值用 ""）
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
// 提交给 server action 的载荷：可选字段空值转 null
// （intendedProductId 是 uuid 校验字段，空串会被 zod 拒绝报 "Invalid uuid"）
type EditFormPayload = {
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  companyName: string | null;
  title: string | null;
  intendedProductId: string | null;
  intendedProduct: string | null;
  budget: string | null;
  note: string | null;
};

const activityTypes = [["CALL", "电话沟通"], ["MEETING", "会议汇报"], ["VISIT", "上门拜访"], ["MESSAGE", "微信/短信"], ["NOTE", "内部记录"]] as const;
const activityOutcomes = [["CONNECTED", "已接通"], ["NO_ANSWER", "未接通"], ["REFUSED", "明确拒绝"], ["INTERESTED", "极有意向"]] as const;
const discardReasons = [["NO_NEED", "没有需求"], ["NO_BUDGET", "没有预算"], ["WRONG_CONTACT", "联系人不对"], ["INVALID_INFO", "信息无效"], ["COMPETITOR", "选了竞品"], ["OTHER", "其他"]] as const;
const insightDismissReasons: Array<[InsightDismissReason, string]> = [["NOT_APPLICABLE", "不适用"], ["ALREADY_HANDLED", "已处理"], ["WRONG_INFORMATION", "信息错误"], ["OTHER", "其他"]];

function activityLabel(type: LeadDetail["activities"][number]["type"]) {
  return activityTypes.find(([value]) => value === type)?.[1] ?? type;
}

function outcomeLabel(outcome?: LeadDetail["activities"][number]["outcome"]) {
  if (!outcome) return null;
  return activityOutcomes.find(([value]) => value === outcome)?.[1] ?? outcome;
}

export default function LeadDetailClient({
  role,
  initialDetail,
  assignableUsers,
  initialInsights,
  initialPanel,
  pluginPanels,
}: Props) {
  const [detail, setDetail] = useState(initialDetail);
  const [insights, setInsights] = useState(initialInsights);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightPanel, setInsightPanel] = useState<{ id: string; kind: "accept" | "dismiss" } | null>(null);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [error, setError] = useState<string | null>(null);
  const [loading, startTransition] = useTransition();
  const [insightPending, startInsightTransition] = useTransition();
  const [outreachPitch, setOutreachPitch] = useState<LeadPitchScript | null>(null);
  const [isGeneratingPitch, setIsGeneratingPitch] = useState(false);
  const [pitchTab, setPitchTab] = useState<"full" | "wechatMsg" | "friendReq" | "phone">("full");
  const [copiedPitch, setCopiedPitch] = useState(false);
  const [appliedPitchTip, setAppliedPitchTip] = useState(false);
  const [activityPrefill, setActivityPrefill] = useState<{
    summary?: string;
    type?: LeadDetail["activities"][number]["type"];
  } | null>(null);
  const router = useRouter();

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

  const lead = detail.lead;
  const isManager = role === "MANAGER" || role === "ADMIN";
  const canAct = lead.status !== "CONVERTED" && lead.status !== "DISCARDED" && Boolean(lead.ownerUserId);
  const canConvert = lead.status === "QUALIFIED" && Boolean(lead.ownerUserId);

  const primaryPanel = !lead.ownerUserId
    ? (isManager ? "assign" : null)
    : lead.status === "NEW"
    ? "activity"
    : lead.status === "CONTACTED"
    ? "qualify"
    : null;

  function reload() {
    startTransition(async () => {
      const [result, insightResult] = await Promise.all([
        getLeadDetailAction(lead.id),
        getSalesInsights({ subjectType: "lead", subjectId: lead.id }),
      ]);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDetail(result.data);
      if (insightResult.ok) {
        setInsights(insightResult.data as InsightListItem[]);
        setInsightError(null);
      } else {
        setInsightError("建议刷新失败，请稍后重试");
      }
      setPanel(null);
      setError(null);
    });
  }

  function completeInsight(id: string) {
    setInsights((current) => current.filter((item) => item.id !== id));
    setInsightPanel(null);
    setInsightError(null);
    reload();
  }

  function handleInsight(id: string, kind: "accept" | "dismiss") {
    setInsightError(null);
    setInsightPanel((current) => (current?.id === id && current.kind === kind ? null : { id, kind }));
  }

  async function run(action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) {
    setError(null);
    try {
      const result = await action;
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      reload();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试");
      return false;
    }
  }

  function openPanelFromMore(event: MouseEvent<HTMLButtonElement>, nextPanel: Exclude<Panel, null>) {
    setPanel((current) => (current === nextPanel ? null : nextPanel));
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  async function giveScoreFeedback(verdict: "ACCURATE" | "INACCURATE") {
    if (lead.score === null || lead.score === undefined) return;
    setError(null);
    const result = await submitScoreFeedback({ leadId: lead.id, verdict });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    reload();
  }

  return (
    <div className="space-y-6">
      {/* 1. 面包屑 */}
      <div className="flex items-center justify-between">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-950 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回销售线索
        </Link>
        <span className="text-xs text-slate-400 font-mono">线索 ID: {lead.id.slice(0, 8)}...</span>
      </div>

      {/* 2. 主头部卡片 */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={lead.status} />
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                {sourceLabel(lead.source)}
              </span>
              {lead.isPossibleDuplicate && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  疑似重客
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-slate-950 mt-2">
              {lead.contactName}
            </h1>

            <p className="text-xs text-slate-500 mt-1">
              公司: <strong className="text-slate-800">{lead.companyName || "未填写企业主体"}</strong>
              {lead.title ? ` · 职务: ${lead.title}` : ""}
              <span> · 负责人: <strong className="text-slate-800">{lead.ownerName || "公海待认领"}</strong></span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!lead.ownerUserId ? (
              isManager ? (
                <button
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                  onClick={() => setPanel(panel === "assign" ? null : "assign")}
                >
                  指派负责人
                </button>
              ) : (
                <button
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                  disabled={loading}
                  onClick={() => void run(assignLeadAction({ leadId: lead.id }))}
                >
                  从公海认领线索
                </button>
              )
            ) : canConvert ? (
              <button
                className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                onClick={() => setPanel(panel === "convert" ? null : "convert")}
              >
                转客户并立项商机 →
              </button>
            ) : primaryPanel ? (
              <button
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
                onClick={() => setPanel(panel === primaryPanel ? null : primaryPanel)}
              >
                {primaryPanel === "activity" ? "记录初次跟进" : primaryPanel === "qualify" ? "确认需求痛点" : "指派负责人"}
              </button>
            ) : null}

            {isManager && lead.status === "DISCARDED" && (
              <button
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                disabled={loading}
                onClick={() => void run(restoreLeadAction({ leadId: lead.id }))}
              >
                恢复线索
              </button>
            )}

            {canAct && (
              <>
                <button
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
                  onClick={() => setPanel(panel === "activity" ? null : "activity")}
                >
                  记录跟进
                </button>
                <button
                  className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
                  onClick={() => setPanel(panel === "edit" ? null : "edit")}
                >
                  编辑线索
                </button>

                <details className="relative">
                  <summary className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs cursor-pointer list-none">
                    更多 ▾
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg text-xs space-y-1">
                    {lead.status === "CONTACTED" && primaryPanel !== "qualify" && (
                      <button
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                        onClick={(e) => openPanelFromMore(e, "qualify")}
                      >
                        确认客户意向需求
                      </button>
                    )}
                    {isManager && (
                      <button
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                        onClick={(e) => openPanelFromMore(e, "assign")}
                      >
                        重新分派销售
                      </button>
                    )}
                    {detail.openTask && (
                      <button
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                        onClick={(e) => openPanelFromMore(e, "reschedule")}
                      >
                        调整待办时效
                      </button>
                    )}
                    <button
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 font-medium"
                      onClick={(e) => openPanelFromMore(e, "discard")}
                    >
                      退回公海 / 放弃线索
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        </div>

        {lead.status === "CONVERTED" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 border border-emerald-200 shadow-2xs">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-sm text-emerald-950">该线索已成功转化为正式客户与商机</div>
                <div className="text-emerald-700 mt-0.5">
                  已沉淀为企业客户：<span className="font-semibold">{detail.convertedCustomer?.name || "已建档客户"}</span>
                  {detail.convertedOpportunity && <> · 推进商机：<span className="font-semibold">{detail.convertedOpportunity.name}</span></>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {detail.convertedCustomer && (
                <Link
                  href={`/customers/${detail.convertedCustomer.id}`}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold shadow-xs transition-colors"
                >
                  查看企业客户画像 →
                </Link>
              )}
              {detail.convertedOpportunity && (
                <Link
                  href={`/opportunities/${detail.convertedOpportunity.id}`}
                  className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded-lg font-semibold transition-colors"
                >
                  查看关联商机 →
                </Link>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error}
          </div>
        )}
      </div>

      {/* 3. 评分与反馈栏 */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 rounded-full font-bold bg-blue-50 text-blue-800 border border-blue-200 font-mono">
            {lead.score == null ? "0 分" : `${lead.score} 分`}
          </span>
          <div>
            <span className="font-semibold text-slate-900">意向智能评分：</span>
            <span className="text-slate-600">{lead.scoreReason || "未命中具体加分规则"}</span>
          </div>
        </div>

        {lead.score != null && (
          <div className="flex items-center gap-2">
            <span className="text-slate-400">评分精准度：</span>
            <button
              onClick={() => void giveScoreFeedback("ACCURATE")}
              className={`px-2.5 py-1 rounded-lg font-medium border text-xs transition-colors ${
                detail.scoreFeedback?.verdict === "ACCURATE"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              准确
            </button>
            <button
              onClick={() => void giveScoreFeedback("INACCURATE")}
              className={`px-2.5 py-1 rounded-lg font-medium border text-xs transition-colors ${
                detail.scoreFeedback?.verdict === "INACCURATE"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              不准
            </button>
          </div>
        )}
      </section>

      {/* 4. 智能洞察雷达 */}
      <LeadHealthSummary insights={insights} />
      <LeadInsights
        canAct={canAct}
        error={insightError}
        insights={insights}
        openPanel={insightPanel}
        pending={insightPending}
        onOpen={handleInsight}
        onCancel={() => setInsightPanel(null)}
        onAccept={(insightId, dueAt) =>
          startInsightTransition(async () => {
            const result = await acceptSalesInsight({ insightId, dueAt: new Date(dueAt) });
            if (!result.ok) {
              setInsightError(result.message);
              return;
            }
            completeInsight(insightId);
          })
        }
        onDismiss={(insightId, reason) =>
          startInsightTransition(async () => {
            const result = await dismissSalesInsight({ insightId, reason });
            if (!result.ok) {
              setInsightError(result.message);
              return;
            }
            completeInsight(insightId);
          })
        }
      />

      {/* 弹窗面板 */}
      {panel === "edit" && <EditPanel detail={detail} onCancel={() => setPanel(null)} onSubmit={(form) => run(updateLeadAction({ leadId: lead.id, ...form }))} />}
      {panel === "activity" && (
        <ActivityPanel
          leadId={lead.id}
          initialSummary={activityPrefill?.summary}
          initialType={activityPrefill?.type}
          outreachPitch={outreachPitch}
          pitchTab={pitchTab}
          getActivePitchText={getActivePitchText}
          onCancel={() => {
            setPanel(null);
            setActivityPrefill(null);
          }}
          onSubmit={run}
        />
      )}
      {panel === "qualify" && <QualifyPanel leadId={lead.id} onCancel={() => setPanel(null)} onSubmit={run} />}
      {panel === "discard" && <DiscardPanel leadId={lead.id} onCancel={() => setPanel(null)} onSubmit={run} />}
      {panel === "assign" && <AssignPanel leadId={lead.id} users={assignableUsers} currentUserId={lead.ownerUserId} onCancel={() => setPanel(null)} onSubmit={run} />}
      {panel === "convert" && <ConvertPanel detail={detail} onCancel={() => setPanel(null)} onSuccess={(opportunityId) => router.push(`/opportunities/${opportunityId}`)} />}

      {/* 5. 主内容两栏布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 已转客户与关联商机卡片 */}
          {(lead.status === "CONVERTED" || detail?.convertedCustomer) && (
            <section className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/70 via-emerald-50/30 to-white p-4 shadow-2xs space-y-3 text-xs">
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
            </section>
          )}

          {/* 跟进沟通记录卡片 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">全息跟进沟通记录</h2>
                <p className="text-xs text-slate-400">共 {detail.activities.length} 条有效沟通动态</p>
              </div>
              {canAct && (
                <button
                  onClick={() => setPanel("activity")}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  + 记录跟进
                </button>
              )}
            </div>

            {detail.activities.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">暂无跟进记录</div>
            ) : (
              <div className="space-y-3">
                {detail.activities.map((act) => (
                  <div key={act.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{activityLabel(act.type)}</span>
                        {act.outcome && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            {outcomeLabel(act.outcome)}
                          </span>
                        )}
                        <span className="text-slate-400">记录人: {act.userName}</span>
                      </div>
                      <span className="font-mono text-slate-400 text-[11px]">{formatDate(act.occurredAt)}</span>
                    </div>
                    <p className="text-slate-700 leading-relaxed">{act.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 状态流转留痕卡片 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">生命周期状态流转留痕</h2>
              <p className="text-xs text-slate-400">每次状态流转、认领、放弃与恢复严格审计追溯</p>
            </div>

            <div className="space-y-2">
              {detail.statusHistory.map((item) => (
                <div key={item.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-slate-900">
                      {item.fromStatus ? `${statusLabel(item.fromStatus)} → ` : "创建为 "}
                      {statusLabel(item.toStatus)}
                    </span>
                    <span className="text-slate-400 ml-2">操作人: {item.actorName} {item.reason ? ` · 原因: ${item.reason}` : ""}</span>
                  </div>
                  <span className="font-mono text-slate-400 text-[11px]">{formatDate(item.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 右侧边栏：线索档案与插件 */}
        <div className="space-y-6">
          {/* AI 拓客初次触达首响话术 */}
          <section className="bg-gradient-to-br from-indigo-50/70 via-white to-blue-50/50 border border-indigo-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-indigo-950 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-indigo-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>AI 拓客首响触达话术</span>
              </h3>
              {outreachPitch && (
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
              )}
            </div>

            {!outreachPitch ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  基于企业背景、线索来源与核心诉求，智能生成多渠道破冰话术（支持微信加好友、企微首发与电话开场）。
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
                <div className="text-xs text-slate-800 bg-white p-3 rounded-lg border border-indigo-100 whitespace-pre-wrap leading-relaxed shadow-2xs font-normal max-h-48 overflow-y-auto">
                  {getActivePitchText(outreachPitch, pitchTab)}
                </div>

                {/* 底部操作条：一键填入跟进 + 重新生成 */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      const text = getActivePitchText(outreachPitch, pitchTab);
                      setActivityPrefill({
                        summary: text,
                        type: pitchTab === "phone" ? "CALL" : "MESSAGE",
                      });
                      setPanel("activity");
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
                    <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span>已填入跟进表单，请在弹窗中确认提交！</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 产品意向与需求卡 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-slate-900">产品意向</h3>
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
                onClick={() => setPanel("edit")}
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
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold text-slate-900">线索基础属性</h3>
            <div className="space-y-2.5 border-t border-slate-100 pt-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">手机号码</span>
                <MaskedPhone
                  phone={lead.contactPhone}
                  entityType="LEAD"
                      reason="线索详情页跟进前核对联系方式"
                  entityId={lead.id}
                  showCopy={true}
                />
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">电子邮箱</span>
                <span>{lead.contactEmail || "未填写"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">线索来源</span>
                <span className="font-medium">{sourceLabel(lead.source)}</span>
              </div>
              {lead.source.startsWith("api:") && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">来源标识</span>
                    <span className="font-mono">{lead.sourceKey || lead.source.slice(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">外部单号</span>
                    <span className="font-mono">{lead.externalId || "无"}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">创建时间</span>
                <span className="font-mono">{formatDate(lead.createdAt)}</span>
              </div>
            </div>
          </section>

          {/* 当前待办任务 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 flex items-center justify-between">
              <span>待办任务</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            </h3>
            <div className="border-t border-slate-100 pt-3">
              {detail.openTask ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">任务类型</span>
                    <span className="font-semibold">{detail.openTask.type === "FIRST_RESPONSE" ? "首响跟进" : "常规跟进"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">截止时限</span>
                    <span className="font-mono font-bold text-amber-600">{formatDue(detail.openTask.dueAt).label}</span>
                  </div>
                  {panel === "reschedule" && (
                    <ReschedulePanel
                      taskId={detail.openTask.id}
                      dueAt={typeof detail.openTask.dueAt === "string" ? detail.openTask.dueAt : new Date(detail.openTask.dueAt).toISOString()}
                      onCancel={() => setPanel(null)}
                      onSubmit={run}
                    />
                  )}
                </div>
              ) : (
                <div className="text-slate-400 py-1 text-center">暂无待办任务</div>
              )}
            </div>
          </section>

          {/* 撞单/疑似重复卡片 */}
          {(lead.isPossibleDuplicate || detail.possibleDuplicates.length > 0) && (
            <section className="bg-white border border-amber-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
              <h3 className="font-bold text-amber-900">疑似重客预警</h3>
              <div className="space-y-2 border-t border-amber-100 pt-3">
                {detail.possibleDuplicates.map((dup) => (
                  <div key={dup.id} className="p-2.5 bg-amber-50/50 rounded-lg space-y-1">
                    <div className="flex justify-between">
                      <Link href={`/leads/${dup.id}`} className="font-bold text-blue-600 hover:underline">
                        {dup.contactName}
                      </Link>
                      <span className="text-slate-400">{statusLabel(dup.status)}</span>
                    </div>
                    <div className="text-slate-500">{dup.companyName || "未填公司"}</div>
                    {isManager && (
                      <button
                        onClick={() => run(mergeLeadAction({ sourceLeadId: lead.id, targetLeadId: dup.id }))}
                        className="mt-1 w-full py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-semibold"
                      >
                        合并并归档当前线索
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 匹配存量企业客户卡片 */}
          {detail.existingCustomerMatch && (
            <section className="bg-white border border-blue-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-blue-900 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12l6 4.5V21" />
                  </svg>
                  <span>匹配到存量企业客户</span>
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  已在库
                </span>
              </div>
              <div className="p-3 bg-blue-50/50 rounded-lg space-y-2 border border-blue-100">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-900">{detail.existingCustomerMatch.name}</span>
                  <Link href={`/customers/${detail.existingCustomerMatch.id}`} className="text-blue-600 font-semibold hover:underline">
                    查看客户档案 →
                  </Link>
                </div>
                <div className="text-slate-500 flex justify-between">
                  <span>责任人: {detail.existingCustomerMatch.ownerName}</span>
                  <span>主要联系人: {detail.existingCustomerMatch.contactName}</span>
                </div>
              </div>
            </section>
          )}

          {/* 撞单风控预警 */}
          {detail.restrictedCustomerMatch && (
            <section className="bg-white border border-amber-200 rounded-xl p-5 shadow-xs space-y-2 text-xs">
              <h3 className="font-bold text-amber-900 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>存量客户撞单预警</span>
              </h3>
              <p className="text-amber-800 leading-relaxed">
                系统检测到该联系电话已存在于其他销售名下的正式企业客户中，请联系主管协调或申请跨区协同。
              </p>
            </section>
          )}

          {pluginPanels}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: LeadDetail["lead"]["status"] }) {
  const color =
    status === "DISCARDED"
      ? "bg-slate-100 text-slate-700 border border-slate-200"
      : status === "QUALIFIED"
      ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
      : status === "CONTACTED"
      ? "bg-blue-50 text-blue-800 border border-blue-200"
      : "bg-amber-50 text-amber-800 border border-amber-200";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>{statusLabel(status)}</span>;
}

function LeadHealthSummary({ insights }: { insights: InsightListItem[] }) {
  const highest = insights[0];
  const label = highest?.severity === "HIGH_RISK" ? "高风险" : highest?.severity === "ATTENTION" ? "需关注" : highest ? "提示" : "健康";
  const tone = highest?.severity === "HIGH_RISK" ? "bg-red-50 text-red-800 border border-red-200" : highest?.severity === "ATTENTION" ? "bg-amber-50 text-amber-800 border border-amber-200" : highest ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-800 border border-emerald-200";

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-0.5 rounded-full font-bold ${tone}`}>{label}</span>
        {highest ? (
          <div>
            <span className="font-semibold text-slate-900">AI 智能预警：{highest.title}</span>
            <span className="text-slate-500 ml-2 hidden sm:inline">动作建议：{highest.suggestedAction}</span>
          </div>
        ) : (
          <span className="text-slate-500">线索推进正常，无超时未响应风险。</span>
        )}
      </div>
      {insights.length > 1 && <span className="text-slate-400 font-mono">另有 {insights.length - 1} 条建议</span>}
    </section>
  );
}

function LeadInsights({
  canAct,
  error,
  insights,
  openPanel,
  pending,
  onOpen,
  onCancel,
  onAccept,
  onDismiss,
}: {
  canAct: boolean;
  error: string | null;
  insights: InsightListItem[];
  openPanel: { id: string; kind: "accept" | "dismiss" } | null;
  pending: boolean;
  onOpen: (id: string, kind: "accept" | "dismiss") => void;
  onCancel: () => void;
  onAccept: (id: string, dueAt: string) => void;
  onDismiss: (id: string, reason: InsightDismissReason) => void;
}) {
  if (insights.length === 0 && !error) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-900">智能风险雷达与行动建议</h2>
        <span className="text-xs text-slate-400">{insights.length} 条待处理</span>
      </div>

      {error && <p className="text-xs text-red-600 bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</p>}

      <div className="space-y-3">
        {insights.map((insight) => (
          <div key={insight.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900 text-sm">{insight.title}</div>
              <span className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-800 font-semibold">
                {insight.severity === "HIGH_RISK" ? "高风险" : "需关注"}
              </span>
            </div>
            <p className="text-slate-600">{insight.summary}</p>

            {canAct && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onOpen(insight.id, "accept")}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                >
                  采纳建议
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onOpen(insight.id, "dismiss")}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-100"
                >
                  忽略
                </button>
              </div>
            )}

            {Boolean(openPanel && openPanel.id === insight.id && openPanel.kind === "accept") && (
              <InsightAcceptPanel
                insight={insight}
                pending={pending}
                error={error}
                onCancel={onCancel}
                onSubmit={(dueAt) => onAccept(insight.id, dueAt)}
              />
            )}
            {Boolean(openPanel && openPanel.id === insight.id && openPanel.kind === "dismiss") && (
              <InsightDismissPanel
                pending={pending}
                error={error}
                onCancel={onCancel}
                onSubmit={(reason) => onDismiss(insight.id, reason)}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function InsightAcceptPanel({
  insight,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  insight: InsightListItem;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (dueAt: string) => void;
}) {
  const [dueAt, setDueAt] = useState(initialDueAt(insight.suggestedDueAt));
  const [validationError, setValidationError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const message = dueAtError(dueAt);
    if (message) {
      setValidationError(message);
      return;
    }
    setValidationError("");
    onSubmit(dueAt);
  }

  return (
    <form className="p-3 bg-white rounded-xl border border-slate-200 space-y-2 mt-2" onSubmit={submit}>
      <label className="block text-xs font-semibold">确认下次跟进时间 *</label>
      <input
        required
        type="datetime-local"
        min={initialDueAt(null)}
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="w-full text-xs border rounded p-1.5 bg-slate-50"
      />
      {(validationError || error) && <p className="text-xs text-red-600">{validationError || error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1 text-xs border rounded">取消</button>
        <button type="submit" disabled={pending} className="px-3 py-1 text-xs bg-blue-600 text-white rounded font-semibold">确认采纳</button>
      </div>
    </form>
  );
}

function InsightDismissPanel({
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: InsightDismissReason) => void;
}) {
  const [reason, setReason] = useState<InsightDismissReason>("NOT_APPLICABLE");

  return (
    <form className="p-3 bg-white rounded-xl border border-slate-200 space-y-2 mt-2" onSubmit={(e) => { e.preventDefault(); onSubmit(reason); }}>
      <label className="block text-xs font-semibold">忽略原因</label>
      <select value={reason} onChange={(e) => setReason(e.target.value as InsightDismissReason)} className="w-full text-xs border rounded p-1.5 bg-slate-50">
        {insightDismissReasons.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel} className="px-3 py-1 text-xs border rounded">取消</button>
        <button type="submit" disabled={pending} className="px-3 py-1 text-xs bg-slate-900 text-white rounded font-semibold">确认忽略</button>
      </div>
    </form>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EditPanel({ detail, onCancel, onSubmit }: { detail: LeadDetail; onCancel: () => void; onSubmit: (form: EditFormPayload) => Promise<boolean> }) {
  const lead = detail.lead;
  const [form, setForm] = useState<EditForm>({
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
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [customProductMode, setCustomProductMode] = useState(false);
  const [pending, setPending] = useState(false);

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    // 空串统一转 null（见 EditFormPayload 注释）
    const ok = await onSubmit({
      ...form,
      contactEmail: form.contactEmail.trim() || null,
      companyName: form.companyName.trim() || null,
      title: form.title.trim() || null,
      intendedProductId: form.intendedProductId.trim() || null,
      intendedProduct: form.intendedProduct.trim() || null,
      budget: form.budget.trim() || null,
      note: form.note.trim() || null,
    } satisfies EditFormPayload);
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <ModalWrapper title="编辑线索信息" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">联系人姓名 *</label>
            <input required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" />
          </div>
          <div>
            <label className="block font-semibold mb-1">联系人手机 *</label>
            <input required value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="w-full border rounded-lg p-2 font-mono bg-slate-50" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">所属企业</label>
            <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="企业全称或品牌名" />
          </div>
          <div>
            <label className="block font-semibold mb-1">职位头衔</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="例如：采购总监 / CTO" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">电子邮箱</label>
            <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="name@company.com" />
          </div>
          <div>
            <label className="block font-semibold mb-1">预估预算</label>
            <input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="例如：100,000 或 5-10万" />
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">意向产品</label>
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
                  className="w-full border rounded-lg p-2 bg-slate-50"
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
                    className="w-full border rounded-lg p-2 bg-slate-50"
                    placeholder="输入自定义产品需求名称..."
                  />
                )}
              </>
            ) : (
              <div className="space-y-1">
                <input
                  value={form.intendedProduct}
                  onChange={(e) => setForm({ ...form, intendedProductId: "", intendedProduct: e.target.value })}
                  className="w-full border rounded-lg p-2 bg-slate-50"
                  placeholder="例如：企业旗舰版 / 私有化部署"
                />
                <p className="text-[10px] text-slate-400">
                  暂未配置标准产品，可在「产品配置」中维护。
                </p>
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">需求描述</label>
          <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="输入客户业务诉求与需求细节..." />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存修改</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ActivityPanel({
  leadId,
  initialSummary,
  initialType,
  outreachPitch,
  pitchTab,
  getActivePitchText,
  onCancel,
  onSubmit,
}: {
  leadId: string;
  initialSummary?: string;
  initialType?: LeadDetail["activities"][number]["type"];
  outreachPitch?: LeadPitchScript | null;
  pitchTab?: "full" | "wechatMsg" | "friendReq" | "phone";
  getActivePitchText?: (pitch: LeadPitchScript, tab: "full" | "wechatMsg" | "friendReq" | "phone") => string;
  onCancel: () => void;
  onSubmit: (action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) => Promise<boolean>;
}) {
  const [type, setType] = useState<LeadDetail["activities"][number]["type"]>(initialType || "CALL");
  const [outcome, setOutcome] = useState<LeadDetail["activities"][number]["outcome"]>("CONNECTED");
  const [summary, setSummary] = useState(initialSummary || "");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const ok = await onSubmit(
      logActivityAction({
        leadId,
        type,
        outcome: type === "NOTE" ? undefined : outcome,
        summary,
        nextFollowUpAt: next ? new Date(next) : undefined,
      }),
    );
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <ModalWrapper title="记录线索跟进" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">跟进方式</label>
            <select value={type} onChange={(e) => setType(e.target.value as LeadDetail["activities"][number]["type"])} className="w-full border rounded-lg p-2 bg-slate-50">
              {activityTypes.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
            </select>
          </div>
          {type !== "NOTE" && (
            <div>
              <label className="block font-semibold mb-1">沟通结果</label>
              <select value={outcome ?? "CONNECTED"} onChange={(e) => setOutcome(e.target.value as LeadDetail["activities"][number]["outcome"])} className="w-full border rounded-lg p-2 bg-slate-50">
                {activityOutcomes.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
              </select>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block font-semibold">沟通纪要 *</label>
            {outreachPitch && getActivePitchText && (
              <button
                type="button"
                onClick={() => {
                  const text = getActivePitchText(outreachPitch, pitchTab || "full");
                  setSummary(text);
                }}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold"
              >
                引用 AI 话术
              </button>
            )}
          </div>
          <textarea rows={3} required value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="记录跟进内容与核心沟通进展..." />
        </div>
        <div>
          <label className="block font-semibold mb-1">下一次跟进时间</label>
          <input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">确认记录</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function QualifyPanel({ leadId, onCancel, onSubmit }: { leadId: string; onCancel: () => void; onSubmit: (action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) => Promise<boolean> }) {
  const [demandNote, setDemandNote] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const ok = await onSubmit(qualifyLeadAction({ leadId, demandNote }));
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <ModalWrapper title="需求确认" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">需求描述 *</label>
          <textarea rows={3} required placeholder="输入客户业务痛点、预算范围与期望排期..." value={demandNote} onChange={(e) => setDemandNote(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold">确认通过</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function DiscardPanel({ leadId, onCancel, onSubmit }: { leadId: string; onCancel: () => void; onSubmit: (action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) => Promise<boolean> }) {
  const [reason, setReason] = useState<"NO_NEED" | "NO_BUDGET" | "WRONG_CONTACT" | "INVALID_INFO" | "COMPETITOR" | "OTHER">("NO_NEED");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const ok = await onSubmit(discardLeadAction({ leadId, reason, note: note || undefined }));
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <ModalWrapper title="放弃线索" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">放弃原因 *</label>
          <select value={reason} onChange={(e) => setReason(e.target.value as "NO_NEED" | "NO_BUDGET" | "WRONG_CONTACT" | "INVALID_INFO" | "COMPETITOR" | "OTHER")} className="w-full border rounded-lg p-2 bg-slate-50">
            {discardReasons.map(([val, lbl]) => <option key={val} value={val}>{lbl}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">详细说明</label>
          <textarea rows={3} required={reason === "OTHER"} placeholder="补充说明放弃原因..." value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-semibold">确认放弃</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function AssignPanel({ leadId, users, currentUserId, onCancel, onSubmit }: { leadId: string; users: AssignableUser[]; currentUserId?: string | null; onCancel: () => void; onSubmit: (action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) => Promise<boolean> }) {
  const [userId, setUserId] = useState(currentUserId || users[0]?.id || "");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const ok = await onSubmit(assignLeadAction({ leadId, userId }));
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <ModalWrapper title="指派线索负责人" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">选择销售负责人 *</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">确认指派</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ConvertPanel({ detail, onCancel, onSuccess }: { detail: LeadDetail; onCancel: () => void; onSuccess: (opportunityId: string) => void }) {
  const lead = detail.lead;
  const [customerType, setCustomerType] = useState<"ENTERPRISE" | "INDIVIDUAL">(lead.companyName ? "ENTERPRISE" : "INDIVIDUAL");
  const [customerName, setCustomerName] = useState(lead.companyName || `${lead.contactName}（个人）`);
  const [contactRoleTag, setContactRoleTag] = useState<"DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER">("DECISION_MAKER");
  const defaultOppName = lead.intendedProduct ? `${customerName}-${lead.intendedProduct}项目` : `${customerName}商机项目`;
  const [opportunityName, setOpportunityName] = useState(defaultOppName);
  const defaultAmount = lead.budget ? lead.budget.replace(/[^0-9]/g, "") : "";
  const [amount, setAmount] = useState(defaultAmount);
  const [date, setDate] = useState("");
  const [demandNote, setDemandNote] = useState(lead.note || (lead.intendedProduct ? `意向产品：${lead.intendedProduct}` : "线索转客户"));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await convertLeadToCustomer({
      leadId: lead.id,
      customerType,
      customerName,
      contactName: lead.contactName,
      contactPhone: lead.contactPhone,
      contactEmail: lead.contactEmail || undefined,
      contactTitle: lead.title || undefined,
      contactRoleTag,
      opportunityName,
      expectedAmount: amount ? Math.round(Number(amount) * 100) : 0,
      expectedCloseAt: date ? parseLocalDate(date) : new Date(),
      demandNote: demandNote || "线索转客户",
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onSuccess((result.data as { opportunityId: string }).opportunityId);
  }

  return (
    <ModalWrapper title="线索转客户" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">客户类型 *</label>
            <select value={customerType} onChange={(e) => setCustomerType(e.target.value as "ENTERPRISE" | "INDIVIDUAL")} className="w-full border rounded-lg p-2 bg-slate-50">
              <option value="ENTERPRISE">企业客户</option>
              <option value="INDIVIDUAL">个人客户</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">决策链角色</label>
            <select value={contactRoleTag} onChange={(e) => setContactRoleTag(e.target.value as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER")} className="w-full border rounded-lg p-2 bg-slate-50">
              <option value="DECISION_MAKER">最终决策人</option>
              <option value="TECH_EVALUATOR">技术评估人</option>
              <option value="PROCUREMENT">商务采购</option>
              <option value="USER">业务使用人</option>
              <option value="FINANCE">财务对接</option>
              <option value="OTHER">其他</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">{customerType === "ENTERPRISE" ? "企业全称 *" : "客户名称 *"}</label>
          <input required value={customerName} onChange={(e) => { setCustomerName(e.target.value); setOpportunityName(`${e.target.value}商机项目`); }} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div>
          <label className="block font-semibold mb-1">关联商机名称 *</label>
          <input required value={opportunityName} onChange={(e) => setOpportunityName(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">预估金额 (元)</label>
            <input type="number" placeholder="单位: 元" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded-lg p-2 font-mono bg-slate-50" />
          </div>
          <div>
            <label className="block font-semibold mb-1">预计成单日期</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">需求说明</label>
          <textarea rows={2} value={demandNote} onChange={(e) => setDemandNote(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="输入客户业务诉求与需求背景..." />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-emerald-700 text-white rounded-lg font-semibold">确认转客户</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ReschedulePanel({ taskId, dueAt, onCancel, onSubmit }: { taskId: string; dueAt: string; onCancel: () => void; onSubmit: (action: Promise<{ ok: true; data: unknown } | { ok: false; message: string }>) => Promise<boolean> }) {
  const [value, setValue] = useState(dateInputValue(dueAt));
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const ok = await onSubmit(rescheduleTaskAction({ taskId, dueAt: new Date(value) }));
    setPending(false);
    if (ok) onCancel();
  }

  return (
    <form className="mt-2 space-y-2" onSubmit={submit}>
      <input className="w-full text-xs border rounded p-1.5 bg-slate-50" type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="px-2 py-1 border rounded text-xs">取消</button>
        <button type="submit" disabled={pending} className="px-2 py-1 bg-slate-900 text-white rounded text-xs font-semibold">保存改约</button>
      </div>
    </form>
  );
}
