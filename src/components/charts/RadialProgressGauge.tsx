"use client";

export interface RadialProgressGaugeProps {
  title?: string;
  subtitle?: string;
  percentage: number;
  targetAmount: number;
  achievedAmount: number;
  gapAmount?: number;
  forecastAmount?: number;
  momGrowth?: number;
  color?: string;
}

export default function RadialProgressGauge({
  title = "目标达成率诊断",
  subtitle = "全维度追踪签约业绩与周期目标完成进度",
  percentage,
  targetAmount,
  achievedAmount,
  gapAmount,
  forecastAmount,
  momGrowth = 9.8,
}: RadialProgressGaugeProps) {
  const cleanPct = Math.min(100, Math.max(0, percentage));
  const radius = 70;
  const strokeWidth = 14;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (cleanPct / 100) * circumference;

  const computedGap = gapAmount ?? Math.max(0, targetAmount - achievedAmount);
  const computedForecast = forecastAmount ?? Math.round(achievedAmount * 1.15);

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
      {/* 头部标题 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
          较上月 {momGrowth >= 0 ? `↑ ${momGrowth}%` : `↓ ${Math.abs(momGrowth)}%`}
        </span>
      </div>

      {/* 仪表盘内容与详细指标 */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
        {/* 左侧：SVG 圆环仪表盘 (5 列) */}
        <div className="sm:col-span-5 flex flex-col items-center justify-center relative py-2">
          <div className="relative w-44 h-44 flex items-center justify-center">
            <svg viewBox="0 0 180 180" className="w-full h-full transform -rotate-90">
              <defs>
                <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3B82F6" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>

              {/* 背景底环 */}
              <circle
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke="#F1F5F9"
                strokeWidth={strokeWidth}
              />

              {/* 进度环 */}
              <circle
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>

            {/* 中心百分比数值 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none">
              <span className="font-mono text-3xl font-black text-slate-950 tracking-tight">
                {cleanPct}%
              </span>
              <span className="text-xs font-semibold text-slate-500 mt-0.5">目标达成率</span>
            </div>
          </div>
        </div>

        {/* 右侧：四项财务详细指标 (7 列) */}
        <div className="sm:col-span-7 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <span className="text-[11px] text-slate-500 font-medium">周期总目标额</span>
            <p className="font-mono text-base font-bold text-slate-900 mt-0.5">
              ¥{Math.round(targetAmount / 100).toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
            <span className="text-[11px] text-blue-800 font-medium">已完成签约额</span>
            <p className="font-mono text-base font-bold text-blue-950 mt-0.5">
              ¥{Math.round(achievedAmount / 100).toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
            <span className="text-[11px] text-amber-800 font-medium">未完成目标差额</span>
            <p className="font-mono text-base font-bold text-amber-950 mt-0.5">
              ¥{Math.round(computedGap / 100).toLocaleString()}
            </p>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <span className="text-[11px] text-emerald-800 font-medium">科学预计达成额</span>
            <p className="font-mono text-base font-bold text-emerald-950 mt-0.5">
              ¥{Math.round(computedForecast / 100).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
