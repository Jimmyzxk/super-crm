"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/core/auth/types";
import type {
  QuotaPeriodType,
  SalesQuotaItem,
  TeamQuotaDashboardData,
  UpsertQuotaInput,
} from "@/core/quota/types";
import {
  batchUpsertSalesQuotasAction,
  getSalesQuotaAttainmentDashboardAction,
  upsertSalesQuotaAction,
} from "@/core/quota/actions";
import { Badge, Button, EmptyState } from "@/components/ui";

interface Props {
  role: Role;
  currentUserId: string;
  initialDashboardData: TeamQuotaDashboardData;
  initialQuotas: SalesQuotaItem[];
  initialYear: number;
  initialPeriodType: QuotaPeriodType;
  initialPeriodKey: string;
}

function formatCentsToYuan(cents: number): string {
  return `¥${(cents / 100).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function QuotasClient({
  role,
  currentUserId,
  initialDashboardData,
  initialYear,
  initialPeriodType,
  initialPeriodKey,
}: Props) {
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";

  const [year, setYear] = useState<number>(initialYear);
  const [periodType, setPeriodType] = useState<QuotaPeriodType>(initialPeriodType);
  const [periodKey, setPeriodKey] = useState<string>(initialPeriodKey);
  const [dashboard, setDashboard] = useState<TeamQuotaDashboardData>(initialDashboardData);
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 批量配置弹窗状态
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [batchRows, setBatchRows] = useState<Array<{ userId: string; userName: string; targetYuan: string; targetDeals: string }>>([]);
  const [batchGlobalYuan, setBatchGlobalYuan] = useState<string>("200000");

  // 单人配置弹窗状态
  const [isSingleModalOpen, setIsSingleModalOpen] = useState(false);
  const [singleForm, setSingleForm] = useState<{
    userId: string;
    userName: string;
    targetYuan: string;
    targetDeals: string;
    note: string;
  }>({
    userId: "",
    userName: "",
    targetYuan: "200000",
    targetDeals: "5",
    note: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // 切换周期重新拉取
  const handleQuery = (newYear?: number, newPeriodType?: QuotaPeriodType, newPeriodKey?: string) => {
    const y = newYear ?? year;
    const pt = newPeriodType ?? periodType;
    let pk = newPeriodKey ?? periodKey;

    if (newPeriodType && newPeriodType !== periodType) {
      if (newPeriodType === "MONTHLY") pk = `${y}-M08`;
      else if (newPeriodType === "QUARTERLY") pk = `${y}-Q3`;
      else pk = `${y}`;
      setPeriodKey(pk);
    }

    startTransition(async () => {
      const res = await getSalesQuotaAttainmentDashboardAction({
        year: y,
        periodType: pt,
        periodKey: pk,
      });

      if (res.ok && res.data) {
        setDashboard(res.data);
      }
    });
  };

  // 打开批量设定弹窗
  const handleOpenBatchModal = () => {
    const initialBatch = dashboard.members.map((m) => ({
      userId: m.userId,
      userName: m.userName,
      targetYuan: String(m.targetAmountCents > 0 ? m.targetAmountCents / 100 : 200000),
      targetDeals: String(m.targetDealsCount > 0 ? m.targetDealsCount : 5),
    }));
    setBatchRows(initialBatch);
    setIsBatchModalOpen(true);
  };

  // 一键全员应用统一目标
  const handleApplyGlobalToAll = () => {
    const val = batchGlobalYuan.trim();
    if (!val || isNaN(Number(val))) return;
    setBatchRows((prev) => prev.map((r) => ({ ...r, targetYuan: val })));
  };

  // 提交批量保存
  const handleSaveBatchQuotas = async () => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const quotas: UpsertQuotaInput[] = batchRows.map((r) => ({
        userId: r.userId,
        year,
        periodType,
        periodKey,
        targetAmountCents: Math.round(Number(r.targetYuan || 0) * 100),
        targetDealsCount: parseInt(r.targetDeals || "0", 10) || 0,
        targetLeadsCount: 0,
      }));

      const res = await batchUpsertSalesQuotasAction({ quotas });
      if (res.ok) {
        setIsBatchModalOpen(false);
        setFeedback({ type: "success", text: `成功批量设定 ${res.data?.count || 0} 位销售人员的业绩目标！` });
        handleQuery();
      } else {
        setFeedback({ type: "error", text: res.message || "批量保存失败" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开单人微调
  const handleOpenSingleModal = (member?: { userId: string; userName: string; targetAmountCents: number; targetDealsCount: number }) => {
    if (member) {
      setSingleForm({
        userId: member.userId,
        userName: member.userName,
        targetYuan: String(member.targetAmountCents > 0 ? member.targetAmountCents / 100 : 200000),
        targetDeals: String(member.targetDealsCount > 0 ? member.targetDealsCount : 5),
        note: "",
      });
    } else if (dashboard.members.length > 0) {
      const first = dashboard.members[0];
      setSingleForm({
        userId: first.userId,
        userName: first.userName,
        targetYuan: "200000",
        targetDeals: "5",
        note: "",
      });
    }
    setIsSingleModalOpen(true);
  };

  // 保存单人配额
  const handleSaveSingleQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleForm.userId || isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await upsertSalesQuotaAction({
        userId: singleForm.userId,
        year,
        periodType,
        periodKey,
        targetAmountCents: Math.round(Number(singleForm.targetYuan || 0) * 100),
        targetDealsCount: parseInt(singleForm.targetDeals || "0", 10) || 0,
        targetLeadsCount: 0,
        note: singleForm.note.trim() || undefined,
      });

      if (res.ok) {
        setIsSingleModalOpen(false);
        setFeedback({ type: "success", text: `已成功微调销售顾问「${singleForm.userName}」的业绩目标` });
        handleQuery();
      } else {
        setFeedback({ type: "error", text: res.message || "保存失败" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 顶部 Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="blue" size="sm">
              目标作战
            </Badge>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight">销售目标与业绩对赌</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            支持年度/季度/月度全员目标设定、批量快速导入、实时达成率测算与管线覆盖倍数健康度预警
          </p>
        </div>

        {/* 主管批量配置操作 */}
        {isManagerOrAdmin && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleOpenBatchModal}
              leftIcon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              }
            >
              批量设定 / 导入目标
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => handleOpenSingleModal()}
            >
              单人微调配额
            </Button>
          </div>
        )}
      </header>

      {feedback && (
        <div
          role="alert"
          className={`rounded-xl p-3.5 text-xs font-semibold flex items-center justify-between shadow-2xs transition ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* 周期与维度选择器 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* 周期类型切换 */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
            {(
              [
                ["MONTHLY", "月度对赌 (Monthly)"],
                ["QUARTERLY", "季度冲刺 (Quarterly)"],
                ["YEARLY", "年度战略 (Yearly)"],
              ] as Array<[QuotaPeriodType, string]>
            ).map(([ptKey, ptLabel]) => (
              <button
                key={ptKey}
                type="button"
                onClick={() => {
                  setPeriodType(ptKey);
                  handleQuery(undefined, ptKey);
                }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  periodType === ptKey
                    ? "bg-white text-slate-950 shadow-2xs font-bold"
                    : "text-slate-600 hover:text-slate-950"
                }`}
              >
                {ptLabel}
              </button>
            ))}
          </div>

          {/* 年份选择 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">考核年度:</span>
            <select
              value={year}
              onChange={(e) => {
                const y = parseInt(e.target.value, 10);
                setYear(y);
                handleQuery(y);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value={2026}>2026 年度</option>
              <option value={2025}>2025 年度</option>
            </select>
          </div>
        </div>

        {/* 月份/季度二级快速切换条 */}
        {periodType === "MONTHLY" && (
          <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-400 font-medium mr-1.5">月份选择:</span>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const mKey = `${year}-M${String(m).padStart(2, "0")}`;
              const isSelected = periodKey === mKey;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setPeriodKey(mKey);
                    handleQuery(undefined, undefined, mKey);
                  }}
                  className={`rounded-md px-2.5 py-1 text-xs font-mono transition cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 text-white font-bold shadow-2xs"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {m}月
                </button>
              );
            })}
          </div>
        )}

        {periodType === "QUARTERLY" && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            <span className="text-xs text-slate-400 font-medium mr-1.5">季度选择:</span>
            {[
              ["Q1", "第 1 季度 (1月~3月)"],
              ["Q2", "第 2 季度 (4月~6月)"],
              ["Q3", "第 3 季度 (7月~9月)"],
              ["Q4", "第 4 季度 (10月~12月)"],
            ].map(([qKey, qLabel]) => {
              const fullKey = `${year}-${qKey}`;
              const isSelected = periodKey === fullKey;
              return (
                <button
                  key={qKey}
                  type="button"
                  onClick={() => {
                    setPeriodKey(fullKey);
                    handleQuery(undefined, undefined, fullKey);
                  }}
                  className={`rounded-md px-3 py-1 text-xs transition cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 text-white font-bold shadow-2xs"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {qLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 团队核心经营目标作战卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. 团队目标签约配额 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-1">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">团队总目标配额 (Target)</div>
          <div className="text-xl font-bold font-mono text-slate-950">
            {formatCentsToYuan(dashboard.teamTargetAmountCents)}
          </div>
          <div className="text-[11px] text-slate-400">
            考核周期：<span className="font-mono text-slate-700">{dashboard.periodKey}</span>
          </div>
        </div>

        {/* 2. 实际签约赢单金额 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-1">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">当期实际完成 (Won)</div>
          <div className="text-xl font-bold font-mono text-emerald-600">
            {formatCentsToYuan(dashboard.teamWonAmountCents)}
          </div>
          <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <span>总达成率:</span>
            <Badge
              variant={dashboard.teamAttainmentRate >= 100 ? "emerald" : dashboard.teamAttainmentRate >= 60 ? "blue" : "amber"}
              size="sm"
            >
              {dashboard.teamAttainmentRate}%
            </Badge>
          </div>
        </div>

        {/* 3. 业绩差距金额 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-1">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">业绩差距缺口 (Gap)</div>
          <div className="text-xl font-bold font-mono text-rose-600">
            {formatCentsToYuan(dashboard.teamQuotaGapCents)}
          </div>
          <div className="text-[11px] text-slate-400">
            {dashboard.teamTargetAmountCents === 0
              ? "本期尚未设定目标，请先配置配额"
              : dashboard.teamQuotaGapCents === 0
              ? "全员已提前达标！"
              : "距团队总目标尚差金额"}
          </div>
        </div>

        {/* 4. 管线储备健康覆盖倍数 */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-1">
          <div className="text-[11px] font-semibold text-slate-500 uppercase">管线储备倍数 (Coverage)</div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono text-slate-950">
              {dashboard.teamTargetAmountCents === 0 ? "—" : `${dashboard.teamPipelineCoverageRatio}x`}
            </span>
            <Badge
              variant={dashboard.teamTargetAmountCents === 0 ? "neutral" : dashboard.teamPipelineCoverageRatio >= 3 ? "emerald" : "amber"}
              dot
              size="sm"
            >
              {dashboard.teamTargetAmountCents === 0 ? "待设定目标" : dashboard.teamPipelineCoverageRatio >= 3 ? "管线健康" : "储备偏低 (需>=3x)"}
            </Badge>
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            在途商机: {formatCentsToYuan(dashboard.teamOpenPipelineAmountCents)}
          </div>
        </div>
      </div>

      {/* 销售个人目标达成进度明细表 */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-bold text-xs text-slate-900">销售团队成员达成明细表 ({dashboard.members.length} 人)</div>
          <span className="text-[11px] text-slate-400">
            数据依据实时签约赢单自动刷新
          </span>
        </div>

        {dashboard.members.length === 0 ? (
          <EmptyState
            title="暂无销售人员目标数据"
            description="请点击右上角「批量设定 / 导入目标」为团队成员初始化业绩目标。"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">销售人员 / 部门</th>
                  <th className="py-3 px-4">目标配额 (Target)</th>
                  <th className="py-3 px-4">实际完成 (Won)</th>
                  <th className="py-3 px-4 w-48">达成进度 (Attainment)</th>
                  <th className="py-3 px-4">业绩缺口 (Gap)</th>
                  <th className="py-3 px-4">在途商机 (Pipeline)</th>
                  <th className="py-3 px-4">储备倍数</th>
                  {isManagerOrAdmin && <th className="py-3 px-4 text-right">操作</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboard.members.map((m) => {
                  const isCurrent = m.userId === currentUserId;

                  return (
                    <tr
                      key={m.userId}
                      className={`hover:bg-slate-50/60 transition-colors ${
                        isCurrent ? "bg-blue-50/20 font-medium" : ""
                      }`}
                    >
                      {/* 销售人员 */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900">{m.userName}</span>
                          {isCurrent && (
                            <span className="rounded bg-blue-50 text-blue-700 border border-blue-200 px-1 py-0.2 text-[9px] font-bold">
                              本人
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{m.departmentName || "未分配部门"}</div>
                      </td>

                      {/* 目标配额 */}
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {formatCentsToYuan(m.targetAmountCents)}
                        {m.targetDealsCount > 0 && (
                          <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                            对赌赢单: {m.targetDealsCount} 笔
                          </div>
                        )}
                      </td>

                      {/* 实际完成 */}
                      <td className="py-3 px-4 font-mono font-semibold text-emerald-600">
                        {formatCentsToYuan(m.wonAmountCents)}
                        <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                          已签约: {m.wonDealsCount} 笔
                        </div>
                      </td>

                      {/* 达成进度条 */}
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-between text-[11px] mb-1 font-mono">
                          <span className="font-bold text-slate-900">{m.attainmentRate}%</span>
                          <span className="text-slate-400">
                            {m.targetAmountCents === 0
                              ? "未设定目标"
                              : m.attainmentRate >= 100
                              ? "超额达成"
                              : m.attainmentRate >= 60
                              ? "稳健推进"
                              : "需加速"}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              m.attainmentRate >= 100
                                ? "bg-emerald-500"
                                : m.attainmentRate >= 60
                                ? "bg-blue-600"
                                : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(m.attainmentRate, 100)}%` }}
                          />
                        </div>
                      </td>

                      {/* 业绩缺口 */}
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {m.targetAmountCents === 0 ? (
                          <span className="text-slate-400">未设定目标</span>
                        ) : m.quotaGapCents === 0 ? (
                          <span className="text-emerald-600 font-bold">已无缺口</span>
                        ) : (
                          <span className="text-rose-600 font-medium">{formatCentsToYuan(m.quotaGapCents)}</span>
                        )}
                      </td>

                      {/* 在途商机 */}
                      <td className="py-3 px-4 font-mono text-slate-700">
                        {formatCentsToYuan(m.openPipelineAmountCents)}
                      </td>

                      {/* 储备倍数 */}
                      <td className="py-3 px-4 font-mono">
                        <Badge
                          variant={m.pipelineCoverageRatio >= 3 ? "emerald" : m.pipelineCoverageRatio >= 1.5 ? "blue" : "amber"}
                          size="sm"
                        >
                          {m.pipelineCoverageRatio}x
                        </Badge>
                      </td>

                      {/* 操作 */}
                      {isManagerOrAdmin && (
                        <td className="py-3 px-4 text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            size="xs"
                            onClick={() => handleOpenSingleModal(m)}
                          >
                            微调
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 批量设定与快速导入模态窗 */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">批量设定 / 导入销售目标</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  当前考核周期：<span className="font-mono font-bold text-slate-800">{periodKey}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBatchModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            {/* 顶部一键快捷应用工具条 */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">一键统一赋额：</span>
                <input
                  type="number"
                  step="10000"
                  value={batchGlobalYuan}
                  onChange={(e) => setBatchGlobalYuan(e.target.value)}
                  className="w-32 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-900 font-mono text-xs focus:border-slate-900 focus:outline-none"
                  placeholder="元"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={handleApplyGlobalToAll}
                >
                  应用至全员
                </Button>
              </div>
              <span className="text-[11px] text-slate-400">支持在下方列表逐行独立微调</span>
            </div>

            {/* 批量编辑表格 */}
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500">
                    <th className="py-2.5 px-3">销售顾问</th>
                    <th className="py-2.5 px-3">目标签约额 (元) *</th>
                    <th className="py-2.5 px-3">目标赢单笔数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batchRows.map((row, idx) => (
                    <tr key={row.userId} className="hover:bg-slate-50/50">
                      <td className="py-2 px-3 font-medium text-slate-900">{row.userName}</td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="1000"
                          required
                          value={row.targetYuan}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBatchRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, targetYuan: val } : r))
                            );
                          }}
                          className="w-full max-w-[160px] rounded-md border border-slate-200 px-2 py-1 font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0"
                          value={row.targetDeals}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBatchRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, targetDeals: val } : r))
                            );
                          }}
                          className="w-24 rounded-md border border-slate-200 px-2 py-1 font-mono text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 弹窗底部操作 */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsBatchModalOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                isLoading={isSubmitting}
                onClick={handleSaveBatchQuotas}
              >
                保存全部目标
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 单人微调模态窗 */}
      {isSingleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">单人业绩配额微调</h3>
                <p className="text-xs text-slate-500 mt-0.5">考核周期：{periodKey}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSingleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveSingleQuota} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">销售人员 *</label>
                <select
                  value={singleForm.userId}
                  onChange={(e) => {
                    const found = dashboard.members.find((m) => m.userId === e.target.value);
                    setSingleForm({
                      ...singleForm,
                      userId: e.target.value,
                      userName: found?.userName || "",
                    });
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none bg-white"
                >
                  {dashboard.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.userName} ({m.departmentName || "未分配"})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">目标签约金额 (元) *</label>
                <input
                  type="number"
                  step="1000"
                  required
                  value={singleForm.targetYuan}
                  onChange={(e) => setSingleForm({ ...singleForm, targetYuan: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">目标赢单笔数</label>
                <input
                  type="number"
                  min="0"
                  value={singleForm.targetDeals}
                  onChange={(e) => setSingleForm({ ...singleForm, targetDeals: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">调整备注说明</label>
                <textarea
                  rows={2}
                  placeholder="例如：年中冲刺对赌激励增加"
                  value={singleForm.note}
                  onChange={(e) => setSingleForm({ ...singleForm, note: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsSingleModalOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmitting}
                >
                  保存配额
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
