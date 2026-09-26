"use client";

import { useRef, useState, useTransition } from "react";
import {
  analyzeOpportunityDiagnosticAction,
  generateObjectionKillerAction,
} from "@/core/ai-copilot/actions";
import type {
  DealHealthLevel,
  ObjectionKillerScript,
  ObjectionType,
  OpportunityDiagnosticResult,
} from "@/core/ai-copilot/types";
import type { InsightListItem } from "@/core/insight/types";
import type { OpportunityStage } from "@/core/opportunity/types";

const HEALTH_CONFIG: Record<
  DealHealthLevel,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  STRONG: {
    label: "极佳 · 高胜率",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-500",
  },
  HEALTHY: {
    label: "稳健 · 节奏正常",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    dot: "bg-blue-500",
  },
  AT_RISK: {
    label: "预警 · 存在卡点",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-500",
  },
  CRITICAL: {
    label: "危险 · 严重停滞",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    dot: "bg-rose-500",
  },
};

const OBJECTIONS: Array<{ type: ObjectionType; label: string; desc: string }> = [
  { type: "PRICE_TOO_HIGH", label: "价格太贵 / 预算超支", desc: "重塑 ROI 与投资回报期" },
  { type: "PREFER_COMPETITOR", label: "正在看竞品 / 偏向竞品", desc: "差异化定位与场景破局" },
  { type: "NO_BUDGET", label: "没有预算 / 明年再看", desc: "拆解小步试点与轻量启动" },
  { type: "DELAYED_TIMING", label: "等等再看 / 不着急上", desc: "制造不作为的隐性成本" },
  { type: "NEED_INTERNAL_CONSENSUS", label: "内部还需要再讨论讨论", desc: "赋能内部支持者过会材料" },
];

const STAGE_PLAYBOOKS: Partial<Record<OpportunityStage, string>> = {
  DISCOVERY: "确认业务痛点、建立初步信任、摸清决策链架构 (EB/采购/技术) 与立项预算。",
  PROPOSAL: "针对核心卡点定制演示方案、测算 ROI 收益模型、树立产品差异化竞争壁垒。",
  NEGOTIATION: "商务条款谈判、底价与付款节点对齐、锁定上线排期与高层领导终审签批。",
};

export default function DealCopilotPanel({
  opportunityId,
  customerName,
  stage,
  isStalled = false,
  insights = [],
  onAcceptInsight,
  onDismissInsight,
  isInsightPending = false,
  isTerminal = false,
  isAiCopilotEnabled = true,
  onApplyToActivity,
  onTriggerIntervention,
}: {
  opportunityId: string;
  customerName?: string;
  stage?: OpportunityStage;
  isStalled?: boolean;
  insights?: InsightListItem[];
  onAcceptInsight?: (insight: InsightListItem) => void;
  onDismissInsight?: (insightId: string) => void;
  isInsightPending?: boolean;
  isTerminal?: boolean;
  isAiCopilotEnabled?: boolean;
  onApplyToActivity?: (script: string) => void;
  onTriggerIntervention?: (reason: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"DIAGNOSTIC" | "OBJECTION">("DIAGNOSTIC");
  const [diagnostic, setDiagnostic] = useState<OpportunityDiagnosticResult | null>(null);
  const [objectionResult, setObjectionResult] = useState<ObjectionKillerScript | null>(null);
  const [selectedObjection, setSelectedObjection] = useState<ObjectionType>("PRICE_TOO_HIGH");
  const [competitorName, setCompetitorName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  function handleRunDiagnostic() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await analyzeOpportunityDiagnosticAction(opportunityId);
      if (res.ok) {
        setDiagnostic(res.data);
      } else {
        setErrorMessage(res.message);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }

  function handleGenerateObjectionKiller() {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await generateObjectionKillerAction({
        objectionType: selectedObjection,
        competitorName: competitorName.trim() || undefined,
        targetName: customerName,
      });
      if (res.ok) {
        setObjectionResult(res.data);
        setTimeout(() => {
          resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 100);
      } else {
        setErrorMessage(res.message);
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  }

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden">
      {/* 1. 统一头部：智能决策与战法导航 */}
      <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 border border-indigo-100 text-indigo-600 shadow-2xs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-xs text-slate-900">智能决策导航</span>
                <span className="rounded bg-slate-100 text-slate-600 text-[10px] font-mono px-1.5 py-0.2 border border-slate-200/80">
                  MEDDICC
                </span>
              </div>
            </div>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">
            {stage ? `阶段: ${stage}` : "全周期"}
          </span>
        </div>
      </div>

      {/* 2. 独立分段式 Tab 控制器 */}
      {isAiCopilotEnabled && (
        <div className="border-b border-slate-100 bg-white px-3 py-2">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100/90 p-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("DIAGNOSTIC")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition-all ${
                activeTab === "DIAGNOSTIC"
                  ? "bg-white text-slate-900 shadow-2xs font-semibold"
                  : "text-slate-500 hover:text-slate-900 font-medium"
              }`}
            >
              <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>赢单诊断</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("OBJECTION")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs transition-all ${
                activeTab === "OBJECTION"
                  ? "bg-white text-slate-900 shadow-2xs font-semibold"
                  : "text-slate-500 hover:text-slate-900 font-medium"
              }`}
            >
              <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <span>异议攻坚</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. 错误提示条 */}
      {errorMessage && (
        <div className="mx-3 mt-3 p-2.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-lg font-medium flex items-center justify-between shadow-2xs">
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMessage}</span>
          </span>
          <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-600 hover:text-rose-800 font-bold ml-2">×</button>
        </div>
      )}

      {/* 4. Tab 1 内容区: 赢单诊断 */}
      {activeTab === "DIAGNOSTIC" && (
        <div className="p-3.5 space-y-3 text-xs">
          {/* 4.1 客观事实与规则质检区 */}
          <div className="space-y-2">
            {isStalled && (
              <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-2.5 text-xs text-rose-900 shadow-2xs space-y-1">
                <span className="font-semibold flex items-center gap-1.5 text-rose-900 text-[11px]">
                  <svg className="w-3.5 h-3.5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>阶段滞留预警 (SLA)</span>
                </span>
                <p className="text-[11px] text-rose-800 leading-relaxed">
                  当前阶段停留时长超出建议周期，请及时跟进推进。
                </p>
              </div>
            )}

            {insights.length > 0 ? (
              <div className="space-y-2">
                {insights.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-xs text-slate-800 shadow-2xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-amber-950 flex items-center gap-1 text-[11px]">
                        <span className="rounded bg-amber-200 px-1 py-0.2 text-[9px] text-amber-950 font-bold">
                          {item.severity === "HIGH_RISK" ? "高危" : "建议"}
                        </span>
                        <span>{item.title}</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{item.summary}</p>
                    {item.suggestedAction && (
                      <p className="text-[11px] font-medium text-amber-950">
                        动作：{item.suggestedAction}
                      </p>
                    )}
                    {!isTerminal && onAcceptInsight && onDismissInsight && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => onAcceptInsight(item)}
                          disabled={isInsightPending}
                          className="rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-slate-800 shadow-2xs"
                        >
                          采纳待办
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismissInsight(item.id)}
                          disabled={isInsightPending}
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                        >
                          忽略
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : !isStalled ? (
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/70 border border-slate-200/70 text-[11px] text-slate-600">
                <span className="flex items-center gap-1.5 font-medium text-emerald-800">
                  <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span>规则质检正常 · 推进节奏良好</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">0 风险</span>
              </div>
            ) : null}
          </div>

          {/* 4.2 AI 深度推演区 (仅在企业开启 AI 时展示) */}
          {isAiCopilotEnabled && (
            <>
              {!diagnostic ? (
                <div className="py-4 px-3 text-center space-y-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/40">
                  <div className="space-y-0.5 max-w-xs mx-auto">
                    <h4 className="font-semibold text-slate-800 text-xs">MEDDICC 智能推演</h4>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      评估商机健康度、卡点风险与最佳行动建议
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleRunDiagnostic}
                    className="inline-flex h-7 items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 text-[11px] font-semibold text-white shadow-2xs gap-1.5 transition disabled:opacity-60"
                  >
                    {isPending ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>正在推演...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>执行推演</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in pt-1">
                  {/* 引擎状态 & 重新分析操作栏 */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 text-[11px]">
                    <div>
                      {diagnostic.isCached ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200/80">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                          <span>命中缓存</span>
                        </span>
                      ) : diagnostic.isRealLlm ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          <span>在线 ({diagnostic.modelName})</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <span>规则引擎</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isPending}
                      onClick={handleRunDiagnostic}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 disabled:opacity-50 transition"
                    >
                      <svg className={`w-3 h-3 ${isPending ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      <span>{isPending ? "推演中..." : "重新推演"}</span>
                    </button>
                  </div>

                  {/* 核心指标双卡片 */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 shadow-2xs space-y-1">
                      <span className="text-slate-400 text-[10px] font-medium block">商机健康度</span>
                      <div>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                            HEALTH_CONFIG[diagnostic.dealHealth].bg
                          } ${HEALTH_CONFIG[diagnostic.dealHealth].text} ${
                            HEALTH_CONFIG[diagnostic.dealHealth].border
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_CONFIG[diagnostic.dealHealth].dot}`} />
                          <span>{HEALTH_CONFIG[diagnostic.dealHealth].label}</span>
                        </span>
                      </div>
                    </div>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 shadow-2xs space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                        <span>预测赢单概率</span>
                        <span className="font-mono font-bold text-slate-800 text-xs">
                          {diagnostic.winProbabilityPercent}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-200/80 h-1.5 rounded-full mt-1 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 rounded-full ${
                            diagnostic.winProbabilityPercent >= 70
                              ? "bg-emerald-500"
                              : diagnostic.winProbabilityPercent >= 40
                              ? "bg-indigo-600"
                              : "bg-amber-500"
                          }`}
                          style={{ width: `${diagnostic.winProbabilityPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4 大核心成交要素客观核验 */}
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-800">成交要素核验</span>
                      <span className="text-[10px] text-slate-400 font-mono">MEDDICC</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                      <div className="flex items-center gap-1.5 p-1.5 rounded bg-slate-50/80 border border-slate-100">
                        {diagnostic.positiveFactors.some((f) => f.includes("决策人") || f.includes("EB")) ? (
                          <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                        )}
                        <span className="text-slate-700">关键决策人 (EB)</span>
                      </div>

                      <div className="flex items-center gap-1.5 p-1.5 rounded bg-slate-50/80 border border-slate-100">
                        {diagnostic.positiveFactors.some((f) => f.includes("报价") || f.includes("SKU") || f.includes("产品明细")) ? (
                          <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                        )}
                        <span className="text-slate-700">报价方案 (SKU)</span>
                      </div>

                      <div className="flex items-center gap-1.5 p-1.5 rounded bg-slate-50/80 border border-slate-100">
                        {!diagnostic.riskFactors.some((f) => f.includes("停滞") || f.includes("未跟进")) ? (
                          <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                          </svg>
                        )}
                        <span className="text-slate-700">推进时效 (SLA)</span>
                      </div>

                      <div className="flex items-center gap-1.5 p-1.5 rounded bg-slate-50/80 border border-slate-100">
                        {diagnostic.positiveFactors.some((f) => f.includes("协同") || f.includes("主管")) ? (
                          <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        ) : (
                          <span className="inline-block w-3.5 h-3.5 rounded-full border border-slate-300 bg-slate-100 shrink-0" />
                        )}
                        <span className="text-slate-700">主管协同介入</span>
                      </div>
                    </div>
                  </div>

                  {/* 风险卡点与推进优势列表 */}
                  <div className="space-y-2">
                    {diagnostic.riskFactors.length > 0 && (
                      <div className="rounded-lg border border-rose-200/80 bg-rose-50/40 p-2.5 space-y-1">
                        <span className="font-semibold text-rose-900 text-[11px] flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>卡点风险 ({diagnostic.riskFactors.length})</span>
                        </span>
                        <ul className="space-y-0.5 text-[11px] text-rose-900 pl-1">
                          {diagnostic.riskFactors.map((r, i) => (
                            <li key={i} className="flex items-start gap-1 leading-relaxed">
                              <span className="text-rose-500 font-bold">•</span>
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {diagnostic.positiveFactors.length > 0 && (
                      <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/40 p-2.5 space-y-1">
                        <span className="font-semibold text-emerald-900 text-[11px] flex items-center gap-1">
                          <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>推进优势 ({diagnostic.positiveFactors.length})</span>
                        </span>
                        <ul className="space-y-0.5 text-[11px] text-emerald-900 pl-1">
                          {diagnostic.positiveFactors.map((p, i) => (
                            <li key={i} className="flex items-start gap-1 leading-relaxed">
                              <span className="text-emerald-500 font-bold">•</span>
                              <span>{p}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* 下一步最佳动作 (Next Best Action) 核心卡 */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 shadow-2xs space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-1.5 py-0.5">
                          推荐行动
                        </span>
                        <span className="font-bold text-slate-900 text-xs">
                          {diagnostic.nextBestAction.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(diagnostic.nextBestAction.suggestedScript, "nba")}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 shrink-0 px-1.5 py-0.5 rounded hover:bg-slate-100 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9 9 9 0 00-9 9m9 9.375a2.25 2.25 0 01-2.25-2.25V9.75a2.25 2.25 0 012.25-2.25h3.375" />
                        </svg>
                        <span>{copiedKey === "nba" ? "已复制" : "复制"}</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      <span className="font-medium text-slate-700">推进依据：</span>
                      {diagnostic.nextBestAction.reasoning}
                    </p>

                    <div className="p-3 bg-white text-slate-800 rounded-lg border border-slate-200 shadow-2xs font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap max-h-60 overflow-y-auto">
                      <div className="text-[10px] text-slate-400 font-sans mb-1.5 flex items-center gap-1 sticky top-0 bg-white/95 pb-1">
                        <svg className="w-3 h-3 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                        </svg>
                        <span>建议沟通话术</span>
                      </div>
                      {diagnostic.nextBestAction.suggestedScript}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {onApplyToActivity && (
                        <button
                          type="button"
                          onClick={() => onApplyToActivity(diagnostic.nextBestAction.suggestedScript)}
                          className="inline-flex h-7 items-center rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 shadow-2xs gap-1 transition cursor-pointer"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                          <span>引用话术</span>
                        </button>
                      )}
                      {onTriggerIntervention && (
                        <button
                          type="button"
                          onClick={() => onTriggerIntervention(diagnostic.nextBestAction.reasoning)}
                          className="inline-flex h-7 items-center rounded-md border border-amber-300 bg-amber-50 px-2.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 shadow-2xs gap-1 transition cursor-pointer"
                        >
                          <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>申请协同</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* 4.3 当前阶段标准作业指引 (作为打法基线一体化融入) */}
          {stage && STAGE_PLAYBOOKS[stage] && (
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
              <span className="text-slate-500 font-semibold shrink-0 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                </svg>
                <span>作业指引:</span>
              </span>
              <span>{STAGE_PLAYBOOKS[stage]}</span>
            </div>
          )}
        </div>
      )}

      {/* 5. Tab 2 内容区: 异议攻坚 */}
      {activeTab === "OBJECTION" && (
        <div className="p-3.5 space-y-3 text-xs">
          <div className="space-y-2.5">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                客户异议类型 <span className="text-rose-500">*</span>
              </label>
              <div className="space-y-1">
                {OBJECTIONS.map((o) => (
                  <button
                    key={o.type}
                    type="button"
                    onClick={() => setSelectedObjection(o.type)}
                    className={`w-full text-left p-2 rounded-lg border transition flex items-center justify-between cursor-pointer ${
                      selectedObjection === o.type
                        ? "border-indigo-600 bg-indigo-50/50 text-indigo-950"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-xs">{o.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{o.desc}</div>
                    </div>
                    <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                      selectedObjection === o.type ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                    }`}>
                      {selectedObjection === o.type && <div className="w-1 h-1 rounded-full bg-white" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {selectedObjection === "PREFER_COMPETITOR" && (
              <div className="animate-in fade-in">
                <label className="block font-semibold text-slate-700 mb-1 text-[11px]">
                  竞品厂商名称 (选填)
                </label>
                <input
                  type="text"
                  value={competitorName}
                  onChange={(e) => setCompetitorName(e.target.value)}
                  placeholder="如：Salesforce、用友、金蝶等"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-600 focus:outline-none shadow-2xs"
                />
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={isPending}
            onClick={handleGenerateObjectionKiller}
            className="inline-flex h-8 items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 shadow-2xs gap-1.5 w-full transition disabled:opacity-60 cursor-pointer"
          >
            {isPending ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>正在生成应对策略...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span>生成应对策略</span>
              </>
            )}
          </button>

          {objectionResult && (
            <div ref={resultRef} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-3 animate-in fade-in">
              <div className="border-b border-slate-100 pb-2.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-900 text-xs">
                    {objectionResult.objectionLabel}
                  </span>
                  {objectionResult.isCached ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                      <span>命中缓存</span>
                    </span>
                  ) : objectionResult.isRealLlm ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span>{objectionResult.provider}: {objectionResult.modelName}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                      <span>本地策略库</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-700 mt-2 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100 break-words whitespace-pre-wrap">
                  {objectionResult.pitchSummary}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  心理分析：{objectionResult.psychologyBreakdown}
                </p>
              </div>

              {/* 对话步骤卡片列表 */}
              <div className="space-y-2.5">
                {objectionResult.talkTracks.map((t) => (
                  <div key={t.stepNumber} className="rounded-lg bg-slate-50/80 p-3 border border-slate-200/70 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 text-[11px] flex items-center gap-1.5">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-white text-[9px] font-mono">
                          {t.stepNumber}
                        </span>
                        <span>{t.stepName}</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {onApplyToActivity && (
                          <button
                            type="button"
                            onClick={() => onApplyToActivity(t.suggestedTalk)}
                            className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline cursor-pointer"
                          >
                            引用话术
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopy(t.suggestedTalk, `step-${t.stepNumber}`)}
                          className="text-[10px] text-slate-500 hover:text-slate-800 font-medium px-1.5 py-0.5 rounded hover:bg-slate-200/60 transition cursor-pointer"
                        >
                          {copiedKey === `step-${t.stepNumber}` ? "已复制" : "复制"}
                        </button>
                      </div>
                    </div>
                    <div className="p-2.5 bg-white rounded-md border border-slate-200/80 font-mono text-[11px] text-slate-800 leading-relaxed break-words whitespace-pre-wrap max-h-56 overflow-y-auto">
                      {t.suggestedTalk}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-start gap-1 leading-relaxed">
                      <span className="font-semibold text-slate-600 shrink-0">核心要领:</span>
                      <span>{t.actionTip}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                完整战法库沉淀为企业知识库属闭源插件能力，开源版不含该入口。
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
