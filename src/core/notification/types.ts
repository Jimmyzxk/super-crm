export type NotificationType =
  | "TASK_OVERDUE"
  | "TASK_DUE_SOON"
  | "LEAD_ASSIGNED"
  | "RECYCLE_WARNING"
  | "RECYCLE_EXECUTED"
  | "DIRECTORY_SYNC_COMPLETED"
  | "PAYMENT_RECEIVED"
  | "INVOICE_REMINDER"
  | "CONTRACT_SIGNED"
  | "ORDER_CONFIRMED"
  | "PROJECT_DELIVERED"
  | "DEAL_WON"
  | "CONTRACT_APPROVAL_REQUESTED"
  | "CONTRACT_APPROVED"
  | "CONTRACT_REJECTED"
  | "CONTRACT_EXPIRING_SOON"
  | "SCHEDULE_PAYMENT_OVERDUE"
  | "CONTRACT_REVISION_REQUESTED"
  | "CONTRACT_REVISION_AUDITED"
  | "MORNING_COPILOT";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: NotificationItem[];
  unreadCount: number;
  totalCount?: number;
  nextLimit: number | null;
};

export type NotificationScanResult = {
  tenantsScanned: number;
  overdueCreated: number;
  dueSoonCreated: number;
  cleaned: number;
  elapsedMs: number;
};
