import type { OpportunityStage } from "./rules";

export type InsightSubjectType = "lead" | "opportunity";
export type InsightDismissReason = "NOT_APPLICABLE" | "ALREADY_HANDLED" | "WRONG_INFORMATION" | "OTHER";

export type InsightTaskFact = {
  id: string;
  type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH";
  status: "OPEN";
  dueAt: string;
};

export type InsightListItem = {
  id: string;
  code: string;
  severity: "INFO" | "ATTENTION" | "HIGH_RISK";
  status: "OPEN" | "ACCEPTED" | "DISMISSED" | "EXPIRED";
  title: string;
  summary: string;
  suggestedAction: string;
  suggestedDueAt: string | null;
  evidence: unknown[];
  sourceType: "RULE" | "PLAYBOOK" | "MODEL";
  sourceVersion: string;
  acceptedTaskId: string | null;
  refreshFailedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsightFactsRow = {
  activities: Array<{
    id: string;
    type: "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
    outcome: "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED" | null;
    summary: string;
    occurredAt: string;
  }>;
  openTask: InsightTaskFact | null;
  active?: boolean;
  stage?: OpportunityStage;
  stageEnteredAt?: string;
  latestValidProgressAt?: string;
};
