import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { getAssignableUsers, getLeadDetail } from "@/core/leads/actions";
import { getSalesInsightsService } from "@/core/insight/service";
import { listEnabledPluginKeys } from "@/plugin-kit/server";
import { PluginLeadDetailMounts } from "@/plugin-kit/PluginMounts";
import LeadDetailClient from "./LeadDetailClient";
import type { AssignableUser, LeadDetail } from "../types";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  const [{ leadId }, query] = await Promise.all([params, searchParams]);
  const [detailResult, usersResult, enabledPluginKeys, insights] = await Promise.all([
    getLeadDetail({ leadId }),
    session.role === "SALES"
      ? Promise.resolve({ ok: true as const, data: [] as AssignableUser[] })
      : getAssignableUsers(),
    listEnabledPluginKeys(session).catch((error: unknown) => {
      console.error("lead plugin mount lookup failed", error instanceof Error ? error.message : "unknown error");
      return [];
    }),
    getSalesInsightsService(session, { type: "lead", id: leadId }).catch(() => []),
  ]);
  if (!detailResult.ok) notFound();
  const detail = detailResult.data as LeadDetail;
  const requestedAction = typeof query.action === "string" ? query.action : undefined;
  const initialPanel = requestedAction === "convert" && detail.lead.status === "QUALIFIED" && Boolean(detail.lead.ownerUserId) ? "convert" : null;

  return (
    <LeadDetailClient
      role={session.role}
      initialDetail={detail}
      assignableUsers={usersResult.ok ? usersResult.data : []}
      initialInsights={insights}
      initialPanel={initialPanel}
      pluginPanels={<PluginLeadDetailMounts context={session} enabledPluginKeys={enabledPluginKeys} leadId={leadId} />}
    />
  );
}
