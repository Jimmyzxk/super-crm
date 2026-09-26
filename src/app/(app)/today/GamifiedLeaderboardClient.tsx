"use client";

import { useState, useTransition } from "react";
import { formatAmountInCents } from "@/core/shared/display";
import { getSalesLeaderboardAction } from "@/core/workbench/actions";
import type {
  LeaderboardPeriod,
  SalesLeaderboardData,
} from "@/core/workbench/leaderboard";
import { Badge } from "@/components/ui";

type Props = {
  initialData: SalesLeaderboardData;
};

export default function GamifiedLeaderboardClient({ initialData }: Props) {
  const [data, setData] = useState<SalesLeaderboardData>(initialData);
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialData.period || "MONTHLY");
  const [, startTransition] = useTransition();

  const { topGun, currentUserGamification, items } = data;

  function switchPeriod(nextPeriod: LeaderboardPeriod) {
    setPeriod(nextPeriod);
    startTransition(async () => {
      const res = await getSalesLeaderboardAction(nextPeriod);
      if (res.ok) setData(res.data);
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      {/* 顶部标题与周期切换 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-950">销售实时战报与荣誉榜</h2>
            <p className="text-[11px] text-slate-500">动态汇聚签约战绩、过程跟进活跃度与阶梯提成测算</p>
          </div>
          <Badge variant="amber" size="sm" className="ml-1">
            实时更新
          </Badge>
        </div>

        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 border border-slate-200/70 text-xs font-semibold">
          <button
            type="button"
            onClick={() => switchPeriod("DAILY")}
            className={`px-2.5 py-1 rounded-md transition ${
              period === "DAILY" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            今日战报
          </button>
          <button
            type="button"
            onClick={() => switchPeriod("WEEKLY")}
            className={`px-2.5 py-1 rounded-md transition ${
              period === "WEEKLY" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            本周冲刺
          </button>
          <button
            type="button"
            onClick={() => switchPeriod("MONTHLY")}
            className={`px-2.5 py-1 rounded-md transition ${
              period === "MONTHLY" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            月度总榜
          </button>
        </div>
      </div>

      {/* 激励战报卡：销冠荣誉卡 + 目标提成阶梯 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* 1. 销冠荣誉殿堂 Top Gun */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/10 via-amber-50/50 to-orange-100/40 border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
              <span>当期销冠荣誉殿堂</span>
            </span>
            <span className="text-[10px] font-bold bg-amber-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
              Top 1 榜首
            </span>
          </div>

          {topGun ? (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white text-lg font-black shadow-xs">
                {topGun.userName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-slate-950 text-sm">{topGun.userName}</p>
                <p className="text-xs text-slate-500">{topGun.departmentName || "销售部"}</p>
                <p className="text-xs font-bold text-amber-700 font-mono mt-0.5">
                  已签约：{formatAmountInCents(topGun.wonAmount)} ({topGun.wonDealsCount} 单)
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">本周期暂无赢单记录，首单即登顶销冠！</p>
          )}
        </div>

        {/* 2. 个人目标达成与提成跳档测算 */}
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50/50 to-indigo-50/40 p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
              <span>我的业绩与提成阶梯</span>
            </span>
            <span className="font-mono text-xs font-bold text-blue-700">
              当前第 {currentUserGamification.rank} 名
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">目标完成进度</span>
              <span className="font-mono font-bold text-blue-900">
                {currentUserGamification.attainmentRate}% ({formatAmountInCents(currentUserGamification.wonAmount)} / {formatAmountInCents(currentUserGamification.targetQuota)})
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-500"
                style={{ width: `${Math.min(currentUserGamification.attainmentRate, 100)}%` }}
              />
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between text-[11px] text-slate-600 border-t border-blue-100">
            <div>
              <span className="text-slate-500">当前提成：</span>
              <span className="font-bold text-slate-900">{currentUserGamification.currentTierName}</span>
            </div>
            {currentUserGamification.nextTierGapAmount > 0 ? (
              <div className="text-indigo-700 font-medium">
                差 <span className="font-mono font-bold">{formatAmountInCents(currentUserGamification.nextTierGapAmount)}</span> 晋升 {currentUserGamification.nextTierName}
              </div>
            ) : (
              <div className="text-emerald-700 font-bold">已达最高提成阶梯</div>
            )}
          </div>
        </div>
      </div>

      {/* 3. 全员战力榜明细表 */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white">
        <table className="w-full text-left text-xs text-slate-700">
          <thead className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500">
            <tr>
              <th className="px-3.5 py-2.5 w-14 text-center">排名</th>
              <th className="px-3 py-2.5">销售专员</th>
              <th className="px-3 py-2.5">所属部门</th>
              <th className="px-3 py-2.5 text-right">当期签约额</th>
              <th className="px-3 py-2.5 text-center">赢单单数</th>
              <th className="px-3 py-2.5 text-center">跟进次数</th>
              <th className="px-3 py-2.5 text-center">新立项商机</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  暂无战报数据
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.userId}
                  className={`transition-colors ${
                    row.isCurrentUser ? "bg-blue-50/60 font-medium" : "hover:bg-slate-50/80"
                  }`}
                >
                  <td className="px-3.5 py-2 text-center">
                    {row.rank === 1 ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-white font-bold text-[10px] font-mono shadow-xs">
                        1
                      </span>
                    ) : row.rank === 2 ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-slate-300 to-slate-400 text-slate-800 font-bold text-[10px] font-mono shadow-xs">
                        2
                      </span>
                    ) : row.rank === 3 ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-amber-600/60 to-amber-700/70 text-white font-bold text-[10px] font-mono shadow-xs">
                        3
                      </span>
                    ) : (
                      <span className="font-mono text-slate-500 font-semibold">{row.rank}</span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{row.userName}</span>
                      {row.isCurrentUser && (
                        <span className="rounded bg-blue-100 px-1 py-0.2 text-[10px] text-blue-700 font-semibold">
                          我
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2 text-slate-500">{row.departmentName || "未分部"}</td>

                  <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                    {formatAmountInCents(row.wonAmount)}
                  </td>

                  <td className="px-3 py-2 text-center font-mono font-medium text-slate-700">
                    {row.wonDealsCount} 单
                  </td>

                  <td className="px-3 py-2 text-center font-mono text-slate-600">
                    {row.activitiesCount} 次
                  </td>

                  <td className="px-3 py-2 text-center font-mono text-slate-600">
                    {row.newOppsCount} 个
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
