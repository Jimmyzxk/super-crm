"use client";

import { Button, Badge } from "@/components/ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MorningRecommendationItem } from "@/core/ai-hub/morning-copilot-service";
import {
  applyMorningRecommendationAction,
  dismissMorningRecommendationAction,
  listMyRecentRecommendationsAction,
} from "@/core/ai-hub/actions";

interface MorningCopilotCardClientProps {
  initialRecommendations: MorningRecommendationItem[];
}

export default function MorningCopilotCardClient({
  initialRecommendations,
}: MorningCopilotCardClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<MorningRecommendationItem[]>(initialRecommendations);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 近 7 天建议回顾展开状态
  const [showHistory, setShowHistory] = useState(false);
  const [historyItems, setHistoryItems] = useState<MorningRecommendationItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleToggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && historyItems.length === 0) {
      setLoadingHistory(true);
      try {
        const res = await listMyRecentRecommendationsAction(7);
        if (res.ok) {
          setHistoryItems(res.data);
        }
      } finally {
        setLoadingHistory(false);
      }
    }
  };

  const handleApply = (item: MorningRecommendationItem) => {
    startTransition(async () => {
      const res = await applyMorningRecommendationAction(item.id);
      if (res.ok) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, isApplied: true, feedbackVerdict: "HELPFUL" } : i))
        );
        setFeedbackMsg(`已采纳建议并记录至学习飞轮：${item.title}`);
        setTimeout(() => setFeedbackMsg(null), 4000);

        // 如果建议包含关联 ID，可根据动作跳转
        const payload = item.suggestedAction.payload;
        if (payload?.opportunityId) {
          router.push(`/opportunities/${payload.opportunityId}`);
        } else if (payload?.leadId) {
          router.push(`/leads/${payload.leadId}`);
        } else if (payload?.customerId) {
          router.push(`/customers/${payload.customerId}`);
        }
      }
    });
  };

  const handleDismiss = (item: MorningRecommendationItem) => {
    startTransition(async () => {
      const res = await dismissMorningRecommendationAction(item.id, "销售标记不适用");
      if (res.ok) {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, isApplied: false, feedbackVerdict: "NOT_APPLICABLE" } : i))
        );
        setFeedbackMsg(`已标记忽略：${item.title}`);
        setTimeout(() => setFeedbackMsg(null), 3000);
      }
    });
  };

  if (items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-900 shadow-xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <span>AI 晨会副驾驶 · 今日三件事</span>
                <Badge variant="emerald" size="sm">资产状态健康</Badge>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                今日名下商机、线索与待办运转良好，暂无停滞或超期卡点，保持高效推进！
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleHistory}
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-800 flex items-center gap-1 bg-white/80 px-2.5 py-1 rounded-lg border border-indigo-100 shadow-2xs"
          >
            <span>近 7 天回顾</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {showHistory && (
          <div className="pt-3 border-t border-indigo-100/70 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">本人近 7 天晨会建议履约与回顾</span>
              <span className="text-[10px] text-slate-400">已沉淀至 AI 飞轮</span>
            </div>

            {loadingHistory ? (
              <div className="py-4 text-center text-xs text-slate-400">
                正在加载历史建议...
              </div>
            ) : historyItems.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-400 bg-white/60 rounded-xl border border-slate-100">
                近 7 天暂无历史建议记录
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {historyItems.map((h) => {
                  const isDone = h.isApplied || h.feedbackVerdict === "HELPFUL";
                  const isDismissed = h.feedbackVerdict === "NOT_APPLICABLE" || h.feedbackVerdict === "NOT_HELPFUL";
                  return (
                    <div
                      key={h.id}
                      className="bg-white/80 border border-slate-200/80 rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">{h.title}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {h.createdAt ? h.createdAt.slice(0, 16).replace("T", " ") : ""}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{h.reason}</p>
                      </div>
                      <div className="shrink-0">
                        {isDone ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                            </svg>
                            已采纳
                          </span>
                        ) : isDismissed ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                            已忽略
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                            待处理
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-2xs space-y-4">
      {/* 头部标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-900 shadow-xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">AI 晨会副驾驶 · 今日三件事</h3>
              <Badge variant="blue" size="sm">个性化销售攻坚建议</Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              基于 AI 自主巡检你名下的停滞商机、线索与待办，每条建议均带事实证据链，点击一键执行推进。
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleHistory}
          className="text-xs font-semibold text-indigo-700 hover:text-indigo-800 flex items-center gap-1 bg-white/80 px-2.5 py-1 rounded-lg border border-indigo-100 shadow-2xs"
        >
          <span>近 7 天回顾</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {feedbackMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2 rounded-lg flex items-center gap-2 animate-in fade-in">
          <span>✓</span>
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 建议卡片列表 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {items.map((item, idx) => {
          const isExpanded = expandedId === item.id;
          const isDone = item.isApplied || item.feedbackVerdict === "HELPFUL";
          const isDismissed = item.feedbackVerdict === "NOT_APPLICABLE";

          const priorityBadge =
            item.suggestedAction.priority === "HIGH"
              ? "bg-rose-50 text-rose-700 border-rose-200"
              : item.suggestedAction.priority === "MEDIUM"
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-blue-50 text-blue-700 border-blue-200";

          const priorityText =
            item.suggestedAction.priority === "HIGH"
              ? "高优先级"
              : item.suggestedAction.priority === "MEDIUM"
              ? "中优先级"
              : "常规";

          const actionLabel =
            item.suggestedAction.type === "CREATE_FOLLOW_UP"
              ? "推进跟进"
              : item.suggestedAction.type === "CREATE_TASK"
              ? "新建待办"
              : "查看详情";

          return (
            <div
              key={item.id || idx}
              className={`bg-white rounded-xl border p-3.5 flex flex-col justify-between transition-all duration-150 ${
                isDone
                  ? "border-emerald-200/80 bg-emerald-50/20"
                  : isDismissed
                  ? "border-slate-200 opacity-60 bg-slate-50/50"
                  : "border-slate-200/90 hover:border-indigo-300 hover:shadow-xs"
              }`}
            >
              <div className="space-y-2">
                {/* 顶栏标签 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 w-4 h-4 rounded-full flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${priorityBadge}`}>
                      {priorityText}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {actionLabel}
                  </span>
                </div>

                {/* 标题 */}
                <h4 className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">
                  {item.title}
                </h4>

                {/* 证据折叠 */}
                <div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 mt-1"
                  >
                    <span>{isExpanded ? "收起证据链" : "查看证据与事实"}</span>
                    <svg
                      className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="mt-2 bg-slate-50 rounded-lg p-2.5 text-[11px] text-slate-700 leading-relaxed border border-slate-200/80 space-y-1.5">
                      <p className="font-mono text-slate-600">{item.reason}</p>
                      {item.confidenceScore < 80 && (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                          方向性假设（置信度 {item.confidenceScore}%）
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 底部动作按钮 */}
              <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                {isDone ? (
                  <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    已采纳并执行
                  </span>
                ) : isDismissed ? (
                  <span className="text-[11px] text-slate-400 font-medium">已忽略</span>
                ) : (
                  <div className="flex items-center gap-2 w-full justify-end">
                    <Button variant="secondary" size="xs" disabled={isPending} onClick={() => handleDismiss(item)}>不适用</Button>
                    <Button variant="primary" size="xs" disabled={isPending} onClick={() => handleApply(item)} className="flex items-center gap-1"><span>去执行</span><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg></Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 近 7 天建议历史展开区 */}
      {showHistory && (
        <div className="pt-3 border-t border-indigo-100/70 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">本人近 7 天晨会建议履约与回顾</span>
            <span className="text-[10px] text-slate-400">已沉淀至 AI 飞轮</span>
          </div>

          {loadingHistory ? (
            <div className="py-4 text-center text-xs text-slate-400">
              正在加载历史建议...
            </div>
          ) : historyItems.length === 0 ? (
            <div className="py-3 text-center text-xs text-slate-400 bg-white/60 rounded-xl border border-slate-100">
              近 7 天暂无历史建议记录
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {historyItems.map((h) => {
                const isDone = h.isApplied || h.feedbackVerdict === "HELPFUL";
                const isDismissed = h.feedbackVerdict === "NOT_APPLICABLE" || h.feedbackVerdict === "NOT_HELPFUL";
                return (
                  <div
                    key={h.id}
                    className="bg-white/80 border border-slate-200/80 rounded-xl p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-2xs"
                  >
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 truncate">{h.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {h.createdAt ? h.createdAt.slice(0, 16).replace("T", " ") : ""}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate">{h.reason}</p>
                    </div>
                    <div className="shrink-0">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                          </svg>
                          已采纳
                        </span>
                      ) : isDismissed ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                          已忽略
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                          待处理
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
