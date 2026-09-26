export type SalesWorkSubjectType = "lead" | "customer" | "opportunity";

export type SalesWorkItem = {
  taskId: string;
  subjectType: SalesWorkSubjectType;
  subjectId: string;
  subjectName: string;
  subjectContext: string;
  ownerName: string;
  taskType: string;
  dueAt: string;
  isOverdue: boolean;
  score: number | null;
  scoreReason: string | null;
  stage: string | null;
  customerId: string | null;
};

export type ActiveOpportunityStage = "DISCOVERY" | "PROPOSAL" | "NEGOTIATION";

export type OpportunityStageDistribution = {
  stage: ActiveOpportunityStage;
  count: number;
};

export type OwnerOpenTaskLoad = {
  userId: string;
  userName: string;
  openTaskCount: number;
};

export type ManagerWorkbench = {
  unassignedLeads: number;
  overdueLeads: number;
  stalledOpportunities: number;
  activeOpportunityStages: OpportunityStageDistribution[];
  ownerLoad: OwnerOpenTaskLoad[];
  countCeiling: number;
};

export type AdminWorkbench = {
  sourceKeys: { enabled: number; total: number };
  scoreRules: { enabled: number; total: number };
  duplicateLeads: number;
  unassignedLeads: number;
  insightRefreshFailures: number;
  countCeiling: number;
};
