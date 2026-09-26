import { getOpportunityTimelineService } from "@/core/opportunity/service";
import type { TenantContext } from "@/core/tenant";
import { stageLabel } from "@/core/shared/display";
import Link from "next/link";
import { presentOpportunityTimeline } from "./timeline-presentation";

export default async function OpportunityTimeline({
  session,
  opportunityId,
  limit = 20,
}: {
  session: TenantContext;
  opportunityId: string;
  limit?: number;
}) {
  const { stageHistory, activities, nextLimit } = await getOpportunityTimelineService(session, opportunityId, limit);
  const timeline = presentOpportunityTimeline(stageHistory, activities, limit, nextLimit);

  return (
    <section aria-labelledby="opportunity-timeline-heading" className="space-y-4">
      <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
        <div>
          <h2 id="opportunity-timeline-heading" className="text-sm font-bold text-slate-900">
            流转与跟进记录
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            按发生时间记录商机阶段推进、回退与每次客户跟进动态
          </p>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          共 {timeline.entries.length} 条记录
        </span>
      </div>

      {timeline.entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
          暂无推进记录
        </div>
      ) : (
        <ol className="relative pl-4 space-y-3 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
          {timeline.entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="relative">
              <span
                className={`absolute -left-4 top-2 flex h-2 w-2 rounded-full ring-2 ring-white ${
                  entry.kind === "stage" ? "bg-indigo-500" : "bg-emerald-500"
                }`}
              />
              <div className="rounded-lg border border-slate-200/80 bg-white p-3 text-xs shadow-2xs space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {entry.kind === "stage" ? (
                      <>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          阶段流转
                        </span>
                        <span className="font-bold text-slate-900">
                          {entry.history.fromStage ? stageLabel(entry.history.fromStage) : "创建立项"} →{" "}
                          {stageLabel(entry.history.toStage)}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          <span>经办人:</span>
                          <span className="font-semibold text-slate-900">
                            {entry.history.operatorName || "历史成员"}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {activityLabel(entry.activity.type)}
                        </span>
                        {entry.activity.outcome && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            {outcomeLabel(entry.activity.outcome)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50/80 text-emerald-800 border border-emerald-200">
                          <span>跟进人:</span>
                          <span className="font-semibold text-emerald-950">
                            {entry.activity.userName || "历史成员"}
                          </span>
                        </span>
                      </>
                    )}
                  </div>
                  <time className="font-mono text-slate-400 text-[10px]">
                    {formatDate(entry.occurredAt)}
                  </time>
                </div>

                <p className="text-slate-700 leading-relaxed break-words whitespace-pre-wrap bg-slate-50/70 p-2 rounded-lg border border-slate-100">
                  {entry.kind === "stage"
                    ? entry.history.note || "阶段流转记录"
                    : entry.activity.summary}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {timeline.nextLimit !== null && (
        <div className="pt-2 text-center">
          <Link
            className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition"
            href={`/opportunities/${opportunityId}?limit=${timeline.nextLimit}`}
          >
            加载更多历史记录
          </Link>
        </div>
      )}
    </section>
  );
}

function activityLabel(type: string) {
  return (
    {
      CALL: "电话沟通",
      MEETING: "会议洽谈",
      VISIT: "现场拜访",
      MESSAGE: "企微/微信",
      EMAIL: "商务邮件",
      NOTE: "内部纪要",
    }[type] ?? type
  );
}

function outcomeLabel(value: string) {
  return (
    {
      CONNECTED: "正常沟通",
      NO_ANSWER: "未接通/未回复",
      REFUSED: "明确拒绝",
      INTERESTED: "意向明确",
      BUSY: "稍后联系",
      REJECTED: "暂无意向",
    }[value] ?? value
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
