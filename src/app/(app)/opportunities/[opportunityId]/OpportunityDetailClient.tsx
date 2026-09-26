"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import { advanceStage, loseOpportunity, revertStage, transferOpportunity, updateOpportunity, winOpportunity } from "@/core/opportunity/actions";
import { logActivity, rescheduleTask } from "@/core/followup/actions";
import { getAssignableUsers } from "@/core/leads/actions";
import { acceptSalesInsight, dismissSalesInsight } from "@/core/insight/actions";
import { reviewWinReview } from "@/core/win-review/actions";
import { submitPlaybookFeedback } from "@/core/playbook/actions";
import type { InsightDismissReason, InsightListItem } from "@/core/insight/types";
import type { OpportunityDetail, OpportunityStage } from "@/core/opportunity/types";
import type { WinReview, WinReviewStatus } from "@/core/win-review/types";
import type { SalesPlaybookFeedback, SalesPlaybookRecommendation } from "@/core/playbook/types";
import { formatAmountInCents, stageLabel, taskLabel } from "@/core/shared/display";
import { Button } from "@/components/ui";
import { dateInputValue, formatDateOnly, localDateValue, parseLocalDate } from "@/core/shared/date";
import { dueAtError, initialDueAt } from "../../today/presentation";
import OpportunityLineItemsSection from "../OpportunityLineItemsSection";
import MaskedPhone from "@/core/security/MaskedPhone";
import { runDealAttributionAction } from "@/core/ai-hub/actions";
import type { OpportunityAttributionTrace } from "@/core/ai-hub/types";

const activeStages: OpportunityStage[] = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"];

const STAGE_STEPS: Array<{ key: OpportunityStage; label: string; desc: string }> = [
  { key: "DISCOVERY", label: "需求确认", desc: "明确痛点与采购意向" },
  { key: "PROPOSAL", label: "方案报价", desc: "方案汇报与产品明细核算" },
  { key: "NEGOTIATION", label: "商务谈判", desc: "条款协议与法务合同" },
];

export default function OpportunityDetailClient({
  initial,
  initialInsights,
  initialWinReview,
  initialPlaybookRecommendation,
  initialAttribution,
  canReviewWinReview,
  canTransfer,
  assignableUsers = [],
  pluginPanels,
}: {
  initial: OpportunityDetail;
  initialInsights: InsightListItem[];
  initialWinReview: WinReview | null;
  initialPlaybookRecommendation: SalesPlaybookRecommendation | null;
  initialAttribution?: OpportunityAttributionTrace | null;
  canReviewWinReview: boolean;
  canTransfer: boolean;
  assignableUsers?: Array<{ id: string; name: string; role?: string }>;
  pluginPanels?: ReactNode;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<string | null>(null);
  const [insights, setInsights] = useState(initialInsights);
  const [insightPanel, setInsightPanel] = useState<{ id: string; kind: "accept" | "dismiss" } | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightPending, startInsightTransition] = useTransition();

  // AI 归因分析状态
  const [attributionResult, setAttributionResult] = useState<OpportunityAttributionTrace | null>(initialAttribution || null);
  const [isAttributing, setIsAttributing] = useState(false);
  const [attributionError, setAttributionError] = useState<string | null>(null);
  const [attributionExpanded, setAttributionExpanded] = useState(true);

  const item = initial.opportunity;
  const terminal = item.stage === "WON" || item.stage === "LOST";

  const handleRunAttribution = async () => {
    setIsAttributing(true);
    setAttributionError(null);
    try {
      const res = await runDealAttributionAction(item.id);
      if (res.ok) {
        setAttributionResult({
          rounds: res.data.rounds,
          toolsUsed: res.data.toolsUsed,
          evidenceCount: res.data.evidenceCount,
          outcome: res.data.outcome,
          direction: res.data.direction,
          createdAt: new Date().toISOString(),
        });
        setAttributionExpanded(true);
      } else {
        setAttributionError(res.message);
      }
    } catch (err) {
      setAttributionError(err instanceof Error ? err.message : "归因分析失败");
    } finally {
      setIsAttributing(false);
    }
  };

  const refresh = () => {
    setPanel(null);
    router.refresh();
  };

  function openMenuPanel(event: MouseEvent<HTMLButtonElement>, nextPanel: string) {
    setPanel(nextPanel);
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  function completeInsight(id: string) {
    setInsights((current) => current.filter((insight) => insight.id !== id));
    setInsightPanel(null);
    setInsightError(null);
    router.refresh();
  }

  const currentStageIndex = (activeStages as readonly string[]).includes(item.stage)
    ? (activeStages as readonly string[]).indexOf(item.stage)
    : item.stage === "WON"
    ? 99
    : -1;

  return (
    <div className="space-y-6">
      {/* 1. 面包屑与顶部导航 */}
      <div className="flex items-center justify-between">
        <Link
          href="/opportunities"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回商机管理
        </Link>
        <span className="text-xs text-slate-400 font-mono">商机 ID: {item.id.slice(0, 8)}...</span>
      </div>

      {/* 2. 页面主头部与操作栏 */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                {stageLabel(item.stage)}
              </span>
              {item.isStalled && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                  推进停滞 (&gt;14天未活动)
                </span>
              )}
              {item.stage === "WON" && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  已赢单结案
                </span>
              )}
              {item.stage === "LOST" && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                  已输单归档
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-slate-950 mt-2">
              {item.name}
            </h1>

            <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
              <span>客户主体:</span>
              <Link href={`/customers/${item.customerId}`} className="font-semibold text-blue-600 hover:underline">
                {item.customerName}
              </Link>
              <span>·</span>
              <span>负责人: <strong className="text-slate-800">{item.ownerName}</strong></span>
              {item.sourceLead && (
                <>
                  <span>·</span>
                  <span>来源线索:</span>
                  <Link href={`/leads/${item.sourceLead.id}`} className="font-semibold text-blue-600 hover:underline">
                    {item.sourceLead.name}
                  </Link>
                </>
              )}
            </div>
          </div>

          {!terminal ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setPanel(panel === "activity" ? null : "activity")}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
              >
                记录跟进
              </button>
              <button
                onClick={() => setPanel(panel === "edit" ? null : "edit")}
                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
              >
                编辑信息
              </button>
              {item.stage !== "NEGOTIATION" ? (
                <button
                  onClick={() => setPanel(panel === "advance" ? null : "advance")}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  推进下一阶段 →
                </button>
              ) : (
                <button
                  onClick={() => setPanel(panel === "win" ? null : "win")}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  赢单结案 (Won)
                </button>
              )}

              <details className="relative">
                <summary className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs cursor-pointer list-none">
                  更多 ▾
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg text-xs space-y-1">
                  {item.stage !== "DISCOVERY" && (
                    <button
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                      onClick={(e) => openMenuPanel(e, "revert")}
                    >
                      回退上一阶段
                    </button>
                  )}
                  {item.openTaskId && (
                    <button
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                      onClick={(e) => openMenuPanel(e, "reschedule")}
                    >
                      调整待办时效
                    </button>
                  )}
                  {canTransfer && (
                    <button
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                      onClick={(e) => openMenuPanel(e, "transfer")}
                    >
                      转移商机归属
                    </button>
                  )}
                  <button
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 font-medium"
                    onClick={(e) => openMenuPanel(e, "lost")}
                  >
                    输单结案 (Lost)
                  </button>
                </div>
              </details>
            </div>
          ) : item.stage === "WON" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                商机已赢单结案 (WON)
              </span>
              <span className="text-[11px] text-slate-500">
                合同 / 订单 / 项目协同为闭源插件能力，开源版不含该入口。
              </span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">该商机已输单结案，历史记录受审计保护。</div>
          )}
        </div>

        {/* 3. 经典阶段推进步进条 */}
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-2.5">
          <div className="grid grid-cols-3 gap-2">
            {STAGE_STEPS.map((s, idx) => {
              const isCurrent = item.stage === s.key;
              const stageIndex = (activeStages as readonly string[]).indexOf(s.key);
              const isPassed = currentStageIndex > stageIndex;

              return (
                <div
                  key={s.key}
                  className={`py-2 px-3 rounded-lg text-center text-xs transition-all ${
                    isCurrent
                      ? "bg-slate-900 text-white shadow-xs font-bold"
                      : isPassed
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium"
                      : "bg-white border border-slate-200 text-slate-400"
                  }`}
                >
                  <div className="text-[10px] opacity-70 font-mono">第 {idx + 1} 阶段</div>
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-[10px] opacity-60 hidden sm:block mt-0.5">{s.desc}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 弹窗动作区域 */}
      {panel === "edit" && <EditForm item={item} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "advance" && <StageForm opportunityId={item.id} from={item.stage} direction="advance" onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "revert" && <StageForm opportunityId={item.id} from={item.stage} direction="revert" onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "activity" && <ActivityForm opportunityId={item.id} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "win" && <WinForm opportunityId={item.id} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "lost" && <LostForm opportunityId={item.id} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "transfer" && (
        <TransferForm
          opportunityId={item.id}
          currentOwnerUserId={item.ownerUserId}
          currentOwnerName={item.ownerName}
          customerName={item.customerName}
          customerOwnerName={item.customerOwnerName || item.ownerName}
          assignableUsers={assignableUsers}
          onCancel={() => setPanel(null)}
          onDone={refresh}
        />
      )}

      {/* 4. 推进健康度概览条 */}
      <OpportunityHealthSummary insights={insights} />

      {/* 5. 智能洞察与推进雷达 */}
      <OpportunityInsights
        canAct={!terminal}
        error={insightError}
        insights={insights}
        openPanel={insightPanel}
        pending={insightPending}
        onOpen={(id, kind) => {
          setInsightError(null);
          setInsightPanel((current) => (current?.id === id && current.kind === kind ? null : { id, kind }));
        }}
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

      {/* 6. 两栏核心主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* 卡片 1：商机核心档案 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900">商机核心要素与需求</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-slate-400 font-medium">预估商机总额</div>
                <div className="text-xl font-bold font-mono text-blue-600 mt-0.5">
                  {formatAmount(item.expectedAmount)}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <div className="text-slate-400 font-medium">预计结单日期</div>
                <div className="text-base font-semibold text-slate-800 mt-0.5">
                  {item.expectedCloseAt ? formatDateOnly(item.expectedCloseAt) : "未填写"}
                </div>
              </div>
              <div>
                <span className="text-slate-400">阶段进入时间：</span>
                <span className="font-medium text-slate-800">{formatDate(item.stageEnteredAt)}</span>
              </div>
              <div>
                <span className="text-slate-400">客户主决策人：</span>
                <span className="font-semibold text-slate-800 inline-flex items-center gap-1">
                  <span>{item.primaryContactName || "未指定"}</span>
                  {item.contactPhone && (
                    <span className="text-slate-400 font-normal">
                      (<MaskedPhone phone={item.contactPhone} entityType="CUSTOMER"
                      reason="商机详情页推进前核对联系方式" entityId={item.customerId} />)
                    </span>
                  )}
                </span>
              </div>
              <div className="sm:col-span-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-slate-500 font-semibold text-xs">商机核心诉求与交付范围：</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {item.demandNote ? `${item.demandNote.length} 字` : "未录入"}
                  </span>
                </div>
                {item.demandNote ? (
                  <div className="p-3.5 bg-slate-50/90 rounded-xl border border-slate-200/80 border-l-4 border-l-indigo-500 text-xs text-slate-800 leading-relaxed break-words whitespace-pre-wrap shadow-2xs font-normal">
                    {item.demandNote}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-400 text-center">
                    暂未录入具体需求说明，点击右上角【编辑资料】补充
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* 卡片 2：商机产品与报价明细挂载 */}
          <OpportunityLineItemsSection
            opportunityId={item.id}
            isTerminal={terminal}
            onTotalUpdated={() => refresh()}
          />

          {/* 卡片 3：推荐销售打法赋能 */}
          {initialPlaybookRecommendation && (
            <PlaybookRecommendationSection
              key={`${initialPlaybookRecommendation.playbook.id}:${initialPlaybookRecommendation.currentUserFeedback?.updatedAt ?? "new"}`}
              opportunityId={item.id}
              recommendation={initialPlaybookRecommendation}
            />
          )}

          {/* 卡片 4：赢单复盘 */}
          {item.stage === "WON" && (
            <WinReviewSection review={initialWinReview} canReview={canReviewWinReview} />
          )}
        </div>

        {/* 右侧边栏：健康度与任务 */}
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 flex items-center justify-between">
              <span>待办任务与推进节奏</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            </h3>
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex justify-between">
                <span className="text-slate-400">当前任务类型</span>
                <span className="font-semibold text-slate-800">
                  {item.openTaskType ? taskLabel(item.openTaskType) : "暂无待办"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">任务截止时间</span>
                <span className="font-mono text-slate-800">
                  {item.openTaskDueAt ? formatDate(item.openTaskDueAt) : "无"}
                </span>
              </div>
              {item.openTaskId && !terminal && panel === "reschedule" && (
                <Reschedule
                  key={`${item.openTaskId}-${item.openTaskDueAt}`}
                  taskId={item.openTaskId}
                  dueAt={item.openTaskDueAt!}
                  onDone={refresh}
                />
              )}
            </div>
          </section>

          {terminal && (
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900">结案审计信息</h3>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200">
                    AI 生成
                  </span>
                  <Button variant="primary" size="xs" disabled={isAttributing} onClick={handleRunAttribution} className="gap-1.5">
                    {isAttributing ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>正在归因分析...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>AI 归因分析</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                {item.stage === "WON" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-400">实际成交金额</span>
                      <span className="font-bold font-mono text-emerald-600">{formatAmount(item.actualAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">成交结单时间</span>
                      <span className="font-mono">{item.actualCloseAt ? formatDateOnly(item.actualCloseAt) : "未填写"}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-400">丢单根因</span>
                      <span className="font-semibold text-red-600">{item.lostReason || "未填写"}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">丢单说明：</span>
                      <p className="mt-1 p-2 bg-slate-50 rounded text-slate-700 border border-slate-100">
                        {item.lostNote || "未填写说明"}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {attributionError && (
                <div className="bg-rose-50 text-rose-700 text-xs p-3 rounded-lg border border-rose-200">
                  {attributionError}
                </div>
              )}

              {attributionResult && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">AI 因果归因报告 (L1)</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono">
                        证据引用: {attributionResult.evidenceCount} 项事实来源
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttributionExpanded(!attributionExpanded)}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1"
                    >
                      <span>{attributionExpanded ? "收起报告" : "展开报告"}</span>
                      <svg
                        className={`w-3 h-3 transition-transform ${attributionExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {attributionExpanded && (
                    <div className="mt-2 bg-slate-50/90 rounded-xl p-3.5 text-xs text-slate-800 font-sans whitespace-pre-wrap leading-relaxed border border-slate-200/90 space-y-2">
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-500 pb-2 border-b border-slate-200/60 font-mono">
                        <span>轮数: {attributionResult.rounds}</span>
                        <span>·</span>
                        <span>工具: {attributionResult.toolsUsed.join(", ") || "无"}</span>
                      </div>
                      <div className="pt-1">{attributionResult.outcome}</div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {pluginPanels}
        </div>
      </div>
    </div>
  );
}

function OpportunityHealthSummary({ insights }: { insights: InsightListItem[] }) {
  const highest = insights[0];
  const label = highest?.severity === "HIGH_RISK" ? "高风险" : highest?.severity === "ATTENTION" ? "需关注" : highest ? "提示" : "健康";
  const tone = highest?.severity === "HIGH_RISK" ? "bg-red-50 text-red-800 border border-red-200" : highest?.severity === "ATTENTION" ? "bg-amber-50 text-amber-800 border border-amber-200" : highest ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-800 border border-emerald-200";

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs text-xs flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-0.5 rounded-full font-bold ${tone}`}>{label}</span>
        {highest ? (
          <div>
            <span className="font-semibold text-slate-900">AI 推进判断：{highest.title}</span>
            <span className="text-slate-500 ml-2 hidden sm:inline">下一步建议：{highest.suggestedAction}</span>
          </div>
        ) : (
          <span className="text-slate-500">商机推进节奏健康，暂无超时风险。</span>
        )}
      </div>
      {insights.length > 1 && (
        <span className="text-slate-400 font-mono">另有 {insights.length - 1} 条建议</span>
      )}
    </section>
  );
}

const insightDismissReasons: Array<[InsightDismissReason, string]> = [
  ["NOT_APPLICABLE", "不适用"],
  ["ALREADY_HANDLED", "已处理"],
  ["WRONG_INFORMATION", "信息错误"],
  ["OTHER", "其他"],
];

function OpportunityInsights({
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
          <div key={insight.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-900 text-sm">{insight.title}</div>
              <span className="px-2 py-0.5 rounded text-[10px] bg-red-100 text-red-800 font-semibold">
                {insight.severity === "HIGH_RISK" ? "高风险" : "需关注"}
              </span>
            </div>
            <p className="text-slate-600">{insight.summary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 bg-white rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-400">下一步动作：</span>
                <span className="font-semibold text-slate-800">{insight.suggestedAction}</span>
              </div>
              <div>
                <span className="text-slate-400">建议截止：</span>
                <span className="font-mono">{insight.suggestedDueAt ? formatDate(insight.suggestedDueAt) : "未指定"}</span>
              </div>
            </div>

            {canAct && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onOpen(insight.id, "accept")}
                  className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
                >
                  采纳并建任务
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

            {openPanel?.id === insight.id && openPanel.kind === "accept" && (
              <InsightAcceptPanel
                insight={insight}
                pending={pending}
                error={error}
                onCancel={onCancel}
                onSubmit={(dueAt) => onAccept(insight.id, dueAt)}
              />
            )}
            {openPanel?.id === insight.id && openPanel.kind === "dismiss" && (
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
      <label className="block text-xs font-semibold text-slate-700">
        确认跟进截止时间 *
      </label>
      <input
        required
        type="datetime-local"
        min={initialDueAt(null)}
        value={dueAt}
        onChange={(e) => setDueAt(e.target.value)}
        className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-slate-50"
      />
      {(validationError || error) && <p className="text-xs text-red-600">{validationError || error}</p>}
      <div className="flex gap-2 justify-end pt-2">
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
      <label className="block text-xs font-semibold text-slate-700">忽略原因</label>
      <select value={reason} onChange={(e) => setReason(e.target.value as InsightDismissReason)} className="w-full text-xs border rounded p-1.5 bg-slate-50">
        {insightDismissReasons.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1 text-xs border rounded">取消</button>
        <button type="submit" disabled={pending} className="px-3 py-1 text-xs bg-slate-900 text-white rounded font-semibold">确认忽略</button>
      </div>
    </form>
  );
}

// 模态弹窗组件
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

function EditForm({ item, onCancel, onDone }: { item: OpportunityDetail["opportunity"]; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(() =>
    item.expectedAmount ? (Number(item.expectedAmount) / 100).toString() : "",
  );
  const [date, setDate] = useState(item.expectedCloseAt?.slice(0, 10) ?? "");
  const [note, setNote] = useState(item.demandNote || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await updateOpportunity({
      opportunityId: item.id,
      name,
      expectedAmount: amount === "" ? undefined : Math.round(Number(amount) * 100),
      expectedCloseAt: date ? parseLocalDate(date) : undefined,
      demandNote: note || undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="编辑商机信息" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">商机名称 *</label>
          <input className="w-full border rounded-lg p-2 bg-slate-50" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">预估金额 (元)</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50 font-mono" type="number" min="0" placeholder="例如：50000" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">预计结单日</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block font-semibold">商机核心诉求与交付范围</label>
            <span className="text-[10px] text-slate-400 font-mono">
              {note.length}/500 字
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={500}
            className="w-full border border-slate-200 rounded-xl p-3 bg-white text-xs leading-relaxed text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs resize-y min-h-[96px] placeholder:text-slate-400"
            placeholder="明确客户核心痛点、预期上线时间、预算范围与核心考核指标 (如：对接内部 ERP、需在 Q3 前完成培训交付)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存修改</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function StageForm({ opportunityId, from, direction, onCancel, onDone }: { opportunityId: string; from: OpportunityStage; direction: "advance" | "revert"; onCancel: () => void; onDone: () => void }) {
  const index = activeStages.indexOf(from);
  const to = activeStages[index + (direction === "advance" ? 1 : -1)];
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = direction === "advance"
      ? await advanceStage({ opportunityId, fromStage: from, toStage: to, note })
      : await revertStage({ opportunityId, fromStage: from, toStage: to, note });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title={direction === "advance" ? `推进到「${stageLabel(to)}」` : `回退到「${stageLabel(to)}」`} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">推进阶段纪要与关键结论 *</label>
          <textarea rows={3} required maxLength={200} placeholder="请填写推进至该阶段的关键事实依据..." value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">确认流转</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ActivityForm({ opportunityId, onCancel, onDone }: { opportunityId: string; onCancel: () => void; onDone: () => void }) {
  const [type, setType] = useState("CALL");
  const [outcome, setOutcome] = useState("CONNECTED");
  const [summary, setSummary] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await logActivity({
      opportunityId,
      type: type as "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE",
      outcome: type === "NOTE" ? undefined : (outcome as "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED"),
      summary,
      nextFollowUpAt: next ? new Date(next) : undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="记录商机跟进活动" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">跟进方式</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
              <option value="CALL">电话沟通</option>
              <option value="MEETING">会议汇报</option>
              <option value="VISIT">上门拜访</option>
              <option value="MESSAGE">微信/短信</option>
              <option value="NOTE">内部备忘</option>
            </select>
          </div>
          {type !== "NOTE" && (
            <div>
              <label className="block font-semibold mb-1">沟通结果</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
                <option value="CONNECTED">已接通沟通</option>
                <option value="INTERESTED">客户极有意向</option>
                <option value="NO_ANSWER">未接通/待回呼</option>
                <option value="REFUSED">明确拒绝</option>
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="block font-semibold mb-1">跟进纪要 *</label>
          <input required maxLength={200} placeholder="填写核心沟通事实与结论..." value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div>
          <label className="block font-semibold mb-1">预约下次跟进时间</label>
          <input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存跟进</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function TransferForm({
  opportunityId,
  currentOwnerUserId,
  currentOwnerName,
  customerOwnerName,
  assignableUsers = [],
  onCancel,
  onDone,
}: {
  opportunityId: string;
  currentOwnerUserId?: string;
  currentOwnerName: string;
  customerName?: string;
  customerOwnerName?: string;
  assignableUsers?: Array<{ id: string; name: string; role?: string }>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [users, setUsers] = useState<Array<{ id: string; name: string; role?: string }>>(assignableUsers);
  const [searchQuery, setSearchQuery] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("MULTI_PRODUCT_COLLAB");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (assignableUsers.length === 0) {
      getAssignableUsers().then((res) => {
        if (res.ok && res.data) setUsers(res.data);
      });
    }
  }, [assignableUsers]);

  const filteredUsers = users.filter((u) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return u.name.toLowerCase().includes(q) || (u.role && u.role.toLowerCase().includes(q));
  });

  const selectedUser = users.find((u) => u.id === toUserId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending || !toUserId) return;
    setPending(true);
    setError("");
    const result = await transferOpportunity({
      opportunityId,
      toOwnerUserId: toUserId,
      reason,
      note: note.trim() || undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="转移商机归属" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3.5 text-xs">
        {/* 权责变动确认卡 */}
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
                <strong className="text-slate-800">{currentOwnerName}</strong>
                {" → "}
                <strong className="text-indigo-700">{selectedUser ? selectedUser.name : "请选择新负责人"}</strong>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">客户主档归属：</span>
              <span className="font-medium text-slate-700">
                保持不变（归属 {customerOwnerName || "原客户负责人"}）
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">未完成跟进待办：</span>
              <span className="font-medium text-emerald-700">自动改派至新负责人</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="font-semibold text-slate-800">目标负责人 *</label>
            {users.length > 5 && (
              <span className="text-[11px] text-slate-400">共 {users.length} 位在职成员</span>
            )}
          </div>

          {users.length > 5 && (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入姓名过滤成员..."
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50 text-xs mb-1.5 focus:bg-white focus:outline-none focus:border-slate-900"
            />
          )}

          <select
            required
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="w-full border border-slate-200 rounded-lg p-2.5 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:border-slate-900"
          >
            <option value="">请选择目标负责人...</option>
            {filteredUsers.map((u) => {
              const isCurrent = u.id === currentOwnerUserId || u.name === currentOwnerName;
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
          <label className="block font-semibold mb-1 text-slate-800">转移原因 *</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-slate-200 rounded-lg p-2 bg-slate-50 text-xs focus:bg-white focus:outline-none focus:border-slate-900"
          >
            <option value="MULTI_PRODUCT_COLLAB">多产品线协同分派（不同产品线由不同销售负责）</option>
            <option value="REORG_DEAL">团队岗位调整 / 离职交接</option>
            <option value="REASSIGN">主管重新调配</option>
            <option value="CUSTOMER_REQUEST">客户指定更换跟进人</option>
            <option value="OTHER">其他原因</option>
          </select>
        </div>

        <div>
          <label className="block font-semibold mb-1 text-slate-800">交接说明 / 备注</label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充转移动因或交接注意事项（选填，同步记录至审计留痕）..."
            className="w-full border border-slate-200 rounded-lg p-2.5 bg-slate-50 text-xs leading-relaxed focus:bg-white focus:outline-none focus:border-slate-900"
          />
        </div>

        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-3.5 py-1.5 border border-slate-200 rounded-lg text-xs hover:bg-slate-50 font-medium">
            取消
          </button>
          <button
            type="submit"
            disabled={pending || !toUserId || toUserId === currentOwnerUserId}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg font-semibold text-xs hover:bg-slate-800 disabled:opacity-50 transition"
          >
            {pending ? "转移中..." : "确认转移"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function WinForm({ opportunityId, onCancel, onDone }: { opportunityId: string; onCancel: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => localDateValue(new Date()));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const actualAmount = Math.round(Number(amount) * 100);
    setPending(true);
    const result = await winOpportunity({ opportunityId, actualAmount, actualCloseAt: parseLocalDate(date) });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="赢单结案确认 (Won)" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">最终实际签约金额 (元) *</label>
          <input required type="number" min="0" placeholder="例如：124000" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded-lg p-2 font-mono bg-slate-50" />
        </div>
        <div>
          <label className="block font-semibold mb-1">签约成交日期 *</label>
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold">确认赢单</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function LostForm({ opportunityId, onCancel, onDone }: { opportunityId: string; onCancel: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("PRICE");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await loseOpportunity({ opportunityId, reason: reason as "PRICE" | "COMPETITOR" | "NO_BUDGET" | "NO_DECISION" | "TIMING" | "OTHER", note: note || undefined });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="记录输单归档 (Lost)" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">输单主要根因 *</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
            <option value="PRICE">价格偏高 / 预算不符</option>
            <option value="COMPETITOR">客户选择了竞品</option>
            <option value="NO_BUDGET">项目预算被取消</option>
            <option value="NO_DECISION">客户内部暂缓立项</option>
            <option value="TIMING">采购时机不成熟</option>
            <option value="OTHER">其他原因</option>
          </select>
        </div>
        <div>
          <label className="block font-semibold mb-1">详细丢单归因说明</label>
          <textarea rows={3} required={reason === "OTHER"} placeholder="总结失败教训与竞品优劣势，反哺团队打法库..." value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-semibold">确认输单</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function Reschedule({ taskId, dueAt, onDone }: { taskId: string; dueAt: string; onDone: () => void }) {
  const [value, setValue] = useState(dateInputValue(dueAt));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await rescheduleTask({ taskId, dueAt: new Date(value) });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <form className="mt-3 space-y-2" onSubmit={submit}>
      <input className="w-full text-xs border rounded p-1.5 bg-slate-50" type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button className="w-full px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" disabled={pending}>
        {pending ? "保存中" : "确认改约"}
      </button>
    </form>
  );
}

function formatAmount(value: string | null) {
  return formatAmountInCents(value, "金额未填写");
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WinReviewSection({
  review,
  canReview,
}: {
  review: WinReview | null;
  canReview: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Extract<WinReviewStatus, "REVIEWED" | "REJECTED">>("REVIEWED");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!review) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-2">
        <h2 className="text-sm font-bold text-slate-900">赢单复盘与打法沉淀</h2>
        <p className="text-xs text-slate-400">复盘草稿正在生成中，请稍后刷新查看。</p>
      </section>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await reviewWinReview({ winReviewId: review!.id, status, reason });
    setPending(false);
    if (!result.ok) setError(result.message);
    else router.refresh();
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-900">赢单复盘与证据沉淀</h2>
        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
          {review.status === "REVIEWED" ? "主管已确认" : review.status === "REJECTED" ? "已退回" : "待主管审核"}
        </span>
      </div>

      <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed">
        {review.summary || "暂无复盘摘要"}
      </p>

      {review.status === "DRAFT" && canReview && (
        <form onSubmit={submit} className="p-3 border border-purple-200 rounded-xl bg-purple-50/50 space-y-3 text-xs">
          <div className="font-semibold text-purple-900">主管审核打法价值</div>
          <div className="grid grid-cols-2 gap-2">
            <select value={status} onChange={(e) => setStatus(e.target.value as "REVIEWED" | "REJECTED")} className="border rounded p-1.5 text-xs bg-white">
              <option value="REVIEWED">确认复盘 (纳入打法证据库)</option>
              <option value="REJECTED">退回复盘</option>
            </select>
            <input required placeholder="填写审核评语与提炼要点..." value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded p-1.5 text-xs bg-white" />
          </div>
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-semibold">
              {pending ? "提交中..." : "提交审核结论"}
            </button>
          </div>
        </form>
      )}

      {review.status === "REVIEWED" && (
        <p className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
          已通过主管审核，复盘结论已纳入打法证据库。
        </p>
      )}
    </section>
  );
}

export function PlaybookRecommendationSection({
  opportunityId,
  recommendation,
}: {
  opportunityId: string;
  recommendation: SalesPlaybookRecommendation;
}) {
  const [verdict, setVerdict] = useState<SalesPlaybookFeedback["verdict"]>(recommendation.currentUserFeedback?.verdict ?? "HELPFUL");
  const [reason, setReason] = useState(recommendation.currentUserFeedback?.reason ?? "");
  const [currentFeedback, setCurrentFeedback] = useState<SalesPlaybookFeedback | null>(recommendation.currentUserFeedback);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  const playbook = recommendation.playbook;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    const result = await submitPlaybookFeedback({ opportunityId, playbookId: playbook.id, verdict, reason: reason || undefined });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setCurrentFeedback(result.data);
    setVerdict(result.data.verdict);
    setReason(result.data.reason ?? "");
    setMessage("反馈已保存，感谢您的建议！");
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900">推荐实战销售打法</h2>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          基于 {playbook.sampleIds.length} 个结案样本
        </span>
      </div>

      <div>
        <h3 className="font-bold text-slate-900 text-sm">
          {playbook.name} <span className="font-mono text-xs text-slate-400 font-normal">(v{playbook.version}.0)</span>
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          根据当前客户行业与商机阶段精准匹配，提供标准化攻坚动作与避坑要点
        </p>
      </div>

      {/* 适用边界 */}
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <span className="text-slate-400">目标阶段：</span>
          <span className="font-semibold text-slate-800">{stageLabel(playbook.targetStage)}</span>
        </div>
        <div>
          <span className="text-slate-400">适用行业：</span>
          <span className="font-semibold text-slate-800">{playbook.applicableIndustries.join("、") || "不限"}</span>
        </div>
        <div>
          <span className="text-slate-400">适用地区：</span>
          <span className="font-semibold text-slate-800">{playbook.applicableRegions.join("、") || "不限"}</span>
        </div>
        <div>
          <span className="text-slate-400">适用规模：</span>
          <span className="font-semibold text-slate-800">{playbook.applicableCustomerSizes.join("、") || "不限"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="p-3 bg-blue-50/40 rounded-xl border border-blue-100 space-y-1">
          <div className="font-bold text-blue-900">核心检查点</div>
          <ul className="space-y-1 text-slate-700">
            {playbook.checkpoints.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-blue-500 font-bold">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 bg-purple-50/40 rounded-xl border border-purple-100 space-y-1">
          <div className="font-bold text-purple-900">推进节奏建议</div>
          <ul className="space-y-1 text-slate-700">
            {playbook.recommendedCadence.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-purple-500 font-bold">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 bg-emerald-50/40 rounded-xl border border-emerald-100 space-y-1">
          <div className="font-bold text-emerald-900">关键有效动作</div>
          <ul className="space-y-1 text-slate-700">
            {playbook.effectiveActions.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-emerald-500 font-bold">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-3 bg-amber-50/40 rounded-xl border border-amber-100 space-y-1">
          <div className="font-bold text-amber-900">常见失误与风险防范</div>
          <ul className="space-y-1 text-slate-700">
            {playbook.commonRisks.map((c, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-amber-500 font-bold">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-xs">
        <span className="font-semibold text-slate-700">打法实战反馈：</span>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value as SalesPlaybookFeedback["verdict"])} className="border rounded-lg px-2.5 py-1.5 text-xs bg-slate-50">
          <option value="HELPFUL">非常有帮助</option>
          <option value="NOT_HELPFUL">帮助不大</option>
          <option value="NOT_APPLICABLE">当前情况不适用</option>
        </select>
        <input placeholder="补充反馈理由 (可选)..." value={reason} onChange={(e) => setReason(e.target.value)} className="border rounded-lg px-2.5 py-1.5 text-xs flex-1 min-w-40 bg-slate-50" />
        <button type="submit" disabled={pending} className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800">
          {pending ? "提交中..." : currentFeedback ? "更新反馈" : "提交反馈"}
        </button>
      </form>
      {message && <p className="text-xs text-emerald-600">{message}</p>}
    </section>
  );
}
