import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { getAssignableUsers } from "@/core/leads/actions";
import { getSecurityComplianceConfigService } from "@/core/security/service";
import { listLeadsAction } from "./actions";
import LeadsClient from "./LeadsClient";
import type { AssignableUser, LeadPage } from "./types";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; filter?: string; sort?: string; cursor?: string }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  const params = await searchParams;
  const filters = ["all", "overdue", "high-score", "duplicate", "unassigned", "discarded", "converted"] as const;
  const sorts = ["priority", "created", "score"] as const;
  const filter = params.filter && filters.includes(params.filter as (typeof filters)[number])
    ? params.filter as (typeof filters)[number]
    : "all";
  const sort = params.sort && sorts.includes(params.sort as (typeof sorts)[number])
    ? params.sort as (typeof sorts)[number]
    : "priority";
  const search = params.search ?? "";
  const [pageResult, usersResult, securityConfig] = await Promise.all([
    listLeadsAction({ filter, sort, search, cursor: params.cursor }),
    session.role === "SALES"
      ? Promise.resolve({ ok: true as const, data: [] as AssignableUser[] })
      : getAssignableUsers(),
    getSecurityComplianceConfigService(session),
  ]);

  const initialPage: LeadPage = pageResult.ok ? pageResult.data : { items: [] };
  const assignableUsers: AssignableUser[] = usersResult.ok ? usersResult.data : [];

  return (
    <LeadsClient
      role={session.role}
      initialPage={initialPage}
      initialAssignableUsers={assignableUsers}
      initialSearch={search}
      initialFilter={filter}
      initialSort={sort}
      isAiCopilotEnabled={securityConfig.isAiCopilotEnabled}
    />
  );
}
