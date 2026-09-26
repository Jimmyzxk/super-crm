import { notFound, redirect } from "next/navigation";
import { BusinessError } from "@/core/shared/result";
import { Suspense } from "react";
import { requireSession } from "@/core/auth/session";
import { getCustomerDetailService } from "@/core/customer/service";
import CustomerDetailClient from "./CustomerDetailClient";
import CustomerTimeline from "./CustomerTimeline";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params, searchParams }: { params: Promise<{ customerId: string }>; searchParams: Promise<{ action?: string; limit?: string }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const { customerId } = await params;
  const query = await searchParams;
  const action = ["followup", "reschedule", "opportunity"].includes(query.action ?? "") ? query.action : undefined;
  const limit = query.limit && /^\d+$/.test(query.limit) ? Math.min(Math.max(Number(query.limit), 20), 100) : 20;
  let detail;
  try {
    detail = await getCustomerDetailService(session, customerId);
  } catch (error) {
    if (error instanceof BusinessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <><CustomerDetailClient key={JSON.stringify(detail)} initial={detail} initialAction={action} role={session.role} /><Suspense fallback={<TimelineFallback />}><CustomerTimeline session={session} customerId={customerId} limit={limit} /></Suspense></>;
}

function TimelineFallback() { return <section className="mt-8 border-t border-slate-200 pt-4"><h2 className="text-lg font-semibold">跟进时间线</h2><p className="py-8 text-sm text-slate-500">正在加载跟进记录…</p></section>; }
