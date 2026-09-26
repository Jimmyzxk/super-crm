export type LeadRole = "ADMIN" | "MANAGER" | "SALES";

export type LeadFilter = "all" | "unassigned" | "overdue" | "high-score" | "duplicate" | "discarded" | "converted";
export type LeadSort = "priority" | "created" | "score";

export type Lead = {
  id: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string | null;
  companyName?: string | null;
  title?: string | null;
  intendedProductId?: string | null;
  intendedProduct?: string | null;
  intendedProductCode?: string | null;
  intendedProductCategory?: string | null;
  intendedProductUnitPrice?: number | null;
  intendedProductPricingModel?: string | null;
  intendedProductUnit?: string | null;
  budget?: string | null;
  channel?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  note?: string | null;
  source: string;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "DISCARDED";
  score?: number | null;
  scoreReason?: string | null;
  isPossibleDuplicate: boolean;
  ownerName?: string | null;
  ownerUserId?: string | null;
  createdAt: string | Date;
  openTask?: {
    id: string;
    type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH";
    dueAt: string | Date;
  } | null;
  lastActivity?: {
    type: "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
    outcome?: "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED" | null;
    summary: string;
    occurredAt: string | Date;
  } | null;
};

export type LeadStatus = Lead["status"];

export type LeadDetail = {
  lead: Lead & {
    updatedAt: string | Date;
    discardReason?: string | null;
    discardNote?: string | null;
    sourceName?: string | null;
    sourceKey?: string | null;
    externalId?: string | null;
    sourceLabel?: string | null;
    receivedAt?: string | Date | null;
  };
  statusHistory: Array<{
    id: string | number;
    fromStatus?: LeadStatus | null;
    toStatus: LeadStatus;
    reason?: string | null;
    actorUserId: string;
    actorName: string;
    createdAt: string | Date;
  }>;
  activities: Array<{
    id: string;
    type: "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
    outcome?: "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED" | null;
    summary: string;
    occurredAt: string | Date;
    userId: string;
    userName: string;
  }>;
  openTask?: {
    id: string;
    type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH";
    dueAt: string | Date;
    assigneeUserId: string;
    assigneeName: string;
  } | null;
  possibleDuplicates: Array<{
    id: string;
    contactName: string;
    companyName?: string | null;
    status: LeadStatus;
    ownerName?: string | null;
  }>;
  existingCustomerMatch?: { id: string; name: string; ownerName: string; contactName: string; contactPhone: string; contactEmail: string | null; contactTitle: string | null } | null;
  restrictedCustomerMatch?: boolean;
  convertedCustomer?: { id: string; name: string } | null;
  convertedOpportunity?: { id: string; name: string } | null;
  scoreFeedback?: {
    verdict: "ACCURATE" | "INACCURATE";
    scoreAtFeedback: number;
    updatedAt: string | Date;
  } | null;
};

export type LeadPage = {
  items: Lead[];
  nextCursor?: string | null;
  counts?: Partial<Record<LeadFilter, number>>;
  countCeiling?: number;
};

export type AssignableUser = { id: string; name: string; role?: LeadRole | string };

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; field?: string };

export type CreateLeadResult = {
  created: boolean;
  leadId?: string;
  reactivated?: boolean;
  claimed?: boolean;
  collision?: {
    collisionType: "NONE" | "ACTIVE_PRIVATE_LEAD" | "SELF_LEAD" | "PUBLIC_POOL_LEAD" | "EXISTING_CUSTOMER_CONTACT" | "DISCARDED_LEAD";
    message: string;
    leadId?: string;
    customerId?: string;
    customerName?: string;
    contactName?: string;
    ownerUserId?: string | null;
    ownerName?: string | null;
    isSelfOwner?: boolean;
    canReactivate?: boolean;
    canClaim?: boolean;
  };
  duplicateOf?: {
    leadId: string;
    contactName: string;
    companyName?: string | null;
    ownerName?: string | null;
  };
};

export type ImportPreview = {
  valid: Array<{ row: number; data: LeadImportRow }>;
  duplicates: Array<{ row: number; data: LeadImportRow; reason?: string }>;
  errors: Array<{ row: number; message: string }>;
};

export type LeadImportRow = {
  contactName: string; contactPhone: string; contactEmail?: string;
  companyName?: string; title?: string; note?: string;
};

export type ImportCommitErrorItem = {
  rowNumber: number;
  contactMasked: string;
  reason: string;
};

export type ImportCommitResult = {
  created: number;
  skipped: number;
  failed: number;
  errors?: ImportCommitErrorItem[];
};

export function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: string | Date): string {
  return asDate(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDue(value: string | Date): { label: string; overdue: boolean } {
  const due = asDate(value);
  const diff = Date.now() - due.getTime();
  if (diff > 0) {
    const hours = Math.max(1, Math.floor(diff / 3_600_000));
    return { label: hours >= 24 ? `已超时 ${Math.floor(hours / 24)} 天` : `已超时 ${hours} 小时`, overdue: true };
  }
  const hours = Math.max(1, Math.ceil(-diff / 3_600_000));
  return { label: hours >= 24 ? `还有 ${Math.floor(hours / 24)} 天` : `还有 ${hours} 小时`, overdue: false };
}

export function sourceLabel(source: string): string {
  if (source === "manual") return "手工录入";
  if (source === "import") return "CSV 导入";
  if (source.startsWith("form:")) return "表单获客";
  if (source.startsWith("api:")) return "外部 API";
  return source;
}

export function statusLabel(status: LeadStatus): string {
  if (status === "NEW") return "新线索";
  if (status === "CONTACTED") return "跟进中";
  if (status === "QUALIFIED") return "需求已确认";
  if (status === "CONVERTED") return "已转客户";
  return "已放弃";
}
