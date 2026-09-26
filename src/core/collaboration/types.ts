export type InterventionType =
  | "EXECUTIVE_SPONSOR"
  | "DISCOUNT_APPROVAL"
  | "SOLUTION_SUPPORT"
  | "STRATEGY_COACHING";

export type InterventionStatus = "REQUESTED" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";

export type DealInterventionItem = {
  id: string;
  opportunityId: string;
  opportunityName?: string;
  customerName?: string;
  expectedAmount?: number | null;
  requesterUserId: string;
  requesterName?: string;
  assignedManagerId: string | null;
  assignedManagerName?: string | null;
  interventionType: InterventionType;
  status: InterventionStatus;
  requestNote: string;
  managerFeedback: string | null;
  coachingNotes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RequestInterventionInput = {
  opportunityId: string;
  interventionType: InterventionType;
  requestNote: string;
  assignedManagerId?: string | null;
};

export type ResolveInterventionInput = {
  interventionId: string;
  status: "RESOLVED" | "REJECTED";
  managerFeedback: string;
  coachingNotes?: string;
};

export type InterventionWinRateAnalytics = {
  withInterventionWonCount: number;
  withInterventionTotalCount: number;
  withInterventionWonRate: number;
  withoutInterventionWonCount: number;
  withoutInterventionTotalCount: number;
  withoutInterventionWonRate: number;
  liftPercentage: number;
};

export type CustomerCollaborationSettings = {
  id?: string;
  allowMultiSalesFollowup: boolean;
  requireProductExclusivity?: boolean;
  updatedAt?: string;
};

export type UpdateCustomerCollaborationSettingsInput = {
  allowMultiSalesFollowup: boolean;
  requireProductExclusivity?: boolean;
};

