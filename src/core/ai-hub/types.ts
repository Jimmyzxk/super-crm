export type AiPromptScene =
  | "OPPORTUNITY_DIAGNOSTIC"
  | "OBJECTION_KILLER"
  | "LEAD_OUTREACH"
  | "DEAL_INSPECTION"
  | "MEETING_SUMMARY";

export interface AiPromptTemplateItem {
  id: string;
  scene: AiPromptScene;
  name: string;
  description: string | null;
  systemPrompt: string;
  userPromptTemplate: string;
  variables: string[];
  isActive: boolean;
  version: number;
  updatedAt: string;
}

export interface UpsertPromptTemplateInput {
  id?: string;
  scene: AiPromptScene;
  name: string;
  description?: string;
  systemPrompt: string;
  userPromptTemplate: string;
  variables?: string[];
  isActive?: boolean;
}

export interface AiQualityInspectionItem {
  id: string;
  opportunityId: string;
  opportunityTitle?: string;
  customerName?: string;
  inspectorAgent: string;
  score: number;
  verdict: "PASSED" | "NEEDS_ATTENTION" | "HIGH_RISK";
  dimensions: {
    decisionMakerVerified: boolean;
    pricingLineItemsConfigured: boolean;
    followupSlaHealthy: boolean;
    guardrailsCompliant: boolean;
  };
  findings: string[];
  actionRecommendations: string[];
  createdAt: string;
}

export interface AiAgentLearningLogItem {
  id: string;
  sourceType: "WIN_REVIEW" | "SALES_FEEDBACK" | "EXEMPLAR_PLAYBOOK";
  sourceId: string | null;
  topic: string;
  extractedStrategy: string;
  sampleDialogue: string | null;
  effectivenessScore: number;
  isPromotedToPool: boolean;
  createdAt: string;
}

export interface AiHubOverviewMetrics {
  totalInspectionsCount: number;
  averageInspectionScore: number;
  highRiskDealCount: number;
  promptTemplateCount: number;
  learnedStrategiesCount: number;
  feedbackAdoptionRatePercent: number;
  recentInspections: AiQualityInspectionItem[];
  recentLearnings: AiAgentLearningLogItem[];
}

export type AiInsightReportKind = "CHAMPION_ANALYSIS" | "COMPANY_PROFILE";
export type AiInsightConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface AiInsightReportItem {
  id: string;
  kind: AiInsightReportKind;
  period: string; // e.g. "2026-09"
  content: string;
  evidence: Record<string, unknown>;
  sampleSize: number;
  confidence: AiInsightConfidence;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveInsightReportInput {
  kind: AiInsightReportKind;
  period?: string;
  content: string;
  evidence?: Record<string, unknown>;
  sampleSize?: number;
  confidence?: AiInsightConfidence;
}

export interface OpportunityAttributionTrace {
  rounds: number;
  toolsUsed: string[];
  evidenceCount: number;
  outcome: string;
  direction?: "WON" | "LOST" | "UNKNOWN";
  createdAt: string;
}
