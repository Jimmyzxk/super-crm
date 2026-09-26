import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import {
  getExecutiveForecastService,
  getSalesRadarService,
  getTeamEfficiencyService,
  listAnalyticsTeamMembersService,
} from "@/core/analytics/service";
import AnalyticsClient from "./AnalyticsClient";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  // 根据角色加载对应数据
  const isManagerOrAdmin = session.role === "MANAGER" || session.role === "ADMIN";

  const [salesRadar, teamEfficiency, executiveForecast, teamMembers] = await Promise.all([
    getSalesRadarService(session),
    isManagerOrAdmin ? getTeamEfficiencyService(session) : Promise.resolve(null),
    isManagerOrAdmin ? getExecutiveForecastService(session) : Promise.resolve(null),
    isManagerOrAdmin ? listAnalyticsTeamMembersService(session) : Promise.resolve([]),
  ]);

  return (
    <AnalyticsClient
      role={session.role}
      initialSalesRadar={salesRadar}
      initialTeamEfficiency={teamEfficiency}
      initialExecutiveForecast={executiveForecast}
      teamMembers={teamMembers}
    />
  );
}
