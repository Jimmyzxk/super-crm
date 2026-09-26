import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { requireSession } from "@/core/auth/session";
import { BusinessError } from "@/core/shared/result";
import { getSalesInsightsService } from "@/core/insight/service";
import { getAssignableUsersService } from "@/core/leads/service";
import { getOpportunityDetailService } from "@/core/opportunity/service";
import { getWinReviewService } from "@/core/win-review/service";
import { getRecommendedPlaybookService } from "@/core/playbook/service";
import { listEnabledPluginKeys } from "@/plugin-kit/server";
import { PluginOpportunityDetailMounts } from "@/plugin-kit/PluginMounts";
import OpportunityDetailClient from "./OpportunityDetailClient";
import OpportunityTimeline from "./OpportunityTimeline";

export const dynamic = "force-dynamic";

export default async function OpportunityDetailPage({ params, searchParams }: { params: Promise<{ opportunityId: string }>; searchParams: Promise<{ limit?: string }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const { opportunityId } = await params;
  const query = await searchParams;
  const limit = query.limit && /^\d+$/.test(query.limit) ? Math.min(Math.max(Number(query.limit), 20), 100) : 20;
  let detail;
  try {
    detail = await getOpportunityDetailService(session, opportunityId);
  } catch (error) {
    if (error instanceof BusinessError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [insights, playbookRecommendation, enabledPluginKeys, assignableUsers, initialAttribution] = await Promise.all([
    getSalesInsightsService(session, { type: "opportunity", id: opportunityId }),
    getRecommendedPlaybookService(session, opportunityId),
    listEnabledPluginKeys(session),
    session.role === "SALES" ? [] : getAssignableUsersService(session),
    (detail.opportunity.stage === "WON" || detail.opportunity.stage === "LOST")
      ? import("@/core/ai-hub/service").then((m) => m.getLatestOpportunityAttributionService(session, opportunityId)).catch(() => null)
      : null,
  ]);
  const winReview = detail.opportunity.stage === "WON" ? await getWinReviewService(session, opportunityId) : null;
  const insightSnapshot = JSON.stringify(insights);
  return (
    <>
      <OpportunityDetailClient
        key={insightSnapshot}
        initial={detail}
        initialInsights={insights}
        initialWinReview={winReview}
        initialPlaybookRecommendation={playbookRecommendation}
        initialAttribution={initialAttribution}
        canReviewWinReview={session.role === "MANAGER" || session.role === "ADMIN"}
        canTransfer={session.role !== "SALES"}
        assignableUsers={assignableUsers}
        pluginPanels={<PluginOpportunityDetailMounts context={session} enabledPluginKeys={enabledPluginKeys} opportunityId={opportunityId} />}
      />
      <Suspense fallback={<TimelineFallback />}>
        <OpportunityTimeline session={session} opportunityId={opportunityId} limit={limit} />
      </Suspense>
    </>
  );
}

function TimelineFallback() { return <section className="mt-8 border-t border-slate-200 pt-4"><h2 className="text-lg font-semibold">历史记录</h2><p className="py-8 text-sm text-slate-500">正在加载历史记录…</p></section>; }
