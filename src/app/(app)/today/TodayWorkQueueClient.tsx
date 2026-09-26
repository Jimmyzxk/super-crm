"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";
import { logActivity, rescheduleTask } from "@/core/followup/actions";
import { parseQuickFollowupText } from "@/core/followup/assistant";
import { dateInputValue, parseLocalDateTime } from "@/core/shared/date";

import { stageLabel, taskLabel } from "@/core/shared/display";
import type { SalesWorkItem } from "@/core/workbench/types";
import type { PublicPoolPreWarningItem } from "@/core/public-pool/service";
import { Button, Badge } from "@/components/ui";

const activityTypes = [["CALL", "电话"], ["MEETING", "会议"], ["VISIT", "拜访"], ["MESSAGE", "微信/短信"], ["NOTE", "内部记录"]] as const;
const outcomes = [["CONNECTED", "已接通"], ["NO_ANSWER", "未接通"], ["REFUSED", "明确拒绝"], ["INTERESTED", "有意向"]] as const;
const input = "h-8.5 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition";

type Panel = "activity" | "reschedule" | null;

function subjectHref(item: SalesWorkItem): string {
  if (item.subjectType === "lead") return `/leads`;
  if (item.subjectType === "customer") return `/customers`;
  return `/opportunities`;
}

function dueLabel(item: SalesWorkItem): string {
  const dueAt = new Date(item.dueAt);
  const value = dueAt.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return item.isOverdue ? `已超时 · ${value}` : `截止 ${value}`;
}

export default function TodayWorkQueueClient({
  initial,
  recycleWarnings = [],
}: {
  initial: SalesWorkItem[];
  recycleWarnings?: PublicPoolPreWarningItem[];
}) {
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const [position, setPosition] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const remaining = useMemo(() => initial.filter((item) => !handledIds.includes(item.taskId)), [handledIds, initial]);
  const safePosition = Math.min(position, Math.max(remaining.length - 1, 0));
  const item = remaining[safePosition];

  function completeCurrent() {
    if (!item) return;
    setHandledIds((current) => [...current, item.taskId]);
    setPosition((current) => Math.min(current, Math.max(remaining.length - 2, 0)));
    setPanel(null);
  }

  return (
    <div className="space-y-4">
      {/* 0. 公海临期前置节点预警卡片 */}
      {recycleWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 shadow-xs space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-white shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <span className="font-bold text-slate-900 flex items-center gap-2">
                  <span>公海临期回收预警 · 即将超时自动释放</span>
                  <Badge variant="amber" size="sm" dot>
                    {recycleWarnings.length} 个潜客临期
                  </Badge>
                </span>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  以下潜客长时间未跟进，即将到达 {recycleWarnings[0]?.thresholdDays ?? 7} 天时限。请在倒计时结束前记录有效沟通以打断回收
                </p>
              </div>
            </div>
            <Link href="/leads" className="text-xs font-semibold text-slate-700 hover:text-slate-900 hover:underline">
              线索看板 →
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {recycleWarnings.map((w) => (
              <div
                key={w.id}
                className="rounded-xl bg-white border border-amber-200/80 p-3 flex items-center justify-between gap-2 shadow-2xs hover:border-amber-400 transition"
              >
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 block truncate max-w-[170px]">{w.name}</span>
                  <span className="text-[10px] text-slate-400">已停滞 {w.daysSinceTouch} 天</span>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant="rose" size="sm">
                    剩 {w.hoursRemaining} 小时释放
                  </Badge>
                  <Link href={`/leads`} className="text-[10px] font-semibold text-blue-600 hover:underline mt-1 block">
                    去跟进保单 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1. 今日待办队列卡 */}
      <section aria-labelledby="work-queue-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 id="work-queue-heading" className="text-sm font-bold text-slate-950">今日待办跟进队列</h2>
            <p className="mt-0.5 text-xs text-slate-500">{initial.length > 0 ? `已处理 ${handledIds.length} / ${initial.length}` : "当前没有开放任务"}</p>
          </div>
          {item && <span className="text-xs font-mono text-slate-500">第 {safePosition + 1} / {remaining.length} 条</span>}
        </div>
      {!item ? (
        <div className="py-10 text-center">
          <p className="text-xs font-medium text-slate-700">{initial.length > 0 ? "当前队列已全部处理完成" : "今天没有待处理任务"}</p>
          <div className="mt-3">
            <Link href="/leads">
              <Button variant="secondary" size="sm">
                查看线索流转池
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <article className="pt-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={item.isOverdue ? "rose" : "neutral"} dot size="sm">
                  {dueLabel(item)}
                </Badge>
                <Badge variant="blue" size="sm">
                  {taskLabel(item.taskType)}
                </Badge>
              </div>
              <Link href={subjectHref(item) as never} className="mt-2 block font-bold text-base text-slate-950 hover:text-blue-600 transition-colors">
                {item.subjectName}
              </Link>
              <p className="mt-1 text-xs text-slate-600">{item.subjectContext}</p>
              <p className="mt-2 text-xs text-slate-500">负责人：{item.ownerName}</p>
              {item.subjectType === "lead" && (
                <div className="mt-3 rounded-lg border-l-2 border-slate-900 bg-slate-50 p-2.5 text-xs">
                  <p className="font-semibold text-slate-950 font-mono">{item.score == null ? "尚未评分" : `${item.score} 分`}</p>
                  <p className="mt-0.5 text-slate-600">{item.scoreReason || "暂无评分理由"}</p>
                </div>
              )}
              {item.subjectType === "opportunity" && item.stage && (
                <p className="mt-3 text-xs text-slate-700">当前阶段：<Badge variant="purple" size="sm">{stageLabel(item.stage)}</Badge></p>
              )}
            </div>
            <div className="flex w-full flex-row gap-2 sm:w-auto">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setPanel(panel === "activity" ? null : "activity")}
              >
                记跟进
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPanel(panel === "reschedule" ? null : "reschedule")}
              >
                改约
              </Button>
            </div>
          </div>
          {panel === "activity" && <ActivityPanel item={item} onCancel={() => setPanel(null)} onDone={completeCurrent} />}
          {panel === "reschedule" && <ReschedulePanel item={item} onCancel={() => setPanel(null)} onDone={completeCurrent} />}
          {remaining.length > 1 && (
            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={safePosition === 0}
                onClick={() => { setPosition((current) => Math.max(0, current - 1)); setPanel(null); }}
              >
                上一条
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={safePosition >= remaining.length - 1}
                onClick={() => { setPosition((current) => Math.min(remaining.length - 1, current + 1)); setPanel(null); }}
              >
                下一条
              </Button>
            </div>
          )}
        </article>
      )}
      </section>
    </div>
  );
}

function ActivityPanel({ item, onCancel, onDone }: { item: SalesWorkItem; onCancel: () => void; onDone: () => void }) {
  const [type, setType] = useState<(typeof activityTypes)[number][0]>("CALL");
  const [outcome, setOutcome] = useState<(typeof outcomes)[number][0]>("CONNECTED");
  const [summary, setSummary] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [detectedTags, setDetectedTags] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSmartExtract() {
    if (!summary.trim()) return;
    const parsed = parseQuickFollowupText(summary);
    setType(parsed.suggestedType);
    if (parsed.suggestedOutcome) {
      setOutcome(parsed.suggestedOutcome);
    }
    setDetectedTags(parsed.detectedTags);
    if (parsed.suggestedNextFollowUpAt) {
      setNextFollowUpAt(dateInputValue(new Date(parsed.suggestedNextFollowUpAt)));
    }
    setSummary(parsed.cleanSummary || summary);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const subject = item.subjectType === "lead" ? { leadId: item.subjectId } : item.subjectType === "customer" ? { customerId: item.subjectId } : { opportunityId: item.subjectId };
      const result = await logActivity({ ...subject, type, outcome: type === "NOTE" ? undefined : outcome, summary, nextFollowUpAt: nextFollowUpAt ? parseLocalDateTime(nextFollowUpAt) : undefined });
      if (!result.ok) setError(result.message);
      else onDone();
    });
  }
  return <form className="mt-5 grid gap-3 border-t border-slate-200 pt-5 sm:grid-cols-2" onSubmit={submit}>
    <label className="text-sm font-medium text-slate-700">跟进方式<select className={`${input} mt-2`} value={type} onChange={(event) => setType(event.target.value as typeof type)}>{activityTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {type !== "NOTE" && <label className="text-sm font-medium text-slate-700">跟进结果<select className={`${input} mt-2`} value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>{outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-slate-700">跟进摘要</label>
        <button type="button" onClick={handleSmartExtract} className="text-xs text-blue-600 hover:text-blue-800 underline">
          智能提炼（自动识别方式、结果与下次时间）
        </button>

      </div>
      <input className={`${input} mt-2`} required maxLength={200} placeholder="如：电话沟通意向强，客户提到预算充足，下周二做方案展示" value={summary} onChange={(event) => setSummary(event.target.value)} />
      {detectedTags.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-500">检测到关注点：</span>
        {detectedTags.map((tag) => <span key={tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{tag}</span>)}
      </div>}
    </div>
    <label className="text-sm font-medium text-slate-700 sm:col-span-2">下次跟进时间（可选）<input className={`${input} mt-2`} type="datetime-local" min={dateInputValue(new Date())} value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{error}</p>}
    <div className="flex gap-2 sm:col-span-2">
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
        取消
      </Button>
      <Button type="submit" variant="primary" size="sm" isLoading={pending}>
        {pending ? "提交中..." : "保存并处理下一条"}
      </Button>
    </div>
  </form>;
}

function ReschedulePanel({ item, onCancel, onDone }: { item: SalesWorkItem; onCancel: () => void; onDone: () => void }) {
  const [dueAt, setDueAt] = useState(dateInputValue(item.dueAt));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const value = parseLocalDateTime(dueAt);
    if (value <= new Date()) { setError("改约时间不能早于现在"); return; }
    startTransition(async () => { const result = await rescheduleTask({ taskId: item.taskId, dueAt: value }); if (!result.ok) setError(result.message); else onDone(); });
  }
  return (
    <form className="mt-5 max-w-md border-t border-slate-200 pt-5" onSubmit={submit}>
      <label className="text-sm font-medium text-slate-700">
        新的跟进时间
        <input className={`${input} mt-2`} required type="datetime-local" min={dateInputValue(new Date())} value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary" size="sm" isLoading={pending}>
          {pending ? "保存中..." : "保存并处理下一条"}
        </Button>
      </div>
    </form>
  );
}
