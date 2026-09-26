import type { TenantContext, TenantTransaction } from "@/core/tenant";
import type { LeadInput } from "@/core/leads/types";

export type { TenantContext, TenantTransaction, LeadInput };

export type PluginCore = {
  createLead(input: unknown): Promise<{ leadId: string | null; duplicateSuspected: boolean; collisionType?: string }>;
};

export type PluginServerContext = {
  tenant: TenantContext;
  core: PluginCore;
};

export type PluginLeadContext = {
  pluginKey: string;
  formId?: string;
  auditDetail?: Record<string, unknown>;
};

export type PluginLeadInput = LeadInput;

export type PluginOffboardTransferResult = {
  pluginKey: string;
  transferredCount: number;
  detail: Record<string, unknown>;
};

export type PluginOffboardHandler = (
  tx: TenantTransaction,
  ctx: TenantContext,
  targetUserId: string,
  transferToUserId: string
) => Promise<PluginOffboardTransferResult>;
