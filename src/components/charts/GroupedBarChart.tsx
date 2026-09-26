"use client";

import { useState } from "react";

export interface GroupedBarSeries {
  name: string;
  color: string;
  data: number[];
}

export interface GroupedBarChartProps {
  title?: string;
  subtitle?: string;
  categories: string[];
  series: GroupedBarSeries[];
  valueFormatter?: (v: number) => string;
}

export default function GroupedBarChart({
  title = "区域业绩对比 (Regional Performance)",
  subtitle = "各区域销售签约额与回款/目标横向对照",
  categories,
  series,
  valueFormatter = (v) => `¥${Math.round(v / 100).toLocaleString()}`,
}: GroupedBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const allVals = series.flatMap((s) => s.data);
  const maxVal = Math.max(10, ...allVals);

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
      {/* 头部 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        {/* 图例 */}
        <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: s.color }} />
              <span>{s.name}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 柱状图主体 */}
      <div className="mt-6 flex items-end justify-between gap-4 h-48 sm:h-56 pt-6">
        {categories.map((cat, catIdx) => {
          const isHovered = hoveredIdx === catIdx;

          return (
            <div
              key={cat}
              onMouseEnter={() => setHoveredIdx(catIdx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
            >
              {/* 柱子容器 (并排多柱) */}
              <div className="flex items-end justify-center gap-1.5 w-full max-w-[64px] h-full pb-1">
                {series.map((s) => {
                  const val = s.data[catIdx] ?? 0;
                  const heightPct = val > 0 ? Math.max(8, Math.round((val / maxVal) * 100)) : 3;

                  return (
                    <div
                      key={s.name}
                      className="flex-1 rounded-t-md transition-all duration-300 relative group/bar flex items-center justify-center shadow-2xs"
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: s.color,
                        opacity: isHovered ? 1 : 0.9,
                      }}
                    >
                      {/* 单柱悬停金额 */}
                      <div className="absolute -top-7 opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap bg-slate-900 text-white font-mono text-[9px] px-1.5 py-0.5 rounded shadow-md z-10">
                        {valueFormatter(val)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* X 轴分类名称 */}
              <div className="mt-2 text-center">
                <span
                  className={`block text-xs transition-colors ${
                    isHovered ? "text-blue-600 font-bold" : "text-slate-700 font-medium"
                  }`}
                >
                  {cat}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
