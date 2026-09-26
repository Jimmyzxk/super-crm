"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { acceptSalesInsight, dismissSalesInsight } from "@/core/insight/actions";
import type { InsightDismissReason } from "@/core/insight/types";
import type { TodayInsight } from "./insights";
import { dueAtError, initialDueAt, presentEvidence } from "./presentation";
import { Button, Badge } from "@/components/ui";

const dismissReasons: Array<[InsightDismissReason, string]> = [
  ["NOT_APPLICABLE", "不适用"],
  ["ALREADY_HANDLED", "已处理"],
  ["WRONG_INFORMATION", "信息错误"],
  ["OTHER", "其他"],
];

const input = "h-8.5 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 transition";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "未建议截止时间";
}

function severityVariant(value: TodayInsight["severity"]): "rose" | "amber" | "neutral" {
  if (value === "HIGH_RISK") return "rose";
  if (value === "ATTENTION") return "amber";
  return "neutral";
}

function severityLabel(value: TodayInsight["severity"]): string {
  if (value === "HIGH_RISK") return "高风险";
  if (value === "ATTENTION") return "需关注";
  return "提示";
}

export default function TodayInsightsClient({ initial }: { initial: TodayInsight[] }) {
  const [items, setItems] = useState(initial);
  const [openPanel, setOpenPanel] = useState<{ id: string; kind: "accept" | "dismiss" } | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function complete(id: string) {
    setItems((current) => current.filter((item) => item.id !== id));
    setOpenPanel(null);
    setError("");
  }

  function open(id: string, kind: "accept" | "dismiss") {
    setError("");
    setOpenPanel((current) => current?.id === id && current.kind === kind ? null : { id, kind });
  }

  return (
    <section aria-labelledby="insights-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 id="insights-heading" className="text-sm font-bold text-slate-950">AI 智能商机风险质检建议</h2>
          <p className="mt-0.5 text-xs text-slate-500">{items.length > 0 ? `${items.length} 条待处理建议` : "暂无待处理建议"}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-xs font-medium text-slate-700">当前没有待处理质检建议</p>
          <div className="mt-3">
            <Link href="/leads">
              <Button variant="secondary" size="sm">
                查看全部线索
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="py-4">
              <article className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={severityVariant(item.severity)} dot size="sm">
                    {severityLabel(item.severity)}
                  </Badge>
                  {item.subjectType === "lead" ? (
                    <Link href={`/leads`} className="min-w-0 font-bold text-sm text-slate-950 hover:text-blue-600 transition-colors">
                      {item.subjectName}
                    </Link>
                  ) : (
                    <Link href={`/opportunities`} className="min-w-0 font-bold text-sm text-slate-950 hover:text-blue-600 transition-colors">
                      {item.subjectName}
                    </Link>
                  )}
                  <span className="min-w-0 text-xs text-slate-500">{item.subjectContext}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-400">风险原因</p>
                    <h3 className="mt-0.5 text-sm font-bold text-slate-900">{item.title}</h3>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">{item.summary}</p>
                    <div className="mt-2.5 rounded-lg border-l-2 border-slate-900 bg-slate-50 p-2.5 text-xs">
                      <p className="text-[11px] font-medium text-slate-500">建议行动</p>
                      <p className="mt-0.5 font-semibold text-slate-950">{item.suggestedAction}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">建议在 {formatDate(item.suggestedDueAt)} 前完成</p>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={pending}
                    onClick={() => open(item.id, "accept")}
                  >
                    安排跟进
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                  <details>
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-900 text-xs">查看诊断依据</summary>
                    <div className="mt-2 space-y-1 rounded-lg border-l-2 border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                      {presentEvidence(item.evidence).map((fact) => <p key={fact}>{fact}</p>)}
                    </div>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-900 text-xs">更多操作</summary>
                    <div className="mt-2">
                      <Button variant="secondary" size="xs" disabled={pending} onClick={() => open(item.id, "dismiss")}>
                        忽略此建议
                      </Button>
                    </div>
                  </details>
                </div>
                {openPanel?.id === item.id && openPanel.kind === "accept" && (
                  <AcceptPanel item={item} pending={pending} error={error} onCancel={() => setOpenPanel(null)} onSubmit={(dueAt) => startTransition(async () => { const result = await acceptSalesInsight({ insightId: item.id, dueAt: new Date(dueAt) }); if (!result.ok) setError(result.message); else complete(item.id); })} />
                )}
                {openPanel?.id === item.id && openPanel.kind === "dismiss" && (
                  <DismissPanel pending={pending} error={error} onCancel={() => setOpenPanel(null)} onSubmit={(reason) => startTransition(async () => { const result = await dismissSalesInsight({ insightId: item.id, reason }); if (!result.ok) setError(result.message); else complete(item.id); })} />
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AcceptPanel({ item, pending, error, onCancel, onSubmit }: { item: TodayInsight; pending: boolean; error: string; onCancel: () => void; onSubmit: (dueAt: string) => void }) {
  const [dueAt, setDueAt] = useState(initialDueAt(item.suggestedDueAt));
  const [validationError, setValidationError] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); const message = dueAtError(dueAt); if (message) { setValidationError(message); return; } setValidationError(""); onSubmit(dueAt); }
  return (
    <form className="mt-4 max-w-md border-l-2 border-slate-900 pl-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-700">
        确认下次跟进时间
        <input className={`${input} mt-2`} required type="datetime-local" min={initialDueAt(null)} value={dueAt} onChange={(event) => { setDueAt(event.target.value); setValidationError(""); }} />
      </label>
      {(validationError || error) && <p role="alert" className="mt-2 text-sm text-rose-700">{validationError || error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" isLoading={pending}>
          {pending ? "提交中..." : "确认采纳"}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}

function DismissPanel({ pending, error, onCancel, onSubmit }: { pending: boolean; error: string; onCancel: () => void; onSubmit: (reason: InsightDismissReason) => void }) {
  const [reason, setReason] = useState<InsightDismissReason>("NOT_APPLICABLE");
  function submit(event: FormEvent) { event.preventDefault(); onSubmit(reason); }
  return (
    <form className="mt-4 max-w-md border-l-2 border-slate-300 pl-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-slate-700">
        忽略原因
        <select className={`${input} mt-2`} value={reason} onChange={(event) => setReason(event.target.value as InsightDismissReason)}>
          {dismissReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" isLoading={pending}>
          {pending ? "提交中..." : "确认忽略"}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
