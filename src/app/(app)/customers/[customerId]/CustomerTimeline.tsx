import { getCustomerTimelineService } from "@/core/customer/service";
import type { TenantContext } from "@/core/tenant";
import Link from "next/link";

export default async function CustomerTimeline({ session, customerId, limit = 20 }: { session: TenantContext; customerId: string; limit?: number }) {
  const page = await getCustomerTimelineService(session, customerId, limit);
  return <section className="mt-8"><h2 className="border-b border-slate-200 pb-3 text-lg font-semibold">经营时间线</h2>{page.items.length === 0 ? <p className="py-8 text-sm text-slate-500">还没有经营记录</p> : <><ol className="divide-y divide-slate-200">{page.items.map((item) => <li key={item.id} className="grid gap-2 py-4 sm:grid-cols-[7rem_1fr]"><time className="text-sm text-slate-500">{formatDate(item.occurredAt)}</time><div><p className="text-sm font-medium">{eventLabel(item.type)}{item.outcome ? ` · ${outcomeLabel(item.outcome)}` : ""} <span className="font-normal text-slate-400">{item.userName}</span></p><p className="mt-1 text-sm leading-6 text-slate-700">{item.summary}</p></div></li>)}</ol>{page.nextLimit !== null && <Link className="mt-4 inline-flex min-h-11 items-center text-sm text-slate-700 underline" href={`/customers/${customerId}?limit=${page.nextLimit}`}>加载更多</Link>}</>}</section>;
}
function eventLabel(type: string) { return ({ LEAD_CREATED: "线索创建", CONVERTED: "转为客户", OPPORTUNITY_CREATED: "商机创建", STAGE_CHANGED: "阶段变化", WON: "赢单", LOST: "丢单", CALL: "电话", MEETING: "会议", VISIT: "拜访", MESSAGE: "微信/短信", NOTE: "内部记录" } as Record<string, string>)[type] ?? "经营事件"; }
function outcomeLabel(value: string) { return ({ CONNECTED: "已接通", NO_ANSWER: "未接通", REFUSED: "明确拒绝", INTERESTED: "有意向" } as Record<string, string>)[value] ?? value; }
function formatDate(value: string) { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
