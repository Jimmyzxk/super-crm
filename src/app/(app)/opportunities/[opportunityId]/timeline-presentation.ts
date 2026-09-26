import type { OpportunityDetail } from "@/core/opportunity/types";

export type TimelineEntry =
  | { kind: "stage"; id: string; occurredAt: string; history: OpportunityDetail["stageHistory"][number] }
  | { kind: "activity"; id: string; occurredAt: string; activity: OpportunityDetail["activities"][number] };

export function presentOpportunityTimeline(stageHistory: OpportunityDetail["stageHistory"], activities: OpportunityDetail["activities"], limit: number, serviceNextLimit: number | null): { entries: TimelineEntry[]; nextLimit: number | null } {
  const merged: TimelineEntry[] = [
    ...stageHistory.map((history) => ({ kind: "stage" as const, id: history.id, occurredAt: history.createdAt, history })),
    ...activities.map((activity) => ({ kind: "activity" as const, id: activity.id, occurredAt: activity.occurredAt, activity })),
  ].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const mergedNextLimit = merged.length > limit && limit < 100 ? Math.min(limit + 20, 100) : null;
  return { entries: merged.slice(0, limit), nextLimit: serviceNextLimit ?? mergedNextLimit };
}
