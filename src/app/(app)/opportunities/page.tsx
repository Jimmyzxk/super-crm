import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listOpportunitiesService } from "@/core/opportunity/service";
import { getAssignableUsersService } from "@/core/leads/service";
import {
  getInterventionWinRateAnalyticsService,
  listDealInterventionsService,
} from "@/core/collaboration/service";
import { getSecurityComplianceConfigService } from "@/core/security/service";
import OpportunityListClient from "./OpportunityListClient";
import { opportunityFilters, type OpportunityFilter } from "@/core/opportunity/types";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    filter?: "active" | "stalled" | "month" | "won" | "lost";
    cursor?: string;
  }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");
  const params = await searchParams;
  const filter: OpportunityFilter =
    params.filter && opportunityFilters.includes(params.filter) ? params.filter : "active";

  const [oppList, interventions, winRateAnalytics, securityConfig, assignableUsers] = await Promise.all([
    listOpportunitiesService(session, {
      filter,
      search: params.search,
      cursor: params.cursor,
    }),
    listDealInterventionsService(session),
    getInterventionWinRateAnalyticsService(session),
    getSecurityComplianceConfigService(session),
    session.role === "SALES" ? [] : getAssignableUsersService(session),
  ]);

  return (
    <OpportunityListClient
      initial={oppList}
      filter={filter}
      search={params.search ?? ""}
      interventions={interventions}
      winRateAnalytics={winRateAnalytics}
      isAiCopilotEnabled={securityConfig.isAiCopilotEnabled}
      canTransfer={session.role !== "SALES"}
      assignableUsers={assignableUsers}
    />
  );
}

