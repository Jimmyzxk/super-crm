export type WorkplacePlatform = "WECOM" | "DINGTALK" | "FEISHU" | "GENERIC_WEBHOOK";

export type WorkplaceEventType =
  | "DEAL_WON"                  // 赢单结案喜报
  | "ORDER_CONFIRMED"           // 销售订单生效
  | "CONTRACT_SIGNED"           // 合同盖章签署生效
  | "PAYMENT_RECEIVED"          // 回款入账通知
  | "PROJECT_DELIVERED"         // 项目交付验收
  | "LEAD_ROUTED"               // 规则线索分流
  | "INTERVENTION_REQUESTED"    // 战情室主管协同支援请求
  | "OPPORTUNITY_CREATED"       // 重点商机新立项
  | "LEAD_COLLISION_ALERT"      // 潜客撞单风险预警
  | "PUBLIC_POOL_RECYCLED"      // 公海自动回收播报
  | "AI_INSPECTION_ALERT";      // AI 晨会巡检风险预警

export type WorkplaceIntegrationItem = {
  id: string;
  platform: WorkplacePlatform;
  name: string;
  webhookUrl: string;
  secretKey?: string | null;
  events: WorkplaceEventType[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkplaceIntegrationInput = {
  platform: WorkplacePlatform;
  name: string;
  webhookUrl: string;
  secretKey?: string | null;
  events: WorkplaceEventType[];
  isEnabled?: boolean;
};

export type UpdateWorkplaceIntegrationInput = {
  id: string;
  platform?: WorkplacePlatform;
  name?: string;
  webhookUrl?: string;
  secretKey?: string | null;
  events?: WorkplaceEventType[];
  isEnabled?: boolean;
};

export type WorkplacePushMessage = {
  title: string;
  markdownContent: string;
  event: WorkplaceEventType;
  data?: Record<string, unknown>;
};

export type WorkplacePushResult = {
  integrationId: string;
  platform: WorkplacePlatform;
  success: boolean;
  statusCode?: number;
  error?: string;
};
