import Link from "next/link";
import { formatAmountInCents, formatBoundedCount, stageLabel } from "@/core/shared/display";
import type { ManagerWorkbench as ManagerWorkbenchData } from "@/core/workbench/types";
import type { DealInterventionItem } from "@/core/collaboration/types";

export default function ManagerWorkbench({
  data,
  pendingInterventions = [],
}: {
  data: ManagerWorkbenchData;
  pendingInterventions?: DealInterventionItem[];
}) {
  const maxLoad = Math.max(1, ...data.ownerLoad.map((o) => o.openTaskCount));

  return (
    <div className="space-y-6">
      {/* 0. 战情室待介入商机预警 (当存在呼叫主管求援时高亮展示) */}
      {pendingInterventions.length > 0 && (
        <section className="rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-amber-500/10 via-amber-50 to-orange-50 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-white font-bold shadow-2xs">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-amber-950 flex items-center gap-2">
                  <span>协同作战战情室 · 待主管介入项目</span>
                  <span className="rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold px-2 py-0.2">
                    {pendingInterventions.length} 个紧急求援
                  </span>
                </h2>
                <p className="text-xs text-amber-800">
                  一线销售打单遇到底价谈判、高层陪访或技术答辩卡点，请主管及时介入指导与批复
                </p>
              </div>
            </div>
            <Link
              href="/opportunities"
              className="text-xs font-semibold text-amber-900 hover:text-amber-950 underline"
            >
              商机看板 →
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {pendingInterventions.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-amber-200 bg-white p-3.5 shadow-2xs space-y-2 text-xs hover:border-amber-300 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-950 text-sm">{item.opportunityName}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                    {item.interventionType === "EXECUTIVE_SPONSOR"
                      ? "高层陪访"
                      : item.interventionType === "DISCOUNT_APPROVAL"
                      ? "底价特批"
                      : item.interventionType === "SOLUTION_SUPPORT"
                      ? "方案答辩"
                      : "打法辅导"}
                  </span>
                </div>

                <div className="text-slate-500 text-[11px] flex items-center gap-2">
                  <span>{item.customerName}</span>
                  {item.expectedAmount && (
                    <span className="font-mono font-bold text-slate-900">
                      · {formatAmountInCents(item.expectedAmount)}
                    </span>
                  )}
                  <span>· 发起人：{item.requesterName}</span>
                </div>

                <p className="text-slate-700 bg-slate-50 p-2 rounded-lg border border-slate-100 leading-relaxed text-[11px]">
                  {item.requestNote}
                </p>

                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span className="text-[10px] text-slate-400 font-mono">
                    {new Date(item.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <Link
                    href={`/opportunities`}
                    className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-amber-700 transition"
                  >
                    立即介入指导 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 1. 团队异常与风控预警指标行 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">待分配线索 (公海池)</span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded">待指派</span>
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1.5 font-mono">
            {formatBoundedCount(data.unassignedLeads, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">条</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-700">
            <Link href="/leads?filter=unassigned" className="hover:underline font-semibold">前往分配线索 →</Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">SLA 响应超时线索</span>
            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded">超期预警</span>
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-1.5 font-mono">
            {formatBoundedCount(data.overdueLeads, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">条</span>
          </div>
          <div className="mt-2 text-[11px] text-rose-600">
            <Link href="/leads?filter=overdue" className="hover:underline font-semibold">排查超期跟进 →</Link>
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">推进停滞商机 (Risk)</span>
            <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded">打法辅导</span>
          </div>
          <div className="text-2xl font-bold text-purple-700 mt-1.5 font-mono">
            {formatBoundedCount(data.stalledOpportunities, data.countCeiling)}{" "}
            <span className="text-xs font-normal text-slate-400">个滞留项目</span>
          </div>
          <div className="mt-2 text-[11px] text-purple-700">
            <Link href="/opportunities?filter=stalled" className="hover:underline font-semibold">启动打法辅导 →</Link>
          </div>
        </div>
      </div>

      {/* 2. 活跃商机阶段推进分布 */}
      <section aria-labelledby="stage-heading" className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 id="stage-heading" className="text-sm font-bold text-slate-950">团队活跃商机阶段分布</h2>
            <p className="mt-0.5 text-xs text-slate-500">实时统计各推进阶段商机储备与资金聚集度</p>
          </div>
          <Link href="/opportunities" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            查看商机看板 →
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {data.activeOpportunityStages.map((item) => (
            <Link
              key={item.stage}
              href="/opportunities"
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 hover:bg-white hover:border-blue-300 hover:shadow-xs transition-all text-center group"
            >
              <span className="block text-2xl font-bold font-mono text-slate-900 group-hover:text-blue-600 transition-colors">
                {formatBoundedCount(item.count, data.countCeiling)}
              </span>
              <span className="mt-1 block text-xs font-semibold text-slate-600">
                {stageLabel(item.stage)}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 3. 销售负责人任务负载排行榜 */}
      <section aria-labelledby="owner-load-heading" className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 id="owner-load-heading" className="text-sm font-bold text-slate-950">销售组员任务负载与待办分布</h2>
            <p className="mt-0.5 text-xs text-slate-500">按未关闭开放任务数量排序，用于均衡派单与防疲劳过载</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/leads" className="font-semibold text-slate-700 hover:text-blue-600">线索池 ↗</Link>
            <Link href="/customers" className="font-semibold text-slate-700 hover:text-blue-600">客户档案 ↗</Link>
            <Link href="/opportunities" className="font-semibold text-slate-700 hover:text-blue-600">商机管道 ↗</Link>
          </div>
        </div>

        {data.ownerLoad.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">暂无销售组员在职记录</div>
        ) : (
          <div className="space-y-3 pt-1">
            {data.ownerLoad.map((owner, idx) => {
              const pct = Math.min(100, Math.round((owner.openTaskCount / maxLoad) * 100));

              return (
                <div key={owner.userId} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] font-mono ${
                          idx === 0
                            ? "bg-amber-400 text-amber-950"
                            : idx === 1
                            ? "bg-slate-300 text-slate-800"
                            : idx === 2
                            ? "bg-amber-700/30 text-amber-900"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-900">{owner.userName}</span>
                    </div>
                    <span className="font-mono text-slate-600 font-semibold">
                      {formatBoundedCount(owner.openTaskCount, data.countCeiling)} 项开放任务
                    </span>
                  </div>

                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
