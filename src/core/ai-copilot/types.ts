export type AiRecommendationType =
  | "NEXT_BEST_ACTION"
  | "OBJECTION_KILLER"
  | "LEAD_PITCH"
  | "HEALTH_DIAGNOSTIC"
  | "MORNING_COPILOT";

export type DealHealthLevel = "STRONG" | "HEALTHY" | "AT_RISK" | "CRITICAL";

export type OpportunityDiagnosticResult = {
  opportunityId: string;
  dealHealth: DealHealthLevel;
  winProbabilityPercent: number; // 0 - 100
  riskFactors: string[];
  positiveFactors: string[];
  nextBestAction: {
    title: string;
    reasoning: string;
    actionType: string;
    suggestedScript: string;
  };
  championTips: string[];
  diagnosedAt: string;
  isRealLlm?: boolean;
  isCached?: boolean;
  provider?: string;
  modelName?: string;
};

export type ObjectionType =
  | "PRICE_TOO_HIGH"
  | "PREFER_COMPETITOR"
  | "NO_BUDGET"
  | "DELAYED_TIMING"
  | "NEED_INTERNAL_CONSENSUS";

export type ObjectionKillerScript = {
  objectionType: ObjectionType;
  objectionLabel: string;
  pitchSummary: string;
  psychologyBreakdown: string;
  talkTracks: Array<{
    stepNumber: number;
    stepName: string;
    suggestedTalk: string;
    actionTip: string;
  }>;
  isRealLlm?: boolean;
  isCached?: boolean;
  provider?: string;
  modelName?: string;
};

export type LeadPitchScript = {
  leadId: string;
  hook: string;
  valueProposition: string;
  callToAction: string;
  fullPitch: string;
  wechatFriendRequest?: string;
  wechatFirstMessage?: string;
  phoneOpening?: string;
  generatedAt: string;
  isRealLlm?: boolean;
  isCached?: boolean;
  provider?: string;
  modelName?: string;
};

export type AiRecommendationItem = {
  id: string;
  opportunityId?: string | null;
  leadId?: string | null;
  customerId?: string | null;
  recommendationType: AiRecommendationType;
  title: string;
  content: string;
  suggestedAction?: Record<string, unknown> | null;
  confidenceScore: number;
  isApplied: boolean;
  feedbackVerdict?: "HELPFUL" | "NOT_HELPFUL" | "NOT_APPLICABLE" | null;
  createdAt: string;
  updatedAt: string;
};
