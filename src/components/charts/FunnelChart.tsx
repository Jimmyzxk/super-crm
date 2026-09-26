"use client";

import { useState } from "react";

export interface FunnelStepItem {
  id: string;
  name: string;
  count: number;
  amount: number;
  conversionRate: number; // 从上一环节转化率 (%)
  overallRate?: number;   // 累计转化率 (%)
  avgStayDays?: number;   // 平均停留周期 (天)
  color: string;
  bgGradient: string;
}

export interface FunnelChartProps {
  title?: string;
  subtitle?: string;
  steps: FunnelStepItem[];
  totalAmount?: number;
  wonAmount?: number;
  overallWinRate?: number;
  avgCycleDays?: number;
  insights?: Array<{
    type: "warning" | "success" | "info";
    title: string;
    description: string;
  }>;
}

export default function FunnelChart({
  title = "销售漏斗总览 (Sales Funnel)",
  subtitle = "看清全链路转化路径，精确定位各阶段流失原因与增长突破口",
  steps,
  totalAmount,
  wonAmount,
  overallWinRate,
  avgCycleDays,
  insights = [],
}: FunnelChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // 计算最大值与总金额
  const firstCount = steps[0]?.count || 1;
  const computedTotalAmount = totalAmount ?? steps.reduce((sum, s) => sum + s.amount, 0);
  const computedWonAmount = wonAmount ?? (steps.find((s) => s.id === "WON")?.amount || steps[steps.length - 1]?.amount || 0);
  const computedWinRate = overallWinRate ?? (firstCount > 0 ? Math.round(((steps[steps.length - 1]?.count || 0) / firstCount) * 100) : 0);
  const computedAvgDays = avgCycleDays ?? Math.round(steps.reduce((sum, s) => sum + (s.avgStayDays || 0), 0));

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
      {/* 1. 顶部标题 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200/80">
          全周期实时归集
        </span>
      </div>

      {/* 2. 漏斗主体与右侧 KPI 指标网格 */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧：梯形立体彩色漏斗 (8 列) */}
        <div className="lg:col-span-8 space-y-2">
          {/* 漏斗表头 */}
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 px-3 pb-1 border-b border-slate-100">
            <span className="w-1/3">阶段环节</span>
            <span className="w-1/5 text-center">商机量</span>
            <span className="w-1/4 text-right">金额规模</span>
            <span className="w-1/5 text-right">转出率</span>
            <span className="w-1/6 text-right">均期</span>
          </div>

          {/* 漏斗各层梯形与数据条 */}
          <div className="space-y-1.5 pt-1">
            {steps.map((step, idx) => {
              // 梯形宽度递减计算（保证视觉上逐级收窄）
              const widthPct = Math.max(38, 100 - idx * 12);
              const isHovered = hoveredIndex === idx;

              return (
                <div
                  key={step.id}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  className={`group relative flex items-center justify-between p-2.5 rounded-xl transition-all duration-200 cursor-pointer ${
                    isHovered ? "bg-slate-50 shadow-xs ring-1 ring-blue-500/20" : "hover:bg-slate-50/70"
                  }`}
                >
                  {/* 漏斗彩色梯形色块 */}
                  <div className="w-1/3 flex items-center gap-2">
                    <div
                      className="h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-2xs transition-all duration-300"
                      style={{
                        width: `${widthPct}%`,
                        background: step.bgGradient || step.color,
                      }}
                    >
                      <span className="truncate px-2 text-[11.5px] drop-shadow-xs">{step.name}</span>
                    </div>
                  </div>

                  {/* 商机量 */}
                  <div className="w-1/5 text-center font-mono font-bold text-slate-900 text-xs">
                    {step.count}{" "}
                    <span className="text-[10px] text-slate-400 font-normal font-sans">笔</span>
                  </div>

                  {/* 金额规模 */}
                  <div className="w-1/4 text-right font-mono font-bold text-slate-800 text-xs">
                    ¥{Math.round(step.amount / 100).toLocaleString()}
                  </div>

                  {/* 单步转化率 */}
                  <div className="w-1/5 text-right">
                    {idx === 0 ? (
                      <span className="text-[10px] text-slate-400 font-mono">-</span>
                    ) : (
                      <span
                        className={`text-xs font-mono font-bold ${
                          step.conversionRate >= 60
                            ? "text-emerald-600"
                            : step.conversionRate >= 40
                            ? "text-blue-600"
                            : "text-amber-600"
                        }`}
                      >
                        {step.conversionRate}%
                      </span>
                    )}
                  </div>

                  {/* 平均停留周期 */}
                  <div className="w-1/6 text-right font-mono text-slate-500 text-xs">
                    {step.avgStayDays ? `${step.avgStayDays}天` : "-"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：整体转化表现与核心 KPI (4 列) */}
        <div className="lg:col-span-4 flex flex-col justify-between space-y-3">
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/60 p-4 space-y-3.5">
            <h4 className="text-xs font-bold text-slate-900 border-b border-slate-200/70 pb-2">
              整体转化表现看板
            </h4>

            <div>
              <span className="text-[11px] text-slate-500">综合赢单转化率</span>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="font-mono text-2xl font-black text-blue-600">
                  {computedWinRate}%
                </span>
                <span className="text-[10px] text-slate-400">最终成单 / 初步发现</span>
              </div>
            </div>

            <div>
              <span className="text-[11px] text-slate-500">管道累计商机体量</span>
              <p className="font-mono text-lg font-bold text-slate-900 mt-0.5">
                ¥{Math.round(computedTotalAmount / 100).toLocaleString()}
              </p>
            </div>

            <div>
              <span className="text-[11px] text-slate-500">已赢单落地金额</span>
              <p className="font-mono text-lg font-bold text-emerald-600 mt-0.5">
                ¥{Math.round(computedWonAmount / 100).toLocaleString()}
              </p>
            </div>

            <div>
              <span className="text-[11px] text-slate-500">平均成单转化耗时</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="font-mono text-lg font-bold text-slate-900">{computedAvgDays}</span>
                <span className="text-xs text-slate-500">天</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. 底部关键流失洞察建议卡片 (如果存在) */}
      {insights.length > 0 && (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-100">
          {insights.map((ins, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl border text-xs ${
                ins.type === "warning"
                  ? "bg-amber-50/50 border-amber-200 text-amber-900"
                  : ins.type === "success"
                  ? "bg-emerald-50/50 border-emerald-200 text-emerald-900"
                  : "bg-blue-50/50 border-blue-200 text-blue-900"
              }`}
            >
              <div className="font-bold mb-1 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {ins.title}
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">{ins.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
