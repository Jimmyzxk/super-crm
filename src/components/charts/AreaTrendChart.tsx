"use client";

import { useId, useMemo, useState } from "react";

export type TrendDataPoint = {
  label: string;
  value: number;
  secondaryValue?: number;
  extra?: string;
};

export type AreaTrendSeries = {
  name: string;
  color: string;
  gradientFrom: string;
  gradientTo: string;
  data: number[];
};

export interface AreaTrendChartProps {
  title: string;
  subtitle?: string;
  labels: string[];
  series: AreaTrendSeries[];
  periods?: Array<{ key: string; label: string }>;
  activePeriod?: string;
  onPeriodChange?: (key: string) => void;
  valueFormatter?: (val: number) => string;
  height?: number;
}

// 贝塞尔平滑曲线生成算法
function getCurvedPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function AreaTrendChart({
  title,
  subtitle,
  labels,
  series,
  periods,
  activePeriod,
  onPeriodChange,
  valueFormatter = (v) => `¥${v.toLocaleString()}`,
  height = 240,
}: AreaTrendChartProps) {
  const chartId = useId().replace(/:/g, "_");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // 计算最大值
  const allValues = series.flatMap((s) => s.data);
  const maxValue = Math.max(10, ...allValues);
  // 取规整 Y 轴上限
  const yMax = Math.ceil(maxValue * 1.15);

  const padding = { top: 20, right: 20, bottom: 35, left: 55 };
  const viewBoxWidth = 650;
  const viewBoxHeight = height;
  const graphWidth = viewBoxWidth - padding.left - padding.right;
  const graphHeight = viewBoxHeight - padding.top - padding.bottom;

  // 生成坐标点
  const computedSeries = useMemo(() => {
    return series.map((s) => {
      const points = s.data.map((val, idx) => {
        const x = padding.left + (idx / Math.max(1, labels.length - 1)) * graphWidth;
        const y = padding.top + (1 - val / yMax) * graphHeight;
        return { x, y, value: val };
      });

      const linePath = getCurvedPath(points);
      const firstX = points[0]?.x ?? padding.left;
      const lastX = points[points.length - 1]?.x ?? viewBoxWidth - padding.right;
      const baseY = padding.top + graphHeight;
      const areaPath = points.length > 0 ? `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z` : "";

      return {
        ...s,
        points,
        linePath,
        areaPath,
      };
    });
  }, [series, labels, graphWidth, graphHeight, padding.left, padding.top, padding.right, viewBoxWidth, yMax]);

  // Y 轴 4 等分标尺
  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
    const val = Math.round(yMax * ratio);
    const y = padding.top + (1 - ratio) * graphHeight;
    return { val, y };
  });

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all">
      {/* 头部标题与控制区 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* 系列图例 */}
          <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
            {series.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span>{s.name}</span>
              </span>
            ))}
          </div>

          {/* 周期切换按钮 */}
          {periods && periods.length > 0 && (
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
              {periods.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => onPeriodChange?.(p.key)}
                  className={`rounded-md px-2.5 py-1 transition cursor-pointer ${
                    activePeriod === p.key
                      ? "bg-white text-slate-900 shadow-2xs font-bold"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SVG 图表主体 */}
      <div className="relative mt-4 w-full select-none">
        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className="w-full h-auto overflow-visible font-sans"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient
                key={s.name}
                id={`grad_${chartId}_${i}`}
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop offset="0%" stopColor={s.gradientFrom} stopOpacity={0.4} />
                <stop offset="90%" stopColor={s.gradientTo} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {/* Y 轴网格线与刻度值 */}
          {yTicks.map(({ val, y }) => (
            <g key={val}>
              <line
                x1={padding.left}
                y1={y}
                x2={viewBoxWidth - padding.right}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
                strokeWidth="1"
              />
              <text
                x={padding.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="text-[10px] fill-slate-400 font-mono"
              >
                {val >= 10000 ? `${(val / 10000).toFixed(0)}万` : val}
              </text>
            </g>
          ))}

          {/* 面积填充 */}
          {computedSeries.map((s, i) => (
            <path
              key={`area_${s.name}`}
              d={s.areaPath}
              fill={`url(#grad_${chartId}_${i})`}
              className="transition-all duration-300 pointer-events-none"
            />
          ))}

          {/* 曲线边框 */}
          {computedSeries.map((s) => (
            <path
              key={`line_${s.name}`}
              d={s.linePath}
              fill="none"
              stroke={s.color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300 pointer-events-none"
            />
          ))}

          {/* X 轴标签 */}
          {labels.map((lbl, idx) => {
            const x = padding.left + (idx / Math.max(1, labels.length - 1)) * graphWidth;
            const isHovered = hoverIndex === idx;
            return (
              <text
                key={lbl}
                x={x}
                y={viewBoxHeight - 10}
                textAnchor="middle"
                className={`text-[10.5px] transition-colors ${
                  isHovered ? "fill-blue-600 font-bold" : "fill-slate-500 font-medium"
                }`}
              >
                {lbl}
              </text>
            );
          })}

          {/* 交互悬浮十字线与热区 */}
          {labels.map((_, idx) => {
            const x = padding.left + (idx / Math.max(1, labels.length - 1)) * graphWidth;
            const isHovered = hoverIndex === idx;
            const sliceWidth = graphWidth / Math.max(1, labels.length - 1);

            return (
              <g key={idx}>
                {/* 悬停时的垂直参考标尺 */}
                {isHovered && (
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={padding.top + graphHeight}
                    stroke="#94A3B8"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    className="pointer-events-none animate-in fade-in"
                  />
                )}

                {/* 悬停时每个系列的圆点高亮 */}
                {isHovered &&
                  computedSeries.map((s) => {
                    const pt = s.points[idx];
                    if (!pt) return null;
                    return (
                      <g key={s.name} className="pointer-events-none">
                        <circle cx={pt.x} cy={pt.y} r="5.5" fill="#FFFFFF" stroke={s.color} strokeWidth="2.5" />
                        <circle cx={pt.x} cy={pt.y} r="2" fill={s.color} />
                      </g>
                    );
                  })}

                {/* 鼠标触发透明矩形 */}
                <rect
                  x={x - sliceWidth / 2}
                  y={padding.top}
                  width={sliceWidth}
                  height={graphHeight}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIndex(idx)}
                />
              </g>
            );
          })}
        </svg>

        {/* 悬停浮动 Tooltip */}
        {hoverIndex !== null && (
          <div
            className="absolute z-20 pointer-events-none rounded-xl bg-slate-900/90 backdrop-blur-xs p-3 text-white shadow-xl text-xs transition-all duration-150 transform -translate-x-1/2 -translate-y-full"
            style={{
              left: `${((padding.left + (hoverIndex / Math.max(1, labels.length - 1)) * graphWidth) / viewBoxWidth) * 100}%`,
              top: "20%",
            }}
          >
            <div className="font-semibold text-slate-300 border-b border-slate-700/80 pb-1 mb-1.5">
              {labels[hoverIndex]}
            </div>
            <div className="space-y-1">
              {series.map((s) => (
                <div key={s.name} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </span>
                  <span className="font-mono font-bold text-white">
                    {valueFormatter(s.data[hoverIndex] ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
