import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import TodayInsightsClient from "./TodayInsightsClient";
import { getTodayInsights } from "./insights";
import TodayWorkQueueClient from "./TodayWorkQueueClient";
import SmartCalendarClient from "./SmartCalendarClient";
import GamifiedLeaderboardClient from "./GamifiedLeaderboardClient";
import {
  getAdminWorkbenchService,
  getManagerWorkbenchService,
  listSalesWorkItemsService,
} from "@/core/workbench/service";
import { listSalesSchedulesService } from "@/core/schedule/service";
import { getSalesLeaderboardService } from "@/core/workbench/leaderboard";
import { listDealInterventionsService } from "@/core/collaboration/service";
import { scanPublicPoolPreRecycleWarningsService } from "@/core/public-pool/service";
import ManagerWorkbench from "./ManagerWorkbench";
import AdminWorkbench from "./AdminWorkbench";

import MorningCopilotCardClient from "./MorningCopilotCardClient";
import { getTodayMorningRecommendationsService } from "@/core/ai-hub/morning-copilot-service";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  if (session.role === "MANAGER") {
    const [summary, pendingInterventions, leaderboard] = await Promise.all([
      getManagerWorkbenchService(session),
      listDealInterventionsService(session, { status: "REQUESTED" }),
      getSalesLeaderboardService(session, "MONTHLY"),
    ]);

    return (
      <PageFrame
        title="今日工作台（团队主管看板）"
        subtitle="团队线索分配饱和度、SLA 响应时效、战情室协同介入与团队战报榜单全景"
      >
        <ManagerWorkbench data={summary} pendingInterventions={pendingInterventions} />
        <GamifiedLeaderboardClient initialData={leaderboard} />
      </PageFrame>
    );
  }

  if (session.role === "ADMIN") {
    const [summary, leaderboard] = await Promise.all([
      getAdminWorkbenchService(session),
      getSalesLeaderboardService(session, "MONTHLY"),
    ]);

    return (
      <PageFrame
        title="今日工作台（系统治理概览）"
        subtitle="全租户数据质量治理、自动化评分规则监控与全员业绩排行榜"
      >
        <AdminWorkbench data={summary} />
        <GamifiedLeaderboardClient initialData={leaderboard} />
      </PageFrame>
    );
  }

  const [insights, workItems, schedules, leaderboard, preRecycleWarnings, morningRecs] = await Promise.all([
    getTodayInsights(session),
    listSalesWorkItemsService(session),
    listSalesSchedulesService(session),
    getSalesLeaderboardService(session, "MONTHLY"),
    scanPublicPoolPreRecycleWarningsService(session),
    getTodayMorningRecommendationsService(session, session.userId).catch(() => []),
  ]);

  return (
    <PageFrame
      title="今日工作台（销售待办）"
      subtitle="实时聚焦待触达线索、SLA 响应预警、公海临期预警、智能工作日历与实时战报榜单"
    >
      <MorningCopilotCardClient initialRecommendations={morningRecs} />
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-6">
          <TodayWorkQueueClient
            initial={workItems}
            recycleWarnings={preRecycleWarnings.warnings}
          />
          <SmartCalendarClient initialSchedules={schedules} />
        </div>
        <div className="xl:col-span-4 space-y-6">
          <GamifiedLeaderboardClient initialData={leaderboard} />
          <TodayInsightsClient initial={insights} />
        </div>
      </div>
    </PageFrame>
  );
}

function PageFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              工作空间
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">{title}</h1>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {subtitle ?? "实时聚焦待触达线索、SLA 响应预警与重点推进商机"}
          </p>
        </div>
      </header>
      {children}
    </section>
  );
}
