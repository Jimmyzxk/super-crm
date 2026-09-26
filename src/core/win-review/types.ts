export type WinReviewStatus = "DRAFT" | "REVIEWED" | "REJECTED";

export type WinReview = {
  id: string;
  opportunityId: string;
  status: WinReviewStatus;
  summary: string;
  metrics: Record<string, unknown>;
  evidence: Array<Record<string, unknown>>;
  dataGaps: string[];
  generationFailedAt: string | null;
  generationAttempts: number;
  reviewedByName: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
