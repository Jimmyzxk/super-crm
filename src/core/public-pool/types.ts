export type PublicPoolRuleType =
  | "LEAD_UNTOUCHED"       // 私海线索未跟进回收 (默认 7 天)
  | "LEAD_UNCONVERTED"     // 私海线索长期未成单回收 (默认 30 天)
  | "CUSTOMER_INACTIVE";   // 客户长期未活跃跟进回收 (默认 60 天)

export type PublicPoolRuleItem = {
  id: string;
  ruleType: PublicPoolRuleType;
  thresholdDays: number;
  protectWindowDays: number;
  notifyBeforeHours: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdatePublicPoolRuleInput = {
  ruleType: PublicPoolRuleType;
  thresholdDays: number;
  protectWindowDays?: number;
  notifyBeforeHours?: number;
  isEnabled: boolean;
};

export type PublicPoolRecycleItemPreview = {
  id: string;
  name: string;
  entityType: "LEAD" | "CUSTOMER";
  ownerUserId: string;
  ownerName: string;
  lastActivityAt: string | null;
  claimedAt: string | null;
  daysSinceLastTouch: number;
  reason: string;
  isProtected: boolean;
};

export type PublicPoolRecycleScanResult = {
  scannedAt: string;
  totalEligibleLeads: number;
  totalEligibleCustomers: number;
  totalProtectedItems: number;
  recycledLeadsCount: number;
  recycledCustomersCount: number;
  dryRun: boolean;
  previewItems: PublicPoolRecycleItemPreview[];
  /** 实际回收的线索 id（dryRun 时为空数组），供提交后联动刷新洞察 */
  recycledLeadIds: string[];
};
