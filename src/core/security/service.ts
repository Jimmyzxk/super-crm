import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";

export type SecurityComplianceConfigItem = {
  id: string;
  isAiCopilotEnabled: boolean;
  aiProvider: "BUILTIN" | "OPENAI" | "DEEPSEEK" | "ZHIPU" | "QWEN" | "GEMINI" | "CUSTOM";
  /** 明文 Key 只留在数据库内供网关使用，对外（含管理界面）只回传掩码 */
  aiApiKeyMasked: string | null;
  aiApiEndpoint: string | null;
  aiModelName: string;
  aiTemperature: number;
  isPhoneMaskingEnabled: boolean;
  isEmailMaskingEnabled: boolean;
  exportRequiresApproval: boolean;
  sessionTimeoutMinutes: number;
  watermarkEnabled: boolean;
  updatedAt: string;
};

export type UpdateSecurityConfigInput = {
  isAiCopilotEnabled?: boolean;
  aiProvider?: "BUILTIN" | "OPENAI" | "DEEPSEEK" | "ZHIPU" | "QWEN" | "GEMINI" | "CUSTOM";
  aiApiKey?: string | null;
  aiApiEndpoint?: string | null;
  aiModelName?: string;
  aiTemperature?: number;
  isPhoneMaskingEnabled?: boolean;
  isEmailMaskingEnabled?: boolean;
  exportRequiresApproval?: boolean;
  sessionTimeoutMinutes?: number;
  watermarkEnabled?: boolean;
};

import { cache } from "react";
import { encryptSecret, decryptSecret } from "./crypto";

export { encryptSecret, decryptSecret, maskSecretKey } from "./crypto";

/** 只保留末 4 位用于辨认，其余以圆点替代；空值原样返回 null */
function maskApiKey(raw: string | null): string | null {
  const plain = decryptSecret(raw);
  if (!plain) return null;
  const tail = plain.slice(-4);
  return `••••${tail}`;
}

export const getSecurityComplianceConfigService = cache(async function getSecurityComplianceConfigService(
  tenant: TenantContext,
): Promise<SecurityComplianceConfigItem> {
  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      is_ai_copilot_enabled: boolean;
      ai_provider: string;
      ai_api_key: string | null;
      ai_api_endpoint: string | null;
      ai_model_name: string;
      ai_temperature: string;
      is_phone_masking_enabled: boolean;
      is_email_masking_enabled: boolean;
      export_requires_approval: boolean;
      session_timeout_minutes: number;
      watermark_enabled: boolean;
      updated_at: string;
    }>(sql`
      select
        id,
        is_ai_copilot_enabled,
        coalesce(ai_provider, 'BUILTIN') as ai_provider,
        ai_api_key,
        ai_api_endpoint,
        coalesce(ai_model_name, 'deepseek-chat') as ai_model_name,
        coalesce(ai_temperature, '0.30') as ai_temperature,
        is_phone_masking_enabled,
        is_email_masking_enabled,
        export_requires_approval,
        session_timeout_minutes,
        watermark_enabled,
        updated_at::text as updated_at
      from public.security_compliance_configs
      where tenant_id = ${tenant.tenantId}
      limit 1
    `);

    if (res.rows.length === 0) {
      return {
        id: "default",
        isAiCopilotEnabled: false,
        aiProvider: "BUILTIN",
        aiApiKeyMasked: null,
        aiApiEndpoint: null,
        aiModelName: "deepseek-chat",
        aiTemperature: 0.3,
        isPhoneMaskingEnabled: false,
        isEmailMaskingEnabled: false,
        exportRequiresApproval: false,
        sessionTimeoutMinutes: 120,
        watermarkEnabled: true,
        updatedAt: new Date().toISOString(),
      };
    }

    const row = res.rows[0];
    return {
      id: row.id,
      isAiCopilotEnabled: row.is_ai_copilot_enabled ?? false,
      aiProvider: (row.ai_provider as SecurityComplianceConfigItem["aiProvider"]) || "BUILTIN",
      aiApiKeyMasked: maskApiKey(row.ai_api_key),
      aiApiEndpoint: row.ai_api_endpoint,
      aiModelName: row.ai_model_name || "deepseek-chat",
      aiTemperature: Number(row.ai_temperature) || 0.3,
      isPhoneMaskingEnabled: row.is_phone_masking_enabled ?? false,
      isEmailMaskingEnabled: row.is_email_masking_enabled ?? false,
      exportRequiresApproval: row.export_requires_approval ?? false,
      sessionTimeoutMinutes: row.session_timeout_minutes ?? 120,
      watermarkEnabled: row.watermark_enabled ?? true,
      updatedAt: row.updated_at,
    };
  });
});

export async function upsertSecurityComplianceConfigService(
  tenant: TenantContext,
  input: UpdateSecurityConfigInput,
): Promise<SecurityComplianceConfigItem> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅管理员可调整数据安全与功能配置");
  }

  const encApiKey = input.aiApiKey !== undefined ? (input.aiApiKey ? encryptSecret(input.aiApiKey) : null) : undefined;

  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      is_ai_copilot_enabled: boolean;
      ai_provider: string;
      ai_api_key: string | null;
      ai_api_endpoint: string | null;
      ai_model_name: string;
      ai_temperature: string;
      is_phone_masking_enabled: boolean;
      is_email_masking_enabled: boolean;
      export_requires_approval: boolean;
      session_timeout_minutes: number;
      watermark_enabled: boolean;
      updated_at: string;
    }>(sql`
      insert into public.security_compliance_configs (
        tenant_id,
        is_ai_copilot_enabled,
        ai_provider,
        ai_api_key,
        ai_api_endpoint,
        ai_model_name,
        ai_temperature,
        is_phone_masking_enabled,
        is_email_masking_enabled,
        export_requires_approval,
        session_timeout_minutes,
        watermark_enabled,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.isAiCopilotEnabled ?? false},
        ${input.aiProvider ?? "BUILTIN"},
        ${encApiKey ?? (input.aiApiKey ? encryptSecret(input.aiApiKey) : null)},
        ${input.aiApiEndpoint ?? null},
        ${input.aiModelName ?? "deepseek-chat"},
        ${input.aiTemperature ?? 0.30},
        ${input.isPhoneMaskingEnabled ?? false},
        ${input.isEmailMaskingEnabled ?? false},
        ${input.exportRequiresApproval ?? false},
        ${input.sessionTimeoutMinutes ?? 120},
        ${input.watermarkEnabled ?? true},
        now(),
        now()
      )
      on conflict (tenant_id)
      do update set
        is_ai_copilot_enabled = coalesce(${input.isAiCopilotEnabled ?? null}, security_compliance_configs.is_ai_copilot_enabled),
        ai_provider = coalesce(${input.aiProvider ?? null}, security_compliance_configs.ai_provider),
        ai_api_key = case when ${input.aiApiKey !== undefined} then ${encApiKey ?? null} else security_compliance_configs.ai_api_key end,
        ai_api_endpoint = case when ${input.aiApiEndpoint !== undefined} then ${input.aiApiEndpoint ?? null} else security_compliance_configs.ai_api_endpoint end,
        ai_model_name = coalesce(${input.aiModelName ?? null}, security_compliance_configs.ai_model_name),
        ai_temperature = coalesce(${input.aiTemperature ?? null}, security_compliance_configs.ai_temperature),
        is_phone_masking_enabled = coalesce(${input.isPhoneMaskingEnabled ?? null}, security_compliance_configs.is_phone_masking_enabled),
        is_email_masking_enabled = coalesce(${input.isEmailMaskingEnabled ?? null}, security_compliance_configs.is_email_masking_enabled),
        export_requires_approval = coalesce(${input.exportRequiresApproval ?? null}, security_compliance_configs.export_requires_approval),
        session_timeout_minutes = coalesce(${input.sessionTimeoutMinutes ?? null}, security_compliance_configs.session_timeout_minutes),
        watermark_enabled = coalesce(${input.watermarkEnabled ?? null}, security_compliance_configs.watermark_enabled),
        updated_at = now()
      returning
        id,
        is_ai_copilot_enabled,
        ai_provider,
        ai_api_key,
        ai_api_endpoint,
        ai_model_name,
        ai_temperature,
        is_phone_masking_enabled,
        is_email_masking_enabled,
        export_requires_approval,
        session_timeout_minutes,
        watermark_enabled,
        updated_at::text as updated_at
    `);

    const row = res.rows[0];

    // 记录安全审计日志
    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'security_compliance.config_update',
        'security_compliance',
        ${row.id},
        ${JSON.stringify({
          aiCopilot: row.is_ai_copilot_enabled,
          aiProvider: row.ai_provider,
          aiModelName: row.ai_model_name,
          phoneMasking: row.is_phone_masking_enabled,
          emailMasking: row.is_email_masking_enabled,
          timeout: row.session_timeout_minutes,
        })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      isAiCopilotEnabled: row.is_ai_copilot_enabled ?? false,
      aiProvider: (row.ai_provider as SecurityComplianceConfigItem["aiProvider"]) || "BUILTIN",
      aiApiKeyMasked: maskApiKey(row.ai_api_key),
      aiApiEndpoint: row.ai_api_endpoint,
      aiModelName: row.ai_model_name || "deepseek-chat",
      aiTemperature: Number(row.ai_temperature) || 0.3,
      isPhoneMaskingEnabled: row.is_phone_masking_enabled,
      isEmailMaskingEnabled: row.is_email_masking_enabled,
      exportRequiresApproval: row.export_requires_approval,
      sessionTimeoutMinutes: row.session_timeout_minutes,
      watermarkEnabled: row.watermark_enabled,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * 非客户负责人的销售申请解敏该客户敏感信息的资格判定：
 * 口径必须与客户可见性规则对齐——协同开启 AND 本人持有该客户
 * 至少一条商机（任意阶段，含已结案），而不是"协同开启就全员可看"。
 * 否则协同开关一开，任何销售都能以解敏为通道探测全租户客户联系方式。
 */
async function canSalesUnmaskCustomer(
  tx: TenantTransaction,
  tenant: TenantContext,
  customerId: string,
): Promise<boolean> {
  const collab = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
    select allow_multi_sales_followup from public.customer_collaboration_settings
    where tenant_id = ${tenant.tenantId} limit 1
  `);
  const allowMulti = collab.rows[0]?.allow_multi_sales_followup ?? false;
  if (!allowMulti) return false;

  const ownOpp = await tx.execute<{ id: string }>(sql`
    select id from public.opportunities
    where tenant_id = ${tenant.tenantId}
      and customer_id = ${customerId}
      and owner_user_id = ${tenant.userId}
      and stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON')
      and deleted_at is null
    limit 1
  `);
  return ownOpp.rows.length > 0;
}

export async function logSensitiveDataUnmaskService(
  tenant: TenantContext,
  entityType: "LEAD" | "CONTACT" | "CUSTOMER",
  entityId: string,
  fieldName: "PHONE" | "EMAIL",
  reason?: string,
): Promise<{ success: boolean; unmaskedValue: string }> {
  // entityId 加 uuid 格式校验（非法直接 VALIDATION_ERROR）
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
    throw new BusinessError("VALIDATION_ERROR", "非法实体ID格式");
  }
  return withTenant(tenant.tenantId, async (tx) => {
    let rawValue = "";

    if (entityType === "LEAD") {
      const row = await tx.execute<{ contact_phone: string; contact_email: string; owner_user_id: string | null }>(sql`
        select contact_phone, contact_email, owner_user_id
        from public.leads
        where tenant_id = ${tenant.tenantId} and id = ${entityId} and deleted_at is null
      `);
      if (row.rows.length === 0) throw new Error("潜客档案不存在");
      const lead = row.rows[0];
      if (tenant.role === "SALES") {
        if (!lead.owner_user_id) {
          throw new Error("公海待认领线索禁止直接解密敏感信息，请先认领至私海");
        }
        if (lead.owner_user_id !== tenant.userId) {
          throw new Error("无权查看其他销售私海线索的敏感信息");
        }
      }
      rawValue = fieldName === "PHONE" ? lead.contact_phone : lead.contact_email;
    } else if (entityType === "CONTACT") {
      const row = await tx.execute<{ phone: string; email: string; customer_id: string }>(sql`
        select c.phone, c.email, c.customer_id
        from public.contacts c
        where c.tenant_id = ${tenant.tenantId} and c.id = ${entityId} and c.deleted_at is null
      `);
      if (row.rows.length === 0) throw new Error("联系人档案不存在");
      const contact = row.rows[0];
      if (tenant.role === "SALES") {
        const cust = await tx.execute<{ owner_user_id: string | null }>(sql`
          select owner_user_id from public.customers
          where tenant_id = ${tenant.tenantId} and id = ${contact.customer_id} and deleted_at is null
        `);
        const ownerId = cust.rows[0]?.owner_user_id;
        if (!ownerId) {
          if (!(await canSalesUnmaskCustomer(tx, tenant, contact.customer_id))) {
            throw new Error("公海客户联系人禁止直接解密敏感信息，请先认领客户");
          }
        } else if (ownerId !== tenant.userId) {
          if (!(await canSalesUnmaskCustomer(tx, tenant, contact.customer_id))) {
            throw new Error("无权查看其他销售私海客户联系人的敏感信息");
          }
        }
      }
      rawValue = fieldName === "PHONE" ? contact.phone : contact.email;
    } else if (entityType === "CUSTOMER") {
      const custRow = await tx.execute<{ owner_user_id: string | null }>(sql`
        select owner_user_id from public.customers
        where tenant_id = ${tenant.tenantId} and id = ${entityId} and deleted_at is null
      `);
      if (custRow.rows.length === 0) throw new Error("客户档案不存在");
      const cust = custRow.rows[0];
      if (tenant.role === "SALES") {
        if (!cust.owner_user_id) {
          if (!(await canSalesUnmaskCustomer(tx, tenant, entityId))) {
            throw new Error("公海客户禁止直接解密敏感信息，请先认领至私海");
          }
        } else if (cust.owner_user_id !== tenant.userId) {
          if (!(await canSalesUnmaskCustomer(tx, tenant, entityId))) {
            throw new Error("无权查看其他销售私海客户的敏感信息");
          }
        }
      }
      const row = await tx.execute<{ phone: string; email: string }>(sql`
        select phone, email
        from public.contacts
        where tenant_id = ${tenant.tenantId} and customer_id = ${entityId} and deleted_at is null
        order by is_primary desc, created_at asc
        limit 1
      `);
      if (row.rows.length === 0) throw new Error("客户联系人档案不存在");
      rawValue = fieldName === "PHONE" ? row.rows[0].phone : row.rows[0].email;
    }

    // 记录解密脱敏审计日志 (等保三级强制要求)
    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'security.unmask_view',
        ${entityType.toLowerCase()},
        ${entityId},
        ${JSON.stringify({
          fieldName,
          reason: reason || "销售一线合规查看客户联系方式",
          timestamp: new Date().toISOString(),
        })}::jsonb,
        now()
      )
    `);

    return {
      success: true,
      unmaskedValue: rawValue || "",
    };
  });
}
