"use client";

export interface RankedBarItem {
  id: string;
  name: string;
  sublabel?: string;
  amount: number;
  dealsCount?: number;
  completionRate?: number;
}

export interface RankedBarChartProps {
  title?: string;
  subtitle?: string;
  items: RankedBarItem[];
  valueFormatter?: (v: number) => string;
}

export default function RankedBarChart({
  title = "销售团队业绩排行 (Leaderboard)",
  subtitle = "团队及销售成员签约业绩与达成率横向对比",
  items,
  valueFormatter = (v) => `¥${Math.round(v / 100).toLocaleString()}`,
}: RankedBarChartProps) {
  const maxAmount = Math.max(1, ...items.map((i) => i.amount));

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
          实时战绩
        </span>
      </div>

      {/* 排行列表 */}
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">暂无业绩排名数据</div>
        ) : (
          items.map((item, idx) => {
            const pct = Math.min(100, Math.round((item.amount / maxAmount) * 100));
            const rank = idx + 1;

            return (
              <div key={item.id} className="group space-y-1">
                <div className="flex items-center justify-between text-xs">
                  {/* 左侧：名次勋章 + 姓名 + 部门 */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-black ${
                        rank === 1
                          ? "bg-amber-400 text-amber-950 shadow-xs"
                          : rank === 2
                          ? "bg-slate-300 text-slate-800"
                          : rank === 3
                          ? "bg-amber-700/30 text-amber-900"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {rank}
                    </span>

                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="font-bold text-slate-900 truncate">{item.name}</span>
                      {item.sublabel && (
                        <span className="text-[10.5px] text-slate-400 truncate font-normal">
                          {item.sublabel}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 右侧：金额与达成率 */}
                  <div className="flex items-baseline gap-2.5 shrink-0 font-mono text-xs">
                    <span className="font-bold text-slate-900">{valueFormatter(item.amount)}</span>
                    {item.completionRate !== undefined && (
                      <span className="text-[11px] font-semibold text-emerald-600">
                        {item.completionRate}% 达成
                      </span>
                    )}
                  </div>
                </div>

                {/* 进度条 */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      rank === 1
                        ? "bg-gradient-to-r from-blue-600 to-indigo-600"
                        : rank <= 3
                        ? "bg-gradient-to-r from-blue-500 to-blue-600"
                        : "bg-slate-400"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
