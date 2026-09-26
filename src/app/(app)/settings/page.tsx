import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { listLeadSourceKeysService } from "@/core/leads/service";
import { getScoreFeedbackStatsService, listScoreRulesService } from "@/core/scoring/service";
import { listPublicPoolRulesService } from "@/core/public-pool/service";
import { listWorkplaceIntegrationsService } from "@/core/workplace/service";
import { PluginSettingsMounts } from "@/plugin-kit/PluginMounts";
import { getSecurityComplianceConfigService } from "@/core/security/service";
import { getCustomerCollaborationSettingsService } from "@/core/collaboration/service";
import SettingsHubClient from "./SettingsHubClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "系统配置 - 商脉AI CRM",
  description: "统一维护企业数据安全策略、公海流转规则、客户协同与防撞单、AI 智能评分引擎、开放接口与扩展应用生态",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireSession().catch(() => null);
  if (!session) {
    redirect("/login");
  }
  if (session.role !== "ADMIN") {
    redirect("/today");
  }

  const params = searchParams ? await searchParams : {};
  const initialTab = typeof params?.tab === "string" ? params.tab : undefined;

  const [
    sourceKeys,
    scoreRules,
    feedbackStats,
    publicPoolRules,
    workplaceIntegrations,
    securityConfig,
    collaborationSettings,
  ] = await Promise.all([
    listLeadSourceKeysService(session),
    listScoreRulesService(session),
    getScoreFeedbackStatsService(session),
    listPublicPoolRulesService(session),
    listWorkplaceIntegrationsService(session),
    getSecurityComplianceConfigService(session),
    getCustomerCollaborationSettingsService(session),
  ]);

  return (
    <SettingsHubClient
      initialTab={initialTab}
      sourceKeys={sourceKeys}
      scoreRules={scoreRules}
      feedbackStats={feedbackStats}
      publicPoolRules={publicPoolRules}
      workplaceIntegrations={workplaceIntegrations}
      securityConfig={securityConfig}
      collaborationSettings={collaborationSettings}
      pluginsNode={<PluginSettingsMounts context={session} />}
    />
  );
}


