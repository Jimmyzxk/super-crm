import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "@/core/tenant";
import type { TenantContext } from "@/core/tenant";
import { assertSafeHttpUrl } from "@/core/ai-gateway/client";
import { encryptSecret, decryptSecret, maskSecretKey } from "@/core/security/crypto";
import type {
  CreateWorkplaceIntegrationInput,
  UpdateWorkplaceIntegrationInput,
  WorkplaceEventType,
  WorkplaceIntegrationItem,
  WorkplacePlatform,
  WorkplacePushMessage,
  WorkplacePushResult,
} from "./types";

export async function listWorkplaceIntegrationsService(
  tenant: TenantContext,
): Promise<WorkplaceIntegrationItem[]> {
  if (tenant.role !== "ADMIN" && tenant.role !== "MANAGER") {
    throw new Error("权限不足：仅管理员或主管可查看企业通讯与出网 Webhook 配置");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      name: string;
      webhook_url: string;
      secret_key: string | null;
      events: WorkplaceEventType[];
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        id,
        platform,
        name,
        webhook_url,
        secret_key,
        events,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
      from public.workplace_integrations
      where tenant_id = ${tenant.tenantId}
      order by created_at desc
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      name: r.name,
      webhookUrl: r.webhook_url,
      secretKey: r.secret_key ? maskSecretKey(r.secret_key) : null,
      events: r.events,
      isEnabled: r.is_enabled,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function createWorkplaceIntegrationService(
  tenant: TenantContext,
  input: CreateWorkplaceIntegrationInput,
): Promise<WorkplaceIntegrationItem> {
  if (tenant.role !== "ADMIN" && tenant.role !== "MANAGER") {
    throw new Error("权限不足：仅管理员或主管可配置企业通讯与出网 Webhook");
  }

  if (!input.name.trim()) throw new Error("请输入机器人或 Webhook 集成名称");
  if (!input.webhookUrl.startsWith("http://") && !input.webhookUrl.startsWith("https://")) {
    throw new Error("Webhook 地址格式不正确，必须以 http:// 或 https:// 开头");
  }

  const encSecret = input.secretKey?.trim() ? encryptSecret(input.secretKey.trim()) : null;

  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      name: string;
      webhook_url: string;
      secret_key: string | null;
      events: WorkplaceEventType[];
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into public.workplace_integrations (
        tenant_id,
        platform,
        name,
        webhook_url,
        secret_key,
        events,
        is_enabled,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.platform},
        ${input.name.trim()},
        ${input.webhookUrl.trim()},
        ${encSecret},
        ${JSON.stringify(input.events)}::jsonb,
        ${input.isEnabled ?? true},
        now(),
        now()
      )
      returning
        id,
        platform,
        name,
        webhook_url,
        secret_key,
        events,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
      `);

    const row = res.rows[0];

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
        'workplace_integration.create',
        'workplace_integration',
        ${row.id},
        ${JSON.stringify({ name: row.name, platform: row.platform })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      platform: row.platform,
      name: row.name,
      webhookUrl: row.webhook_url,
      secretKey: row.secret_key ? maskSecretKey(row.secret_key) : null,
      events: row.events,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function updateWorkplaceIntegrationService(
  tenant: TenantContext,
  input: UpdateWorkplaceIntegrationInput,
): Promise<WorkplaceIntegrationItem> {
  if (tenant.role !== "ADMIN" && tenant.role !== "MANAGER") {
    throw new Error("权限不足：仅管理员或主管可更新企业通讯与出网 Webhook");
  }

  const encSecret = input.secretKey !== undefined ? (input.secretKey?.trim() ? encryptSecret(input.secretKey.trim()) : null) : undefined;

  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      name: string;
      webhook_url: string;
      secret_key: string | null;
      events: WorkplaceEventType[];
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      update public.workplace_integrations set
        platform = coalesce(${input.platform}, platform),
        name = coalesce(${input.name?.trim()}, name),
        webhook_url = coalesce(${input.webhookUrl?.trim()}, webhook_url),
        secret_key = case when ${input.secretKey !== undefined} then ${encSecret ?? null} else secret_key end,
        events = case when ${input.events !== undefined} then ${JSON.stringify(input.events || [])}::jsonb else events end,
        is_enabled = coalesce(${input.isEnabled}, is_enabled),
        updated_at = now()
      where tenant_id = ${tenant.tenantId} and id = ${input.id}::uuid
      returning
        id,
        platform,
        name,
        webhook_url,
        secret_key,
        events,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);

    const row = res.rows[0];
    if (!row) throw new Error("未找到指定的通讯机器人集成");

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
        'workplace_integration.update',
        'workplace_integration',
        ${row.id},
        ${JSON.stringify({ name: row.name, platform: row.platform, isEnabled: row.is_enabled })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      platform: row.platform,
      name: row.name,
      webhookUrl: row.webhook_url,
      secretKey: row.secret_key,
      events: row.events,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function deleteWorkplaceIntegrationService(
  tenant: TenantContext,
  id: string,
): Promise<void> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅超级管理员可删除企业通讯集成");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    await tx.execute(sql`
      delete from public.workplace_integrations
      where tenant_id = ${tenant.tenantId} and id = ${id}::uuid
    `);

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
        'workplace_integration.delete',
        'workplace_integration',
        ${id}::uuid,
        ${JSON.stringify({ id })}::jsonb,
        now()
      )
    `);
  });
}

export function formatWorkplacePayload(
  platform: WorkplacePlatform,
  message: WorkplacePushMessage,
): Record<string, unknown> {
  if (platform === "GENERIC_WEBHOOK") {
    return {
      eventId: `evt_${crypto.randomUUID()}`,
      event: message.event,
      timestamp: Date.now(),
      title: message.title,
      markdownContent: message.markdownContent,
      data: message.data || {},
    };
  }

  if (platform === "WECOM") {
    return {
      msgtype: "markdown",
      markdown: {
        content: `### ${message.title}\n\n${message.markdownContent}`,
      },
    };
  }

  if (platform === "DINGTALK") {
    return {
      msgtype: "markdown",
      markdown: {
        title: message.title,
        text: `### ${message.title}\n\n${message.markdownContent}`,
      },
    };
  }

  // FEISHU
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: {
          tag: "plain_text",
          content: message.title,
        },
      },
      elements: [
        {
          tag: "markdown",
          content: message.markdownContent,
        },
      ],
    },
  };
}

export async function dispatchWorkplaceNotificationService(
  tenant: TenantContext,
  message: WorkplacePushMessage,
): Promise<WorkplacePushResult[]> {
  const rawIntegrations = await withTenant(tenant.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      webhook_url: string;
      secret_key: string | null;
      events: WorkplaceEventType[];
      is_enabled: boolean;
    }>(sql`
      select id, platform, webhook_url, secret_key, events, is_enabled
      from public.workplace_integrations
      where tenant_id = ${tenant.tenantId} and is_enabled = true
    `);
    return rows.rows;
  });

  const matched = rawIntegrations.filter(
    (i) => i.is_enabled && i.events.includes(message.event),
  );

  const results: WorkplacePushResult[] = [];

  for (const integration of matched) {
    try {
      assertSafeHttpUrl(integration.webhook_url);
      const payload = formatWorkplacePayload(integration.platform, message);
      const bodyString = JSON.stringify(payload);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const plainSecret = decryptSecret(integration.secret_key);
      if (integration.platform === "GENERIC_WEBHOOK" && plainSecret) {
        const timestamp = Date.now().toString();
        const signature = crypto
          .createHmac("sha256", plainSecret)
          .update(`${timestamp}.${bodyString}`)
          .digest("hex");

        headers["X-CRM-Signature"] = `sha256=${signature}`;
        headers["X-Hub-Signature-256"] = `sha256=${signature}`;
        headers["X-CRM-Timestamp"] = timestamp;
        headers["X-CRM-Tenant-Id"] = tenant.tenantId;
        if (typeof (payload as Record<string, unknown>).eventId === "string") {
          headers["X-CRM-Event-Id"] = (payload as Record<string, unknown>).eventId as string;
        }
      }

      const res = await fetch(integration.webhook_url, {
        method: "POST",
        redirect: "error",
        headers,
        body: bodyString,
        signal: AbortSignal.timeout(5000),
      });

      results.push({
        integrationId: integration.id,
        platform: integration.platform,
        success: res.ok,
        statusCode: res.status,
      });
    } catch (err) {
      results.push({
        integrationId: integration.id,
        platform: integration.platform,
        success: false,
        error: err instanceof Error ? err.message : "推送异常",
      });
    }
  }

  return results;
}

export async function testWorkplaceIntegrationService(
  tenant: TenantContext,
  integrationId: string,
): Promise<{ success: boolean; message: string }> {
  const rawRes = await withTenant(tenant.tenantId, async (tx) => {
    return await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      webhook_url: string;
      secret_key: string | null;
    }>(sql`
      select id, platform, webhook_url, secret_key
      from public.workplace_integrations
      where tenant_id = ${tenant.tenantId} and id = ${integrationId}::uuid
    `);
  });
  const target = rawRes.rows[0];
  if (!target) throw new Error("未找到指定的通讯机器人集成");

  const testMsg: WorkplacePushMessage = {
    title: "商脉AI CRM · 连通性测试",
    markdownContent: `> **测试状态**：连接成功\n> **租户 ID**：\`${tenant.tenantId}\`\n> **触发时间**：${new Date().toLocaleString("zh-CN")}\n\n本群已成功接入商脉AI CRM 实时战报与出网 Webhook 引擎，后续将自动推送核心商业事件与 AI 巡检战报。`,
    event: "DEAL_WON",
    data: { test: true, triggeredAt: new Date().toISOString() },
  };

  try {
    assertSafeHttpUrl(target.webhook_url);
    const payload = formatWorkplacePayload(target.platform, testMsg);
    const bodyString = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const plainSecret = decryptSecret(target.secret_key);
    if (target.platform === "GENERIC_WEBHOOK" && plainSecret) {
      const timestamp = Date.now().toString();
      const signature = crypto
        .createHmac("sha256", plainSecret)
        .update(`${timestamp}.${bodyString}`)
        .digest("hex");
      headers["X-CRM-Signature"] = `sha256=${signature}`;
      headers["X-Hub-Signature-256"] = `sha256=${signature}`;
      headers["X-CRM-Timestamp"] = timestamp;
      headers["X-CRM-Tenant-Id"] = tenant.tenantId;
    }

    const res = await fetch(target.webhook_url, {
      method: "POST",
      redirect: "error",
      headers,
      body: bodyString,
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      return { success: true, message: "测试消息发送成功！目标端已正常接收" };
    }
    return { success: false, message: `Webhook 响应异常状态码：${res.status}` };
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : "网络连接失败" };
  }
}
