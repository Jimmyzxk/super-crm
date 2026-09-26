export type ScheduleType = "CALL" | "MEETING" | "VISIT" | "PROPOSAL_DEMO" | "FOLLOW_UP";
export type ScheduleStatus = "PENDING" | "COMPLETED" | "CANCELLED";

export type SalesScheduleItem = {
  id: string;
  userId: string;
  userName?: string;
  title: string;
  scheduleType: ScheduleType;
  leadId: string | null;
  leadName?: string | null;
  customerId: string | null;
  customerName?: string | null;
  opportunityId: string | null;
  opportunityName?: string | null;
  startAt: string;
  endAt: string | null;
  note: string | null;
  status: ScheduleStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduleInput = {
  title: string;
  scheduleType: ScheduleType;
  leadId?: string | null;
  customerId?: string | null;
  opportunityId?: string | null;
  startAt: Date | string;
  endAt?: Date | string | null;
  note?: string | null;
};

export type UpdateScheduleInput = {
  id: string;
  title?: string;
  scheduleType?: ScheduleType;
  startAt?: Date | string;
  endAt?: Date | string | null;
  note?: string | null;
  status?: ScheduleStatus;
};
