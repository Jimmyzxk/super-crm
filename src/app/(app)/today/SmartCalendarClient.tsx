"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  completeSalesScheduleAction,
  createSalesScheduleAction,
  deleteSalesScheduleAction,
  listSalesSchedulesAction,
} from "@/core/schedule/actions";
import type {
  CreateScheduleInput,
  SalesScheduleItem,
  ScheduleType,
} from "@/core/schedule/types";
import { dateInputValue } from "@/core/shared/date";
import { Button, Badge } from "@/components/ui";

type Props = {
  initialSchedules: SalesScheduleItem[];
};

function ScheduleTypeIcon({ type }: { type: ScheduleType }) {
  if (type === "CALL") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
      </svg>
    );
  }
  if (type === "MEETING") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    );
  }
  if (type === "VISIT") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    );
  }
  if (type === "PROPOSAL_DEMO") {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

const SCHEDULE_TYPE_LABELS: Record<ScheduleType, { label: string; variant: "blue" | "purple" | "emerald" | "amber" | "neutral" }> = {
  CALL: { label: "电话沟通", variant: "blue" },
  MEETING: { label: "会议汇报", variant: "purple" },
  VISIT: { label: "实地上门拜访", variant: "emerald" },
  PROPOSAL_DEMO: { label: "方案/产品演示", variant: "amber" },
  FOLLOW_UP: { label: "常规跟进推进", variant: "neutral" },
};

export default function SmartCalendarClient({ initialSchedules }: Props) {
  const [schedules, setSchedules] = useState<SalesScheduleItem[]>(initialSchedules);
  const [viewFilter, setViewFilter] = useState<"ALL" | "PENDING" | "COMPLETED">("PENDING");
  const [isPending, startTransition] = useTransition();

  // 新增日程弹窗
  const [showAddModal, setShowAddModal] = useState(false);
  // 初始为空串：useState 初始化器里调 Date.now() 属于 render 期不纯调用
  // （SSR 与 hydration 各算各的，也是 hydration mismatch 来源之一），
  // 默认时间改为打开弹窗那一刻再计算
  const [newForm, setNewForm] = useState<CreateScheduleInput>({
    title: "",
    scheduleType: "VISIT",
    startAt: "",
    note: "",
  });

  const openAddModal = () => {
    setNewForm((prev) => (prev.startAt ? prev : { ...prev, startAt: dateInputValue(new Date(Date.now() + 3600 * 1000 * 2)) }));
    setShowAddModal(true);
  };

  const filtered = schedules.filter((s) => {
    if (viewFilter === "ALL") return true;
    return s.status === viewFilter;
  });

  function reloadSchedules() {
    startTransition(async () => {
      const res = await listSalesSchedulesAction();
      if (res.ok) setSchedules(res.data);
    });
  }

  function handleComplete(id: string) {
    startTransition(async () => {
      const res = await completeSalesScheduleAction(id);
      if (res.ok) {
        setSchedules((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: "COMPLETED" } : item)),
        );
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("确定要删除该日程吗？")) return;
    startTransition(async () => {
      const res = await deleteSalesScheduleAction(id);
      if (res.ok) {
        setSchedules((prev) => prev.filter((item) => item.id !== id));
      }
    });
  }

  function handleCreateSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.title.trim()) return alert("请填写日程标题");

    startTransition(async () => {
      const res = await createSalesScheduleAction(newForm);
      if (res.ok) {
        setShowAddModal(false);
        setNewForm({
          title: "",
          scheduleType: "VISIT",
          startAt: dateInputValue(new Date(Date.now() + 3600 * 1000 * 2)),
          note: "",
        });
        reloadSchedules();
      } else {
        alert(res.message || "创建日程失败");
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      {/* 头部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-950">销售智能工作日历</h2>
            <p className="text-[11px] text-slate-500">双向自动同步客户跟进计划，合理规划商务拜访与沟通时序</p>
          </div>
          <Badge variant="blue" size="sm" className="ml-1 font-mono">
            {schedules.filter((s) => s.status === "PENDING").length} 项待执行
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/70 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setViewFilter("PENDING")}
              className={`px-2.5 py-1 rounded-md transition ${
                viewFilter === "PENDING" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              待执行
            </button>
            <button
              type="button"
              onClick={() => setViewFilter("COMPLETED")}
              className={`px-2.5 py-1 rounded-md transition ${
                viewFilter === "COMPLETED" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              已完成
            </button>
            <button
              type="button"
              onClick={() => setViewFilter("ALL")}
              className={`px-2.5 py-1 rounded-md transition ${
                viewFilter === "ALL" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              全部
            </button>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={openAddModal}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>排期日程</span>
          </Button>
        </div>
      </div>

      {/* 日程列表 */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            暂无相关工作日程，填写客户/商机跟进时设置下次跟进时间将自动同步至此
          </div>
        ) : (
          filtered.map((item) => {
            const typeCfg = SCHEDULE_TYPE_LABELS[item.scheduleType] || SCHEDULE_TYPE_LABELS.FOLLOW_UP;
            const isCompleted = item.status === "COMPLETED";

            return (
              <div
                key={item.id}
                className={`group flex items-start justify-between gap-3 rounded-xl border p-3 text-xs transition ${
                  isCompleted
                    ? "border-slate-200/60 bg-slate-50/50 text-slate-400"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-2xs"
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <button
                    type="button"
                    disabled={isCompleted || isPending}
                    onClick={() => handleComplete(item.id)}
                    className={`mt-0.5 flex h-4.5 w-4.5 items-center justify-center rounded border transition shrink-0 ${
                      isCompleted
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-slate-300 hover:border-slate-500"
                    }`}
                    title={isCompleted ? "已完成" : "点击勾选完成"}
                  >
                    {isCompleted && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={typeCfg.variant} size="sm">
                        <span className="flex items-center gap-1">
                          <ScheduleTypeIcon type={item.scheduleType} />
                          <span>{typeCfg.label}</span>
                        </span>
                      </Badge>
                      <p className={`font-semibold text-slate-900 truncate ${isCompleted ? "line-through opacity-60" : ""}`}>
                        {item.title}
                      </p>
                      {item.source === "AUTO_FROM_FOLLOWUP" && (
                        <Badge variant="blue" size="sm">
                          跟进自动同步
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
                      <span className="font-mono text-slate-600 flex items-center gap-1">
                        <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {new Date(item.startAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          weekday: "short",
                        })}
                      </span>

                      {item.customerName && (
                        <Link href="/customers" className="text-blue-600 hover:underline flex items-center gap-1">
                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          <span>{item.customerName}</span>
                        </Link>
                      )}

                      {item.opportunityName && (
                        <Link href="/opportunities" className="text-purple-600 hover:underline flex items-center gap-1">
                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                          </svg>
                          <span>{item.opportunityName}</span>
                        </Link>
                      )}

                      {item.leadName && (
                        <Link href="/leads" className="text-emerald-600 hover:underline flex items-center gap-1">
                          <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <span>{item.leadName}</span>
                        </Link>
                      )}
                    </div>

                    {item.note && <p className="text-[11px] text-slate-500 italic mt-0.5">{item.note}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="p-1 text-slate-400 hover:text-red-600 text-xs rounded transition"
                    title="删除日程"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 新增日程弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-slate-200/80 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h3 className="text-sm font-bold text-slate-950">新建工作日程 / 拜访排期</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700 text-sm">
                ×
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">日程标题 *</label>
                <input
                  type="text"
                  required
                  value={newForm.title}
                  onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                  placeholder="例如：上门拜访蓝天制造张总演示技术方案"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">日程类型</label>
                  <select
                    value={newForm.scheduleType}
                    onChange={(e) => setNewForm({ ...newForm, scheduleType: e.target.value as ScheduleType })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  >
                    <option value="VISIT">实地上门拜访</option>
                    <option value="MEETING">会议方案汇报</option>
                    <option value="PROPOSAL_DEMO">方案/Demo 演示</option>
                    <option value="CALL">电话沟通</option>
                    <option value="FOLLOW_UP">常规跟进推进</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">计划开始时间 *</label>
                  <input
                    type="datetime-local"
                    required
                    value={typeof newForm.startAt === "string" ? newForm.startAt : ""}
                    onChange={(e) => setNewForm({ ...newForm, startAt: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs focus:border-slate-900 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">备忘说明</label>
                <textarea
                  rows={2}
                  value={newForm.note || ""}
                  onChange={(e) => setNewForm({ ...newForm, note: e.target.value })}
                  placeholder="提前准备好定制版 PPT 与报价单..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending ? "保存中..." : "确认排期"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
