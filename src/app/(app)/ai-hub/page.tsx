import { requireSession } from "@/core/auth/session";
import {
  getAiHubOverviewService,
  listAgentLearningLogsService,
  listPromptTemplatesService,
  listQualityInspectionsService,
} from "@/core/ai-hub/service";
import { getSecurityComplianceConfigService } from "@/core/security/service";
import { getAdoptionStatsService } from "@/core/ai-hub/morning-copilot-service";
import AiHubClient from "./AiHubClient";

export default async function AiHubPage() {
  const session = await requireSession();

  const [overview, promptTemplates, inspections, learningLogs, securityConfig, adoptionStats, closedOpportunities, insightReports] =
    await Promise.all([
      getAiHubOverviewService(session),
      listPromptTemplatesService(session),
      listQualityInspectionsService(session),
      listAgentLearningLogsService(session),
      getSecurityComplianceConfigService(session).catch(() => ({
        id: "default",
        isAiCopilotEnabled: false,
        aiProvider: "BUILTIN" as const,
        aiApiKeyMasked: null,
        aiApiEndpoint: null,
        aiModelName: "deepseek-chat",
        aiTemperature: 0.3,
        isPhoneMaskingEnabled: false,
        isEmailMaskingEnabled: false,
        exportRequiresApproval: false,
        sessionTimeoutMinutes: 120,
        watermarkEnabled: true,
        updatedAt: new Date().toISOString(),
      })),
      session.role !== "SALES" ? getAdoptionStatsService(session, 7).catch(() => null) : Promise.resolve(null),
      import("@/core/ai-hub/service").then((m) => m.listClosedOpportunitiesService(session)).catch(() => []),
      import("@/core/ai-hub/service").then((m) => m.listInsightReportsService(session)).catch(() => []),
    ]);

  return (
    <AiHubClient
      initialOverview={overview}
      initialPromptTemplates={promptTemplates}
      initialInspections={inspections}
      initialLearningLogs={learningLogs}
      initialSecurityConfig={securityConfig}
      initialAdoptionStats={adoptionStats}
      initialClosedOpportunities={closedOpportunities}
      initialInsightReports={insightReports}
      currentUserRole={session.role}
    />
  );
}
