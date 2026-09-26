import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { db } from "@/db/client";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { refreshInsightsSafely } from "@/core/insight/service";
import { scoreLeadSafely, scoreLeadInTransaction } from "@/core/scoring/service";
import { createLeadAssignedNotification } from "@/core/notification/service";
import { maskPhone, maskEmail } from "@/core/security/masking";
import type { CsvPreviewRow } from "./csv";
import { leadFieldsSchema, type ApiLeadInput, type LeadCollisionInfo, type LeadInput, type LeadRow, type LeadUpdateInput } from "./types";

type Duplicate = { leadId: string; contactName: string; companyName: string | null; ownerName: string | null };
type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "DISCARDED";
export const LEAD_COUNT_CEILING = 1000;

const discardReasonLabels: Record<string, string> = {
  NO_NEED: "没有需求",
  NO_BUDGET: "没有预算",
  WRONG_CONTACT: "联系人不对",
  INVALID_INFO: "信息无效",
  COMPETITOR: "选了竞品",
  OTHER: "其他",
};

function canManage(ctx: TenantContext, ownerId: string | null): boolean {
  return ctx.role !== "SALES" || ownerId === ctx.userId;
}

async function audit(tx: TenantTransaction, ctx: TenantContext, action: string, subjectId: string, detail: object = {}) {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, 'lead', ${subjectId}, ${JSON.stringify(detail)}::jsonb)`);
}

export async function recordLeadStatus(
  tx: TenantTransaction,
  ctx: TenantContext,
  leadId: string,
  fromStatus: LeadStatus | null,
  toStatus: LeadStatus,
  reason?: string,
) {
  const actualFrom = fromStatus === toStatus ? null : fromStatus;
  await tx.execute(sql`insert into lead_status_history
    (tenant_id, lead_id, from_status, to_status, reason, actor_user_id)
    values (${ctx.tenantId}, ${leadId}, ${actualFrom}::lead_status, ${toStatus}::lead_status,
      ${reason ?? null}, ${ctx.userId})`);
}

export async function detectLeadCollision(
  tx: TenantTransaction,
  ctx: TenantContext,
  phone: string,
): Promise<LeadCollisionInfo> {
  // 1. 检查手机号是否已属于正式客户库中的联系人
  const contactResult = await tx.execute<{
    contactId: string;
    contactName: string;
    customerId: string;
    customerName: string;
    customerOwnerId: string;
    customerOwnerName: string;
  }>(sql`
    select ct.id as "contactId", ct.name as "contactName", c.id as "customerId", c.name as "customerName",
      c.owner_user_id as "customerOwnerId", u.name as "customerOwnerName"
    from contacts ct
    join customers c on c.tenant_id = ct.tenant_id and c.id = ct.customer_id
    left join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
    where ct.tenant_id = ${ctx.tenantId} and ct.phone = ${phone} and ct.deleted_at is null and c.deleted_at is null
    limit 1
  `);

  if (contactResult.rows[0]) {
    const row = contactResult.rows[0];
    const isSelf = row.customerOwnerId === ctx.userId;
    return {
      collisionType: "EXISTING_CUSTOMER_CONTACT",
      message: isSelf
        ? `该联系人已在您负责的正式客户「${row.customerName}」名下。`
        : `该联系人已归属于正式客户「${row.customerName}」（负责人：${row.customerOwnerName || "已分配"}）。`,
      customerId: row.customerId,
      customerName: row.customerName,
      contactName: row.contactName,
      ownerUserId: row.customerOwnerId,
      ownerName: row.customerOwnerName,
      isSelfOwner: isSelf,
    };
  }

  // 2. 检查线索库中的记录
  const leadResult = await tx.execute<{
    id: string;
    contactName: string;
    companyName: string | null;
    status: LeadStatus;
    ownerUserId: string | null;
    ownerName: string | null;
  }>(sql`
    select l.id, l.contact_name as "contactName", l.company_name as "companyName",
      l.status, l.owner_user_id as "ownerUserId", u.name as "ownerName"
    from leads l
    left join users u on u.tenant_id = l.tenant_id and u.id = l.owner_user_id
    where l.tenant_id = ${ctx.tenantId} and l.contact_phone = ${phone} and l.deleted_at is null
    order by case when l.status <> 'DISCARDED' then 1 else 2 end, l.created_at desc
    limit 1
  `);

  if (leadResult.rows[0]) {
    const lead = leadResult.rows[0];

    // Case 2a: 公海中历史放弃的流失线索
    if (lead.status === "DISCARDED") {
      return {
        collisionType: "DISCARDED_LEAD",
        message: "该联系人曾于历史跟进中标记放弃，可重新激活并认领至您的私海。",
        leadId: lead.id,
        contactName: lead.contactName,
        customerName: lead.companyName || undefined,
        ownerUserId: null,
        ownerName: null,
        canReactivate: true,
      };
    }

    // Case 2b: 公海池中待分配线索
    if (!lead.ownerUserId) {
      return {
        collisionType: "PUBLIC_POOL_LEAD",
        message: "该线索已在公海池中待认领。",
        leadId: lead.id,
        contactName: lead.contactName,
        customerName: lead.companyName || undefined,
        ownerUserId: null,
        ownerName: null,
        canClaim: true,
      };
    }

    // Case 2c: 自己名下已有线索
    if (lead.ownerUserId === ctx.userId) {
      return {
        collisionType: "SELF_LEAD",
        message: `您名下已有该线索「${lead.contactName}」，无需重复创建。`,
        leadId: lead.id,
        contactName: lead.contactName,
        customerName: lead.companyName || undefined,
        ownerUserId: lead.ownerUserId,
        ownerName: lead.ownerName,
        isSelfOwner: true,
      };
    }

    // Case 2d: 其他销售私海中的活跃线索
    return {
      collisionType: "ACTIVE_PRIVATE_LEAD",
      message: `该线索已由销售「${lead.ownerName || "其他专员"}」跟进中，无法重复录入私海。`,
      leadId: lead.id,
      contactName: lead.contactName,
      customerName: lead.companyName || undefined,
      ownerUserId: lead.ownerUserId,
      ownerName: lead.ownerName,
      isSelfOwner: false,
    };
  }

  return {
    collisionType: "NONE",
    message: "无冲突",
  };
}

async function findDuplicate(tx: TenantTransaction, phone: string): Promise<Duplicate | null> {
  const result = await tx.execute<Duplicate>(sql`select l.id as "leadId", l.contact_name as "contactName",
    l.company_name as "companyName", u.name as "ownerName" from leads l left join users u on u.id = l.owner_user_id
    where l.contact_phone = ${phone} and l.status <> 'DISCARDED' and l.deleted_at is null order by l.created_at limit 1`);
  return result.rows[0] ?? null;
}

type LeadInsertOptions = {
  source: string;
  ownerUserId: string | null;
  createTask: boolean;
  statusReason: string;
  auditAction: string;
  auditDetail?: object;
};

/**
 * 校验意向产品归属本租户。外键只约束"产品存在"，不约束租户——
 * 不校验的话 A 租户的线索可以引用 B 租户的产品（含价格等敏感配置），
 * 列表 join 时还会静默显示为空（join 带 tenant_id 条件）。
 */
async function assertIntendedProductInTenant(
  tx: TenantTransaction,
  ctx: TenantContext,
  intendedProductId: string | null | undefined,
): Promise<void> {
  if (!intendedProductId) return;
  const found = await tx.execute<{ id: string }>(sql`
    select id from products
    where tenant_id = ${ctx.tenantId} and id = ${intendedProductId} and deleted_at is null
    limit 1
  `);
  if (found.rows.length === 0) {
    throw new BusinessError("VALIDATION_ERROR", "意向产品不存在或不属于当前企业", "intendedProductId");
  }
}

async function insertLead(
  tx: TenantTransaction,
  ctx: TenantContext,
  input: LeadInput,
  isPossibleDuplicate: boolean,
  options: LeadInsertOptions,
): Promise<string> {
  await assertIntendedProductInTenant(tx, ctx, input.intendedProductId);
  const result = await tx.execute<{ id: string }>(sql`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone, contact_email, company_name, title, intended_product_id, intended_product, budget, channel, utm_source, utm_medium, utm_campaign, note, source, is_possible_duplicate)
    values (${ctx.tenantId}, ${options.ownerUserId}, ${input.contactName}, ${input.contactPhone}, ${input.contactEmail ?? null},
      ${input.companyName ?? null}, ${input.title ?? null}, ${input.intendedProductId ?? null}, ${input.intendedProduct ?? null}, ${input.budget ?? null},
      ${input.channel ?? null}, ${input.utmSource ?? null}, ${input.utmMedium ?? null}, ${input.utmCampaign ?? null},
      ${input.note ?? null}, ${options.source}, ${isPossibleDuplicate}) returning id`);
  const leadId = result.rows[0].id;
  if (options.createTask) {
    await tx.execute(sql`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
      values (${ctx.tenantId}, ${leadId}, ${ctx.userId}, 'FIRST_RESPONSE', now() + interval '24 hours')`);
  }
  await recordLeadStatus(tx, ctx, leadId, null, "NEW", options.statusReason);
  await audit(tx, ctx, options.auditAction, leadId, options.auditDetail);
  return leadId;
}

async function scoreAndRefreshLeadAfterCommit(ctx: TenantContext, leadId: string, score: boolean) {
  if (score) await scoreLeadSafely(ctx, leadId);
  await refreshInsightsSafely(ctx, { type: "lead", id: leadId });
}

export type PluginLeadSource = `form:${string}` | `plugin:${string}`;

function parsePluginLeadInput(input: unknown): LeadInput {
  const parsed = leadFieldsSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  throw new BusinessError("VALIDATION_ERROR", issue.message, issue.path.join(".") || undefined);
}

function isPluginLeadSource(source: string): source is PluginLeadSource {
  return /^form:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(source)
    || /^plugin:[a-z][a-z0-9-]{1,49}$/.test(source);
}

/**
 * Plugin-only core capability. The caller already owns the tenant transaction;
 * do not wrap this in withTenant or the public submission would lose atomicity.
 */
export async function createUnassignedPluginLeadInTransaction(
  tx: TenantTransaction,
  ctx: TenantContext,
  input: unknown,
  source: string,
  auditDetail: object = {},
): Promise<{ leadId: string | null; duplicateSuspected: boolean; collisionType?: string }> {
  if (!isPluginLeadSource(source)) {
    throw new BusinessError("VALIDATION_ERROR", "插件来源格式不正确", "source");
  }
  const fields = parsePluginLeadInput(input);
  const collision = await detectLeadCollision(tx, ctx, fields.contactPhone);

  // 与手工录入口径对齐：撞他人私海活跃线索、命中正式客户联系人时，
  // 无人工确认环节的进线渠道一律不再制造重复线索（返回未创建）
  if (collision.collisionType === "ACTIVE_PRIVATE_LEAD" || collision.collisionType === "EXISTING_CUSTOMER_CONTACT") {
    return { leadId: null, duplicateSuspected: true, collisionType: collision.collisionType };
  }

  const isDuplicate = collision.collisionType !== "NONE";
  const leadId = await insertLead(tx, ctx, fields, isDuplicate, {
    source,
    ownerUserId: null,
    createTask: false,
    statusReason: "插件表单进线",
    auditAction: "lead.create.plugin",
    auditDetail: { ...auditDetail, collisionType: collision.collisionType },
  });
  await scoreLeadInTransaction(tx, ctx, leadId);
  return { leadId, duplicateSuspected: isDuplicate };
}

export async function createLeadService(
  ctx: TenantContext,
  input: LeadInput & {
    confirmDuplicate?: boolean;
    reactivateLeadId?: string;
    claimPublicLeadId?: string;
  },
) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    // 公海认领/重新激活路径直接 update（不经 insertLead），需单独校验产品归属
    await assertIntendedProductInTenant(tx, ctx, input.intendedProductId);
    // 1. 若销售选择重新激活历史放弃流失的线索
    if (input.reactivateLeadId) {
      const found = await tx.execute<{ id: string; status: LeadStatus }>(sql`
        select id, status from leads
        where tenant_id = ${ctx.tenantId} and id = ${input.reactivateLeadId} and deleted_at is null
        for update
      `);
      const lead = found.rows[0];
      if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
      if (lead.status !== "DISCARDED") {
        throw new BusinessError("CONFLICT", "该线索不处于已放弃状态，无法重新激活");
      }
      await tx.execute(sql`
        update leads set
          status = 'NEW',
          owner_user_id = ${ctx.userId},
          claimed_at = now(),
          contact_name = ${input.contactName},
          contact_email = ${input.contactEmail ?? null},
          company_name = ${input.companyName ?? null},
          title = ${input.title ?? null},
          intended_product_id = ${input.intendedProductId ?? null},
          intended_product = ${input.intendedProduct ?? null},
          budget = ${input.budget ?? null},
          note = ${input.note ?? null},
          discard_reason = null,
          discard_note = null,
          is_possible_duplicate = false,
          updated_at = now()
        where id = ${lead.id}
      `);
      await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where tenant_id = ${ctx.tenantId} and lead_id = ${lead.id} and status = 'OPEN'`);
      await tx.execute(sql`
        insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
        values (${ctx.tenantId}, ${lead.id}, ${ctx.userId}, 'FIRST_RESPONSE', now() + interval '24 hours')
      `);
      await recordLeadStatus(tx, ctx, lead.id, "DISCARDED", "NEW", "重新激活认领入私海");
      await audit(tx, ctx, "lead.reactivate", lead.id, { note: "重新激活认领入私海" });
      return { created: true as const, leadId: lead.id, reactivated: true };
    }

    // 2. 若销售选择认领公海待分配线索
    if (input.claimPublicLeadId) {
      const found = await tx.execute<{ id: string; owner_user_id: string | null; status: LeadStatus }>(sql`
        select id, owner_user_id, status from leads
        where tenant_id = ${ctx.tenantId} and id = ${input.claimPublicLeadId} and deleted_at is null
        for update
      `);
      const lead = found.rows[0];
      if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
      if (lead.status === "CONVERTED") {
        throw new BusinessError("CONFLICT", "该线索已转化为客户，无法重复认领");
      }
      if (lead.owner_user_id !== null && lead.status !== "DISCARDED") {
        throw new BusinessError("CONFLICT", "该线索已有归属人，无法通过公海认领");
      }
      const isReactivating = lead.status === "DISCARDED";
      const updateRes = await tx.execute(sql`
        update leads set
          owner_user_id = ${ctx.userId},
          claimed_at = now(),
          status = 'NEW',
          discard_reason = null,
          discard_note = null,
          contact_name = ${input.contactName},
          contact_email = ${input.contactEmail ?? null},
          company_name = ${input.companyName ?? null},
          title = ${input.title ?? null},
          intended_product_id = ${input.intendedProductId ?? null},
          intended_product = ${input.intendedProduct ?? null},
          budget = ${input.budget ?? null},
          note = ${input.note ?? null},
          updated_at = now()
        where id = ${lead.id}
          and tenant_id = ${ctx.tenantId}
          and (owner_user_id is null or status = 'DISCARDED')
          and status <> 'CONVERTED'
          and deleted_at is null
      `);
      if (updateRes.rowCount === 0) {
        throw new BusinessError("CONFLICT", "线索已被他人认领或非公海待分配线索");
      }
      await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where tenant_id = ${ctx.tenantId} and lead_id = ${lead.id} and status = 'OPEN'`);
      await tx.execute(sql`
        insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
        values (${ctx.tenantId}, ${lead.id}, ${ctx.userId}, 'FIRST_RESPONSE', now() + interval '24 hours')
      `);
      if (isReactivating) {
        await recordLeadStatus(tx, ctx, lead.id, "DISCARDED", "NEW", "重新激活认领入私海");
        await audit(tx, ctx, "lead.reactivate", lead.id, { note: "重新激活认领入私海" });
      } else {
        await recordLeadStatus(tx, ctx, lead.id, lead.status, "NEW", "公海认领分配入私海");
        await audit(tx, ctx, "lead.claim", lead.id, { note: "录入时认领公海线索" });
      }
      return { created: true as const, leadId: lead.id, claimed: true, reactivated: isReactivating };
    }

    // 3. 冲突与风险判定
    const collision = await detectLeadCollision(tx, ctx, input.contactPhone);

    // 规则 A: 他人私海活跃线索 -> 强阻断撞单
    if (collision.collisionType === "ACTIVE_PRIVATE_LEAD") {
      if (ctx.role === "SALES" && !input.confirmDuplicate) {
        throw new BusinessError("CONFLICT", collision.message, "contactPhone");
      }
    }

    // 规则 B: 录入自己已有名下线索 -> 提示重复
    if (collision.collisionType === "SELF_LEAD") {
      if (!input.confirmDuplicate) {
        return {
          created: false as const,
          collision,
          duplicateOf: {
            leadId: collision.leadId!,
            contactName: collision.contactName!,
            companyName: collision.customerName ?? null,
            ownerName: collision.ownerName ?? null,
          },
        };
      }
    }

    // 规则 C: 命中已转正式客户联系人 -> 阻断撞客
    if (collision.collisionType === "EXISTING_CUSTOMER_CONTACT") {
      if (ctx.role === "SALES" && !collision.isSelfOwner && !input.confirmDuplicate) {
        throw new BusinessError("CONFLICT", collision.message, "contactPhone");
      }
    }

    // 规则 D: 命中历史流失已放弃线索 -> 提示可重新激活
    if (collision.collisionType === "DISCARDED_LEAD" && !input.confirmDuplicate) {
      return {
        created: false as const,
        collision,
        duplicateOf: {
          leadId: collision.leadId!,
          contactName: collision.contactName!,
          companyName: collision.customerName ?? null,
          ownerName: null,
        },
      };
    }

    // 规则 E: 命中公海待分配线索 -> 提示可直接认领
    if (collision.collisionType === "PUBLIC_POOL_LEAD" && !input.confirmDuplicate) {
      return {
        created: false as const,
        collision,
        duplicateOf: {
          leadId: collision.leadId!,
          contactName: collision.contactName!,
          companyName: collision.customerName ?? null,
          ownerName: null,
        },
      };
    }

    // 规则 F: 兼容历史重复线索提示
    const duplicate = await findDuplicate(tx, input.contactPhone);
    if (duplicate && !input.confirmDuplicate) {
      return { created: false as const, duplicateOf: duplicate, collision };
    }

    return {
      created: true as const,
      leadId: await insertLead(tx, ctx, input, Boolean(duplicate || collision.collisionType !== "NONE"), {
        source: "manual",
        ownerUserId: ctx.userId,
        createTask: true,
        statusReason: "手工创建线索",
        auditAction: "lead.create",
      }),
    };
  });
  if (result.created) await scoreAndRefreshLeadAfterCommit(ctx, result.leadId, true);
  return result;
}

export type LeadSourceToken = {
  sourceKeyId: string;
  tenantId: string;
  sourceKey: string;
  createdByUserId: string;
  revokedAt: string | null;
  tenantStatus: "ACTIVE" | "SUSPENDED";
  actorRole: TenantContext["role"];
};

export type ApiLeadRequestContext = {
  clientIp?: string | null;
  requestIp?: string | null;
};

export function normalizeApiClientIp(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/^::ffff:/, "") ?? "";
}

export function getRequestClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim() || request.headers.get("cf-connecting-ip")?.trim();
  if (realIp) return normalizeApiClientIp(realIp);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean);
  return normalizeApiClientIp(forwarded?.at(-1));
}

function ipv4Number(value: string): number | null {
  if (isIP(value) !== 4) return null;
  const parts = value.split(".").map(Number);
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function matchesApiIpEntry(clientIp: string, entry: string): boolean {
  const normalizedEntry = normalizeApiClientIp(entry);
  if (normalizedEntry === clientIp) return true;
  const separator = normalizedEntry.indexOf("/");
  if (separator < 0) return false;
  const network = normalizedEntry.slice(0, separator);
  const prefixText = normalizedEntry.slice(separator + 1);
  const prefix = Number(prefixText);
  if (!/^\d+$/.test(prefixText) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const clientNumber = ipv4Number(clientIp);
  const networkNumber = ipv4Number(network);
  if (clientNumber === null || networkNumber === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (clientNumber & mask) === (networkNumber & mask);
}

export function isApiClientIpAllowed(value: string | null | undefined, allowedIpRanges: string | null): boolean {
  const allowed = allowedIpRanges?.trim();
  if (!allowed) return true;
  const clientIp = normalizeApiClientIp(value);
  if (!clientIp) return false;
  return allowed
    .split(/[\s,;]+/)
    .filter(Boolean)
    .some((entry) => entry === "*" || matchesApiIpEntry(clientIp, entry));
}

export type LeadSourceKeyRow = {
  id: string;
  name: string;
  sourceKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function hashLeadSourceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function hasConstraint(error: unknown, constraint: string): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as { code?: string; constraint?: string; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

async function recordLeadSourceKeyAudit(
  tx: TenantTransaction,
  ctx: TenantContext,
  action: string,
  sourceKeyId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.execute(sql`
    insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, 'lead_source_key', ${sourceKeyId}, ${JSON.stringify(detail)}::jsonb)
  `);
}

export async function lookupLeadSourceToken(token: string): Promise<LeadSourceToken | null> {
  const tokenHash = hashLeadSourceToken(token);
  const result = await db.execute<LeadSourceToken>(sql`
    select source_key_id as "sourceKeyId", tenant_id as "tenantId", source_key as "sourceKey",
      created_by_user_id as "createdByUserId", revoked_at::text as "revokedAt", tenant_status as "tenantStatus",
      actor_role as "actorRole"
    from public.lookup_lead_source_token(${tokenHash})
  `);
  return result.rows[0] ?? null;
}

function canonicalApiLead(input: ApiLeadInput): string {
  return JSON.stringify({
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail ?? null,
    companyName: input.companyName ?? null,
    title: input.title ?? null,
    intendedProductId: input.intendedProductId ?? null,
    intendedProduct: input.intendedProduct ?? null,
    budget: input.budget ?? null,
    channel: input.channel ?? null,
    utmSource: input.utmSource ?? input.utm_source ?? null,
    utmMedium: input.utmMedium ?? input.utm_medium ?? null,
    utmCampaign: input.utmCampaign ?? input.utm_campaign ?? null,
    note: input.note ?? null,
    externalId: input.externalId ?? null,
    sourceLabel: input.sourceLabel ?? null,
  });
}

export async function createLeadSourceKeyService(
  ctx: TenantContext,
  input: { name: string; sourceKey: string },
) {
  if (ctx.role !== "ADMIN") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  const token = `sk_live_${randomBytes(24).toString("base64url")}`;
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const inserted = await tx.execute<{ id: string; createdAt: string }>(sql`
        insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id)
        values (${ctx.tenantId}, ${input.name}, ${input.sourceKey}, ${hashLeadSourceToken(token)}, ${ctx.userId})
        returning id, created_at::text as "createdAt"
      `);
      const sourceKeyId = inserted.rows[0].id;
      await recordLeadSourceKeyAudit(tx, ctx, "api_key.create", sourceKeyId, {
        name: input.name,
        sourceKey: input.sourceKey,
      });
      return { sourceKeyId, name: input.name, sourceKey: input.sourceKey, token, createdAt: inserted.rows[0].createdAt };
    });
  } catch (error) {
    if (hasConstraint(error, "lead_source_keys_tenant_source_unique")) {
      throw new BusinessError("CONFLICT", "来源标识已存在", "sourceKey");
    }
    throw error;
  }
}

export async function listLeadSourceKeysService(ctx: TenantContext): Promise<LeadSourceKeyRow[]> {
  if (ctx.role !== "ADMIN") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<LeadSourceKeyRow>(sql`
      select id, name, source_key as "sourceKey", created_at::text as "createdAt",
        last_used_at::text as "lastUsedAt", revoked_at::text as "revokedAt"
      from lead_source_keys
      order by created_at desc, id desc
    `);
    return result.rows;
  });
}

export async function revokeLeadSourceKeyService(ctx: TenantContext, sourceKeyId: string) {
  if (ctx.role !== "ADMIN") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{ id: string; name: string; revokedAt: string }>(sql`
      update lead_source_keys set revoked_at = coalesce(revoked_at, now())
      where tenant_id = ${ctx.tenantId} and id = ${sourceKeyId}
      returning id, name, revoked_at::text as "revokedAt"
    `);
    if (!res.rows[0]) throw new BusinessError("NOT_FOUND", "来源密钥不存在");
    await recordLeadSourceKeyAudit(tx, ctx, "api_key.revoke", res.rows[0].id, {
      name: res.rows[0].name,
    });
    return { sourceKeyId, revokedAt: res.rows[0].revokedAt };
  });
  try {
    const { invalidateLeadSourceKeyCache } = await import("@/plugin-kit/server");
    invalidateLeadSourceKeyCache(ctx.tenantId, sourceKeyId);
  } catch {}
  return result;
}

export async function createApiLeadService(
  source: LeadSourceToken,
  idempotencyKey: string,
  input: ApiLeadInput,
  requestContext: ApiLeadRequestContext = {},
) {
  const fingerprint = hashLeadSourceToken(canonicalApiLead(input));

  const result = await withTenant(source.tenantId, async (tx) => {
    const key = await tx.execute<{
      sourceKey: string;
      createdByUserId: string;
      revokedAt: string | null;
      scopes: string[] | null;
      rateLimitPerMinute: number;
      allowedIpRanges: string | null;
      tenantStatus: "ACTIVE" | "SUSPENDED";
      actorRole: TenantContext["role"];
    }>(sql`
      select k.source_key as "sourceKey", k.created_by_user_id as "createdByUserId",
        k.revoked_at::text as "revokedAt", k.scopes as scopes,
        k.rate_limit_per_minute as "rateLimitPerMinute", k.allowed_ip_ranges as "allowedIpRanges",
        t.status as "tenantStatus", u.role as "actorRole"
      from lead_source_keys k
      join tenants t on t.id = k.tenant_id
      join users u on u.tenant_id = k.tenant_id and u.id = k.created_by_user_id
      where k.id = ${source.sourceKeyId} for update of k
    `);
    const sourceKey = key.rows[0];
    if (!sourceKey || sourceKey.revokedAt || sourceKey.tenantStatus !== "ACTIVE"
      || sourceKey.createdByUserId !== source.createdByUserId) {
      throw new BusinessError("UNAUTHENTICATED", "来源密钥无效或已撤销");
    }

    const grantedScopes: string[] = Array.isArray(sourceKey.scopes) ? sourceKey.scopes : ["leads:write"];
    if (!grantedScopes.includes("*") && !grantedScopes.includes("leads:write")) {
      throw new BusinessError("FORBIDDEN", `API Key 缺少线索写入权限 (leads:write)，当前拥有 [${grantedScopes.join(", ")}]`);
    }

    const clientIp = requestContext.clientIp ?? requestContext.requestIp;
    if (!isApiClientIpAllowed(clientIp, sourceKey.allowedIpRanges)) {
      throw new BusinessError("FORBIDDEN", `客户端 IP [${normalizeApiClientIp(clientIp) || "unknown"}] 不在 API Key 允许的白名单列表中`);
    }

    const ctx: TenantContext = {
      tenantId: source.tenantId,
      userId: source.createdByUserId,
      role: sourceKey.actorRole,
    };

    const rate = await tx.execute<{ rateLimitCount: number }>(sql`
      update lead_source_keys
      set rate_window_started_at = case
            when rate_window_started_at is null
              or rate_window_started_at <= now() - interval '1 minute' then now()
            else rate_window_started_at
          end,
          rate_window_count = case
            when rate_window_started_at is null
              or rate_window_started_at <= now() - interval '1 minute' then 1
            else rate_window_count + 1
          end,
          last_used_at = now()
      where id = ${source.sourceKeyId}
      returning rate_window_count as "rateLimitCount"
    `);
    if (!rate.rows[0]) throw new BusinessError("UNAUTHENTICATED", "来源密钥无效或已撤销");
    if (rate.rows[0].rateLimitCount > (sourceKey.rateLimitPerMinute ?? 60)) {
      throw new BusinessError("RATE_LIMITED", "请求过于频繁，请稍后再试");
    }

    const existing = await tx.execute<{
      leadId: string;
      requestFingerprint: string;
      duplicateSuspected: boolean;
    }>(sql`
      select r.lead_id as "leadId", r.request_fingerprint as "requestFingerprint",
        l.is_possible_duplicate as "duplicateSuspected"
      from lead_intake_requests r join leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
      where r.source_key_id = ${source.sourceKeyId} and r.idempotency_key = ${idempotencyKey}
    `);
    const previous = existing.rows[0];
    if (previous) {
      if (previous.requestFingerprint !== fingerprint) {
        throw new BusinessError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一份数据");
      }
      return { replay: true as const, leadId: previous.leadId, duplicateSuspected: previous.duplicateSuspected };
    }

    const collision = await detectLeadCollision(tx, ctx, input.contactPhone);

    // 与手工录入口径对齐：撞他人私海活跃线索/正式客户联系人时不再创建重复线索。
    // 幂等表不落记录（无对应线索），同键重试会重新判定并得到一致的拦截结果
    if (collision.collisionType === "ACTIVE_PRIVATE_LEAD" || collision.collisionType === "EXISTING_CUSTOMER_CONTACT") {
      return { replay: false as const, leadId: null, duplicateSuspected: true };
    }

    const isDuplicate = collision.collisionType !== "NONE";
    const resolvedInput: LeadInput = {
      ...input,
      utmSource: input.utmSource ?? input.utm_source,
      utmMedium: input.utmMedium ?? input.utm_medium,
      utmCampaign: input.utmCampaign ?? input.utm_campaign,
    };
    const leadId = await insertLead(tx, ctx, resolvedInput, isDuplicate, {
      source: `api:${sourceKey.sourceKey}`,
      ownerUserId: null,
      createTask: false,
      statusReason: "外部 API 进线",
      auditAction: "lead.create.api",
      auditDetail: { sourceKey: sourceKey.sourceKey, externalId: input.externalId ?? null, collisionType: collision.collisionType },
    });
    await tx.execute(sql`
      update leads set external_id = ${input.externalId ?? null}, source_label = ${input.sourceLabel ?? null},
        received_at = now() where id = ${leadId}
    `);
    await tx.execute(sql`
      insert into lead_intake_requests
        (tenant_id, source_key_id, idempotency_key, external_id, lead_id, request_fingerprint)
      values (${source.tenantId}, ${source.sourceKeyId}, ${idempotencyKey}, ${input.externalId ?? null}, ${leadId}, ${fingerprint})
    `);
    await scoreLeadInTransaction(tx, { tenantId: source.tenantId, userId: source.createdByUserId, role: source.actorRole }, leadId);
    return { replay: false as const, leadId, duplicateSuspected: isDuplicate };
  });
  if (!result.replay && result.leadId) {
    // 评分已在事务内完成，提交后只需刷新洞察（被撞单拦截时无线索可刷新）
    await scoreAndRefreshLeadAfterCommit({ tenantId: source.tenantId, userId: source.createdByUserId, role: source.actorRole }, result.leadId, false);
  }
  return result;
}

export async function listLeadsService(ctx: TenantContext, input: {
  search?: string;
  filter?: string;
  sort?: string;
  cursor?: string;
  includeConverted?: boolean;
  includeDiscarded?: boolean;
} = {}) {
  return withTenant(ctx.tenantId, async (tx) => {
    const search = input.search?.trim() ?? "";
    const filter = input.filter ?? "all";
    const sort = input.sort ?? "created";
    const includeConverted = Boolean(input.includeConverted);
    const includeDiscarded = Boolean(input.includeDiscarded);
    let cursorScore: number | null = null;
    let cursorDate: string | null = null;
    let cursorId: string | null = null;
    if (input.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as {
          sort?: string; score?: number | null; createdAt?: string; id?: string;
        };
        if (decoded.sort !== sort || !decoded.id || !decoded.createdAt || Number.isNaN(Date.parse(decoded.createdAt))) throw new Error();
        cursorScore = decoded.score ?? null;
        cursorDate = decoded.createdAt;
        cursorId = decoded.id;
      } catch {
        throw new BusinessError("VALIDATION_ERROR", "分页游标无效", "cursor");
      }
    }
    const rows = await tx.execute<LeadRow>(sql`select l.id, l.contact_name as "contactName", l.contact_phone as "contactPhone",
      l.contact_email as "contactEmail", l.company_name as "companyName", l.title,
      l.intended_product_id as "intendedProductId",
      coalesce(prod.name, l.intended_product) as "intendedProduct",
      prod.code as "intendedProductCode",
      prod.category as "intendedProductCategory",
      prod.unit_price as "intendedProductUnitPrice",
      prod.pricing_model as "intendedProductPricingModel",
      prod.unit as "intendedProductUnit",
      l.budget, l.channel, l.utm_source as "utmSource", l.utm_medium as "utmMedium", l.utm_campaign as "utmCampaign",
      l.note, l.source, l.status,
      l.score, l.score_reason as "scoreReason", l.is_possible_duplicate as "isPossibleDuplicate",
      l.owner_user_id as "ownerUserId", u.name as "ownerName", t.id as "taskId", t.due_at::text as "dueAt",
      l.created_at::text as "createdAt"
      from leads l left join users u on u.tenant_id = l.tenant_id and u.id = l.owner_user_id
      left join tasks t on t.tenant_id = l.tenant_id and t.lead_id = l.id and t.status = 'OPEN'
      left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
      where l.tenant_id = ${ctx.tenantId} and l.deleted_at is null
        and (${filter} = 'unassigned' or ${ctx.role} <> 'SALES' or l.owner_user_id = ${ctx.userId})
        and (${search} = '' or l.contact_name ilike ${search + "%"} or l.company_name ilike ${search + "%"} or l.contact_phone = ${search})
        and (
          (${filter} = 'all' and (
            (l.status not in ('DISCARDED', 'CONVERTED'))
            or (${includeConverted} and l.status = 'CONVERTED')
            or (${includeDiscarded} and l.status = 'DISCARDED')
          ))
          or (${filter} = 'overdue' and l.status not in ('DISCARDED', 'CONVERTED') and t.due_at < now())
          or (${filter} = 'high-score' and l.status not in ('DISCARDED', 'CONVERTED') and l.score >= 70)
          or (${filter} = 'high' and l.status not in ('DISCARDED', 'CONVERTED') and l.score >= 70)
          or (${filter} = 'duplicate' and l.status not in ('DISCARDED', 'CONVERTED') and l.is_possible_duplicate)
          or (${filter} = 'unassigned' and (l.status = 'DISCARDED' or (l.owner_user_id is null and l.status not in ('CONVERTED'))))
          or (${filter} = 'discarded' and l.status = 'DISCARDED')
          or (${filter} = 'converted' and l.status = 'CONVERTED')
        )
        and (
          ${cursorDate}::timestamptz is null
          or (${sort} = 'score' and (
            (${cursorScore}::int is not null and (l.score is null or l.score < ${cursorScore} or (l.score = ${cursorScore} and (l.created_at, l.id) < (${cursorDate}::timestamptz, ${cursorId}::uuid))))
            or (${cursorScore}::int is null and l.score is null and (l.created_at, l.id) < (${cursorDate}::timestamptz, ${cursorId}::uuid))
          ))
          or (${sort} <> 'score' and (l.created_at, l.id) < (${cursorDate}::timestamptz, ${cursorId}::uuid))
        )
      order by
        case when ${sort} = 'score' then l.score end desc nulls last,
        case when ${sort} = 'created' then l.created_at end desc,
        l.created_at desc, l.id desc limit 21`);
    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean; is_email_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled, is_email_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const isEmailMasking = secRes.rows[0]?.is_email_masking_enabled ?? false;

    const items = rows.rows.slice(0, 20).map((r) => {
      const isOwner = r.ownerUserId === ctx.userId;
      const shouldMask = ctx.role === "SALES" && !isOwner;
      return {
        ...r,
        contactPhone: (isPhoneMasking && shouldMask) ? maskPhone(r.contactPhone) : r.contactPhone,
        contactEmail: (isEmailMasking && shouldMask) ? maskEmail(r.contactEmail) : r.contactEmail,
      };
    });
    const last = items.at(-1);
    const nextCursor = rows.rows.length > 20 && last
      ? Buffer.from(JSON.stringify({ sort, score: last.score, createdAt: last.createdAt, id: last.id }), "utf8").toString("base64url")
      : null;
    const countRows = await tx.execute<{
      all_count: number;
      overdue_count: number;
      high_count: number;
      duplicate_count: number;
      unassigned_count: number;
      discarded_count: number;
      converted_count: number;
    }>(sql`
      with scoped as not materialized (
        select l.id, l.score, l.is_possible_duplicate, l.owner_user_id
        from leads l
        where l.tenant_id = ${ctx.tenantId}
          and l.deleted_at is null
          and l.status not in ('DISCARDED', 'CONVERTED')
          and (${ctx.role} <> 'SALES' or l.owner_user_id = ${ctx.userId})
      )
      select
        (select count(*)::int from (select id from scoped limit ${LEAD_COUNT_CEILING + 1}) bounded) as all_count,
        (select count(*)::int from (
          select s.id from scoped s
          where exists (
            select 1 from tasks t
            where t.tenant_id = ${ctx.tenantId} and t.lead_id = s.id and t.status = 'OPEN' and t.due_at < now()
          )
          limit ${LEAD_COUNT_CEILING + 1}
        ) bounded) as overdue_count,
        (select count(*)::int from (select id from scoped where score >= 70 limit ${LEAD_COUNT_CEILING + 1}) bounded) as high_count,
        (select count(*)::int from (select id from scoped where is_possible_duplicate limit ${LEAD_COUNT_CEILING + 1}) bounded) as duplicate_count,
        (select count(*)::int from (
          select id from leads
          where tenant_id = ${ctx.tenantId} and deleted_at is null
            and (status = 'DISCARDED' or (owner_user_id is null and status not in ('CONVERTED')))
          limit ${LEAD_COUNT_CEILING + 1}
        ) bounded) as unassigned_count,
        (select count(*)::int from (
          select id from leads
          where tenant_id = ${ctx.tenantId} and deleted_at is null
            and status = 'DISCARDED'
            and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})
          limit ${LEAD_COUNT_CEILING + 1}
        ) bounded) as discarded_count,
        (select count(*)::int from (
          select id from leads
          where tenant_id = ${ctx.tenantId} and deleted_at is null
            and status = 'CONVERTED'
            and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})
          limit ${LEAD_COUNT_CEILING + 1}
        ) bounded) as converted_count
    `);
    const counts = countRows.rows[0];
    return {
      items,
      nextCursor,
      counts: {
        all: counts.all_count,
        overdue: counts.overdue_count,
        "high-score": counts.high_count,
        duplicate: counts.duplicate_count,
        unassigned: counts.unassigned_count,
        discarded: counts.discarded_count,
        converted: counts.converted_count,
      },
      countCeiling: LEAD_COUNT_CEILING,
    };
  });
}

export async function getLeadDetailService(ctx: TenantContext, leadId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const leadResult = await tx.execute<{
      id: string; contactName: string; contactPhone: string; contactEmail: string | null;
      companyName: string | null; title: string | null;
      intendedProductId: string | null;
      intendedProduct: string | null;
      intendedProductCode: string | null;
      intendedProductCategory: string | null;
      intendedProductUnitPrice: number | null;
      intendedProductPricingModel: string | null;
      intendedProductUnit: string | null;
      budget: string | null;
      channel: string | null;
      utmSource: string | null;
      utmMedium: string | null;
      utmCampaign: string | null;
      note: string | null; source: string;
      sourceName: string | null; sourceKey: string | null; externalId: string | null;
      sourceLabel: string | null; receivedAt: string | null;
      status: LeadStatus; score: number | null; scoreReason: string | null; isPossibleDuplicate: boolean;
      ownerUserId: string | null; ownerName: string | null; discardReason: string | null;
      discardNote: string | null; createdAt: string; updatedAt: string;
    }>(sql`select l.id, l.contact_name as "contactName", l.contact_phone as "contactPhone",
      l.contact_email as "contactEmail", l.company_name as "companyName", l.title,
      l.intended_product_id as "intendedProductId",
      coalesce(prod.name, l.intended_product) as "intendedProduct",
      prod.code as "intendedProductCode",
      prod.category as "intendedProductCategory",
      prod.unit_price as "intendedProductUnitPrice",
      prod.pricing_model as "intendedProductPricingModel",
      prod.unit as "intendedProductUnit",
      l.budget, l.channel, l.utm_source as "utmSource", l.utm_medium as "utmMedium", l.utm_campaign as "utmCampaign",
      l.note, l.source,
      source_key.name as "sourceName", source_key.source_key as "sourceKey", l.external_id as "externalId",
      l.source_label as "sourceLabel", l.received_at::text as "receivedAt",
      l.status, l.score, l.score_reason as "scoreReason", l.is_possible_duplicate as "isPossibleDuplicate",
      l.owner_user_id as "ownerUserId", owner.name as "ownerName", l.discard_reason as "discardReason",
      l.discard_note as "discardNote", l.created_at::text as "createdAt", l.updated_at::text as "updatedAt"
      from leads l left join users owner on owner.id = l.owner_user_id
      left join lead_intake_requests intake on intake.tenant_id = l.tenant_id and intake.lead_id = l.id
      left join lead_source_keys source_key on source_key.tenant_id = l.tenant_id and source_key.id = intake.source_key_id
      left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
      where l.id = ${leadId} and l.deleted_at is null
        and (${ctx.role} <> 'SALES' or l.owner_user_id = ${ctx.userId})`);
    const lead = leadResult.rows[0];
    if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");

    const [historyResult, activityResult, taskResult, duplicatesResult, customerMatchResult, scoreFeedbackResult, conversionResult] = await Promise.all([
      tx.execute<{
        id: number; fromStatus: LeadStatus | null; toStatus: LeadStatus; reason: string | null;
        actorUserId: string; actorName: string; createdAt: string;
      }>(sql`select h.id, h.from_status as "fromStatus", h.to_status as "toStatus", h.reason,
        h.actor_user_id as "actorUserId", u.name as "actorName", h.created_at::text as "createdAt"
        from lead_status_history h join users u on u.tenant_id = h.tenant_id and u.id = h.actor_user_id
        where h.tenant_id = ${ctx.tenantId} and h.lead_id = ${leadId} order by h.created_at desc, h.id desc`),
      tx.execute<{
        id: string; type: "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE";
        outcome: "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED" | null;
        summary: string; occurredAt: string; userId: string; userName: string;
      }>(sql`select a.id, a.type, a.outcome, a.summary, a.occurred_at::text as "occurredAt",
        a.user_id as "userId", u.name as "userName"
        from activities a join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
        where a.tenant_id = ${ctx.tenantId} and a.lead_id = ${leadId} order by a.occurred_at desc, a.created_at desc`),
      tx.execute<{
        id: string; type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH"; dueAt: string;
        assigneeUserId: string; assigneeName: string;
      }>(sql`select t.id, t.type, t.due_at::text as "dueAt", t.assignee_user_id as "assigneeUserId",
        u.name as "assigneeName" from tasks t join users u on u.tenant_id = t.tenant_id and u.id = t.assignee_user_id
        where t.tenant_id = ${ctx.tenantId} and t.lead_id = ${leadId} and t.status = 'OPEN' limit 1`),
      tx.execute<{
        id: string; contactName: string; companyName: string | null; status: LeadStatus; ownerName: string | null;
      }>(sql`select d.id, d.contact_name as "contactName", d.company_name as "companyName", d.status,
        u.name as "ownerName" from leads d left join users u on u.tenant_id = d.tenant_id and u.id = d.owner_user_id
        where d.tenant_id = ${ctx.tenantId} and d.id <> ${leadId} and d.contact_phone = ${lead.contactPhone} and d.deleted_at is null
        and d.status <> 'DISCARDED'
        and (${ctx.role} <> 'SALES' or d.owner_user_id = ${ctx.userId})
        order by d.created_at`),
      tx.execute<{ id: string; name: string; ownerName: string; ownerUserId: string; contactName: string; contactPhone: string; contactEmail: string | null; contactTitle: string | null }>(sql`select c.id, c.name, coalesce(u.name, '公海客户') as "ownerName", c.owner_user_id as "ownerUserId", ct.name as "contactName", ct.phone as "contactPhone", ct.email as "contactEmail", ct.title as "contactTitle"
        from contacts ct join customers c on c.tenant_id = ct.tenant_id and c.id = ct.customer_id
        left join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
        where ct.tenant_id = ${ctx.tenantId} and ct.phone = ${lead.contactPhone}
          and ct.deleted_at is null and c.deleted_at is null
          limit 1`),
      tx.execute<{ verdict: "ACCURATE" | "INACCURATE"; scoreAtFeedback: number; updatedAt: string }>(sql`select verdict, score_at_feedback as "scoreAtFeedback", updated_at::text as "updatedAt"
        from score_feedback where tenant_id = ${ctx.tenantId} and lead_id = ${leadId} and user_id = ${ctx.userId}`),
      tx.execute<{ customerId: string; customerName: string; opportunityId: string | null; opportunityName: string | null }>(sql`
        select c.id as "customerId", c.name as "customerName", o.id as "opportunityId", o.name as "opportunityName"
        from lead_conversions lc
        join customers c on c.tenant_id = lc.tenant_id and c.id = lc.customer_id
        left join opportunities o on o.tenant_id = lc.tenant_id and o.id = lc.opportunity_id
        where lc.tenant_id = ${ctx.tenantId} and lc.lead_id = ${leadId}
        limit 1`),
    ]);

    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean; is_email_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled, is_email_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const isEmailMasking = secRes.rows[0]?.is_email_masking_enabled ?? false;
    const isOwner = lead.ownerUserId === ctx.userId;
    const shouldMask = ctx.role === "SALES" && !isOwner;

    if (shouldMask) {
      if (isPhoneMasking && lead.contactPhone) {
        lead.contactPhone = maskPhone(lead.contactPhone);
      }
      if (isEmailMasking && lead.contactEmail) {
        lead.contactEmail = maskEmail(lead.contactEmail);
      }
    }

    const matchedCustomer = customerMatchResult.rows[0];
    if (matchedCustomer && ctx.role === "SALES" && matchedCustomer.ownerUserId !== ctx.userId) {
      if (isPhoneMasking && matchedCustomer.contactPhone) {
        matchedCustomer.contactPhone = maskPhone(matchedCustomer.contactPhone);
      }
      if (isEmailMasking && matchedCustomer.contactEmail) {
        matchedCustomer.contactEmail = maskEmail(matchedCustomer.contactEmail);
      }
    }

    const conv = conversionResult.rows[0];

    return {
      lead,
      statusHistory: historyResult.rows,
      activities: activityResult.rows,
      openTask: taskResult.rows[0] ?? null,
      // 已转化线索只看结果：行动引导类卡片（匹配存量客户/撞单预警/疑似重复合并）
      // 对 CONVERTED 无意义——匹配到的必然是自己刚转出的客户（误导），
      // 合并按钮点击必被 INVALID_TRANSITION 拒绝（报错体验）。统一置空。
      possibleDuplicates: lead.status === "CONVERTED" ? [] : duplicatesResult.rows,
      existingCustomerMatch: lead.status === "CONVERTED"
        ? null
        : customerMatchResult.rows[0] && (ctx.role !== "SALES" || customerMatchResult.rows[0].ownerUserId === ctx.userId)
        ? customerMatchResult.rows[0]
        : null,
      restrictedCustomerMatch: lead.status === "CONVERTED"
        ? false
        : Boolean(customerMatchResult.rows[0] && ctx.role === "SALES" && customerMatchResult.rows[0].ownerUserId !== ctx.userId),
      convertedCustomer: conv ? { id: conv.customerId, name: conv.customerName } : null,
      convertedOpportunity: conv?.opportunityId ? { id: conv.opportunityId, name: conv.opportunityName || "关联商机" } : null,
      scoreFeedback: scoreFeedbackResult.rows[0] ?? null,
    };
  });
}

async function getLeadForWrite(tx: TenantTransaction, ctx: TenantContext, leadId: string, allowPublicPool = false) {
  const found = await tx.execute<{ id: string; owner_user_id: string | null; status: string; contact_name: string; source: string; score: number | null }>(sql`
    select id, owner_user_id, status, contact_name, source, score
      from leads where id = ${leadId} and deleted_at is null for update`);
  const lead = found.rows[0];
  if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  if (!allowPublicPool && !canManage(ctx, lead.owner_user_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  return lead;
}

export async function assignLeadService(ctx: TenantContext, leadId: string, assigneeUserId: string) {
  if (ctx.role === "SALES" && assigneeUserId !== ctx.userId) {
    throw new BusinessError("FORBIDDEN", "销售专员仅可从公海认领线索至本人名下");
  }
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const lead = await getLeadForWrite(tx, ctx, leadId, true);
    if (lead.status === "CONVERTED") {
      throw new BusinessError("CONFLICT", "该线索已转化为客户，无法重新指派或认领");
    }
    if (ctx.role === "SALES" && lead.owner_user_id && lead.owner_user_id !== ctx.userId && lead.status !== "DISCARDED") {
      throw new BusinessError("FORBIDDEN", "该线索已分配责任人，无法重复认领");
    }
    const user = await tx.execute(sql`select id from users where id = ${assigneeUserId} and status = 'ACTIVE'`);
    if (!user.rows[0]) throw new BusinessError("NOT_FOUND", "负责人不存在或已停用");
    if (lead.status === "DISCARDED") {
      await tx.execute(sql`update leads set status = 'NEW', discard_reason = null, discard_note = null, owner_user_id = ${assigneeUserId}, claimed_at = now(), updated_at = now() where id = ${leadId}`);
      await recordLeadStatus(tx, ctx, leadId, "DISCARDED", "NEW", "从公海打捞指派重新激活");
    } else {
      await tx.execute(sql`update leads set owner_user_id = ${assigneeUserId}, claimed_at = now(), updated_at = now() where id = ${leadId}`);
    }
    const open = await tx.execute<{ id: string }>(sql`select id from tasks where lead_id = ${leadId} and status = 'OPEN'`);
    const taskId = open.rows[0]?.id ?? (await tx.execute<{ id: string }>(sql`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
      values (${ctx.tenantId}, ${leadId}, ${assigneeUserId}, 'FIRST_RESPONSE', now() + interval '24 hours') returning id`)).rows[0].id;
    if (open.rows[0]) await tx.execute(sql`update tasks set assignee_user_id = ${assigneeUserId}, updated_at = now() where id = ${taskId}`);
    await createLeadAssignedNotification(tx, {
      tenantId: ctx.tenantId,
      userId: assigneeUserId,
      taskId,
      leadId,
      contactName: lead.contact_name,
      source: lead.source,
      score: lead.score,
    });
    await audit(tx, ctx, "lead.assign", leadId, { from: lead.owner_user_id, to: assigneeUserId });
    return { leadId };
  });
  await scoreAndRefreshLeadAfterCommit(ctx, result.leadId, false);
  return result;
}

export async function updateLeadService(ctx: TenantContext, leadId: string, input: LeadUpdateInput) {
  const shouldScore = input.companyName !== undefined || input.contactEmail !== undefined || input.title !== undefined;
  const result = await withTenant(ctx.tenantId, async (tx) => {
    await getLeadForWrite(tx, ctx, leadId);
    await assertIntendedProductInTenant(tx, ctx, input.intendedProductId);
    if (input.contactPhone) {
      const duplicate = await findDuplicate(tx, input.contactPhone);
      if (duplicate && duplicate.leadId !== leadId) {
        throw new BusinessError("CONFLICT", "该手机号已存在线索");
      }
    }
    await tx.execute(sql`update leads set
      contact_name = coalesce(${input.contactName ?? null}, contact_name),
      contact_phone = coalesce(${input.contactPhone ?? null}, contact_phone),
      contact_email = case when ${input.contactEmail === undefined} then contact_email else ${input.contactEmail ?? null} end,
      company_name = case when ${input.companyName === undefined} then company_name else ${input.companyName ?? null} end,
      title = case when ${input.title === undefined} then title else ${input.title ?? null} end,
      intended_product_id = case when ${input.intendedProductId === undefined} then intended_product_id else ${input.intendedProductId ?? null} end,
      intended_product = case when ${input.intendedProduct === undefined} then intended_product else ${input.intendedProduct ?? null} end,
      budget = case when ${input.budget === undefined} then budget else ${input.budget ?? null} end,
      channel = case when ${input.channel === undefined} then channel else ${input.channel ?? null} end,
      utm_source = case when ${input.utmSource === undefined} then utm_source else ${input.utmSource ?? null} end,
      utm_medium = case when ${input.utmMedium === undefined} then utm_medium else ${input.utmMedium ?? null} end,
      utm_campaign = case when ${input.utmCampaign === undefined} then utm_campaign else ${input.utmCampaign ?? null} end,
      note = case when ${input.note === undefined} then note else ${input.note ?? null} end,
      updated_at = now() where id = ${leadId}`);
    await audit(tx, ctx, "lead.update", leadId, input);
    return { leadId };
  });
  if (shouldScore) await scoreAndRefreshLeadAfterCommit(ctx, result.leadId, true);
  return result;
}

export async function assignLeadsBulkService(ctx: TenantContext, leadIds: string[], assigneeUserId: string) {
  if (leadIds.length > 50) throw new BusinessError("VALIDATION_ERROR", "一次最多分配 50 条线索", "leadIds");
  const failed: Array<{ leadId: string; code: string }> = [];
  let succeeded = 0;
  for (const leadId of [...new Set(leadIds)]) {
    try {
      await assignLeadService(ctx, leadId, assigneeUserId);
      succeeded += 1;
    } catch (error) {
      failed.push({ leadId, code: error instanceof BusinessError ? error.code : "INTERNAL_ERROR" });
    }
  }
  return { succeeded, failed };
}

export async function qualifyLeadService(ctx: TenantContext, leadId: string, note: string) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const lead = await getLeadForWrite(tx, ctx, leadId);
    if (lead.status !== "CONTACTED") throw new BusinessError("INVALID_TRANSITION", "当前状态不允许此操作");
    await tx.execute(sql`update leads set status = 'QUALIFIED', updated_at = now() where id = ${leadId}`);
    await recordLeadStatus(tx, ctx, leadId, "CONTACTED", "QUALIFIED", note);
    await audit(tx, ctx, "lead.qualify", leadId, { note });
    return { leadId };
  });
  await scoreAndRefreshLeadAfterCommit(ctx, result.leadId, false);
  return result;
}

export async function discardLeadService(ctx: TenantContext, input: { leadId: string; reason: string; note?: string }) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const lead = await getLeadForWrite(tx, ctx, input.leadId);
    if (lead.status === "CONVERTED" || lead.status === "DISCARDED") throw new BusinessError("INVALID_TRANSITION", "当前状态不允许此操作");
    await tx.execute(sql`update leads set status = 'DISCARDED', discard_reason = ${input.reason}::discard_reason,
      discard_note = ${input.note ?? null}, updated_at = now() where id = ${input.leadId}`);
    await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where lead_id = ${input.leadId} and status = 'OPEN'`);
    await recordLeadStatus(tx, ctx, input.leadId, lead.status as LeadStatus, "DISCARDED", input.note || discardReasonLabels[input.reason] || input.reason);
    await audit(tx, ctx, "lead.discard", input.leadId, { reason: input.reason, note: input.note });
    return { leadId: input.leadId };
  });
  await refreshInsightsSafely(ctx, { type: "lead", id: result.leadId });
  return result;
}

export async function restoreLeadService(ctx: TenantContext, leadId: string) {
  if (ctx.role === "SALES") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const lead = await getLeadForWrite(tx, ctx, leadId);
    if (lead.status !== "DISCARDED") throw new BusinessError("INVALID_TRANSITION", "当前状态不允许此操作");
    await tx.execute(sql`update leads set status = 'NEW', discard_reason = null, discard_note = null, updated_at = now() where id = ${leadId}`);
    if (lead.owner_user_id) {
      await tx.execute(sql`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
        values (${ctx.tenantId}, ${leadId}, ${lead.owner_user_id}, 'FIRST_RESPONSE', now() + interval '24 hours')`);
    }
    await recordLeadStatus(tx, ctx, leadId, "DISCARDED", "NEW", "管理员恢复线索");
    await audit(tx, ctx, "lead.restore", leadId);
    return { leadId };
  });
  await refreshInsightsSafely(ctx, { type: "lead", id: result.leadId });
  return result;
}

export async function mergeLeadService(ctx: TenantContext, sourceLeadId: string, targetLeadId: string) {
  if (sourceLeadId === targetLeadId) throw new BusinessError("VALIDATION_ERROR", "不能合并到当前线索");
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const source = await getLeadForWrite(tx, ctx, sourceLeadId);
    const target = await getLeadForWrite(tx, ctx, targetLeadId);
    if (source.status === "CONVERTED" || source.status === "DISCARDED") throw new BusinessError("INVALID_TRANSITION", "当前状态的线索不能合并");
    if (target.status === "CONVERTED" || target.status === "DISCARDED") throw new BusinessError("INVALID_TRANSITION", "目标线索已转化或已废弃，不能作为合并目标");
    await tx.execute(sql`update activities set lead_id = ${targetLeadId} where lead_id = ${sourceLeadId}`);
    await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where lead_id = ${sourceLeadId} and status = 'OPEN'`);
    await tx.execute(sql`update leads set status = 'DISCARDED', discard_reason = 'OTHER',
      discard_note = '合并到其他线索', updated_at = now() where id = ${sourceLeadId}`);
    await recordLeadStatus(tx, ctx, sourceLeadId, source.status as LeadStatus, "DISCARDED", `合并到线索 ${targetLeadId}`);
    await audit(tx, ctx, "lead.merge", sourceLeadId, { targetLeadId });
    return { sourceLeadId, targetLeadId };
  });
  await refreshInsightsSafely(ctx, { type: "lead", id: result.sourceLeadId });
  await refreshInsightsSafely(ctx, { type: "lead", id: result.targetLeadId });
  return result;
}

export async function importLeadsService(
  ctx: TenantContext,
  rows: LeadInput[],
  skipDuplicates: boolean,
): Promise<{ created: number; skipped: number; failed: number; errors?: Array<{ rowNumber: number; contactMasked: string; reason: string }> }> {
  if (ctx.role === "SALES") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  if (rows.length > 1000) throw new BusinessError("VALIDATION_ERROR", "单次最多导入 1000 行");
  const BATCH_SIZE = 200;
  const CONCURRENCY = 8;
  const result = await withTenant(ctx.tenantId, async (tx) => {
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const leadIds: string[] = [];
    const errors: Array<{ rowNumber: number; contactMasked: string; reason: string }> = [];

    const maskRow = (row: LeadInput, rowNumber: number) =>
      (row.contactPhone ? maskPhone(row.contactPhone) : null)
        || (row.contactEmail ? maskEmail(row.contactEmail) : null)
        || (row.contactName ? `${row.contactName.slice(0, 1)}**` : `第 ${rowNumber} 行联系人`);

    const pushError = (rowNumber: number, contactMasked: string, err: unknown) => {
      if (errors.length >= 50) return;
      let reason = "数据写入异常";
      if (err instanceof BusinessError) reason = err.message;
      else if (err instanceof Error) {
        const rawMsg = err.message;
        if (rawMsg.includes("leads_tenant_id_contact_phone_uq")) reason = "手机号在该租户中已存在";
        else if (rawMsg.includes("invalid input syntax for type uuid")) reason = "意向产品 ID 格式无效";
        else reason = rawMsg.replace(/^Failed query:.*error: /s, "").slice(0, 120);
      }
      errors.push({ rowNumber, contactMasked, reason });
    };

    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
      const batchPhones = batch.map((r) => r.contactPhone).filter((v): v is string => Boolean(v));

      // 批内一次撞单预查：contacts + leads
      const contactPhoneSet = new Set<string>();
      const leadPhoneSet = new Set<string>();
      if (batchPhones.length > 0) {
        const contactRes = await tx.execute<{ phone: string }>(sql`
          select phone from contacts
          where tenant_id = ${ctx.tenantId} and phone = any(${sql`array[${sql.join(batchPhones.map((p) => sql`${p}`), sql`, `)}]::text[]`}) and deleted_at is null
        `);
        for (const r of contactRes.rows) contactPhoneSet.add(r.phone);
        const leadRes = await tx.execute<{ phone: string }>(sql`
          select contact_phone as phone from leads
          where tenant_id = ${ctx.tenantId} and contact_phone = any(${sql`array[${sql.join(batchPhones.map((p) => sql`${p}`), sql`, `)}]::text[]`}) and deleted_at is null
        `);
        for (const r of leadRes.rows) leadPhoneSet.add(r.phone);
      }

      // 批内产品存在性预查
      const distinctProdIds = [...new Set(batch.map((r) => r.intendedProductId).filter((v): v is string => Boolean(v)))];
      const validProductSet = new Set<string>();
      if (distinctProdIds.length > 0) {
        const prodRes = await tx.execute<{ id: string }>(sql`
          select id::text as id from products
          where tenant_id = ${ctx.tenantId} and id = any(${sql`array[${sql.join(distinctProdIds.map((id) => sql`${id}::uuid`), sql`, `)}]`}::uuid[]) and deleted_at is null
        `);
        for (const r of prodRes.rows) validProductSet.add(r.id);
      }

      type Candidate = { idx: number; row: LeadInput; rowNumber: number; contactMasked: string; hasCollision: boolean };
      const candidates: Candidate[] = [];
      const batchSeen = new Set<string>();

      for (let i = 0; i < batch.length; i++) {
        const idx = batchStart + i;
        const row = batch[i];
        const rowNumber = idx + 1;
        const contactMasked = maskRow(row, rowNumber);
        if (!row.contactName || !row.contactPhone) {
          failed += 1;
          pushError(rowNumber, contactMasked, new BusinessError("VALIDATION_ERROR", "联系人姓名与手机号为必填项"));
          // R06: 失败行不得占用批内去重集合，策略：前一行失败后后续同号合法行仍继续处理
          continue;
        }
        const isBatchDuplicate = batchSeen.has(row.contactPhone);
        const hasCollision = contactPhoneSet.has(row.contactPhone) || leadPhoneSet.has(row.contactPhone) || isBatchDuplicate;
        if (hasCollision && skipDuplicates) {
          skipped += 1;
          continue;
        }
        if (row.intendedProductId && !validProductSet.has(row.intendedProductId)) {
          failed += 1;
          pushError(rowNumber, contactMasked, new BusinessError("VALIDATION_ERROR", "意向产品不存在或不属于当前企业", "intendedProductId"));
          // R06: 产品不存在等校验失败的行不加入 batchSeen，避免抑制后续同号合法行
          continue;
        }
        // R06: 仅当行通过校验并进入待插入候选后才加入 batchSeen；失败行不得占用
        candidates.push({ idx, row, rowNumber, contactMasked, hasCollision });
        batchSeen.add(row.contactPhone);
      }

      if (candidates.length === 0) continue;

      // 尝试批量插入多 values，失败则回退到逐行 savepoint
      const batchSp = sql.raw(`import_batch_${batchStart}`);
      await tx.execute(sql`savepoint ${batchSp}`);
      try {
        const valueFrags = candidates.map((c) => sql`(${ctx.tenantId}::uuid, null, ${c.row.contactName}, ${c.row.contactPhone}, ${c.row.contactEmail ?? null}, ${c.row.companyName ?? null}, ${c.row.title ?? null}, ${c.row.intendedProductId ? sql`${c.row.intendedProductId}::uuid` : null}, ${c.row.intendedProduct ?? null}, ${c.row.budget ?? null}, ${c.row.channel ?? null}, ${c.row.utmSource ?? null}, ${c.row.utmMedium ?? null}, ${c.row.utmCampaign ?? null}, ${c.row.note ?? null}, 'import', ${c.hasCollision})`);
        const insertRes = await tx.execute<{ id: string }>(sql`
          insert into leads
            (tenant_id, owner_user_id, contact_name, contact_phone, contact_email, company_name, title, intended_product_id, intended_product, budget, channel, utm_source, utm_medium, utm_campaign, note, source, is_possible_duplicate)
          values ${sql.join(valueFrags, sql`, `)}
          returning id
        `);
        // 批量插入成功，补齐关联记录
        for (let j = 0; j < candidates.length; j++) {
          const leadId = insertRes.rows[j].id;
          await tx.execute(sql`insert into lead_status_history (tenant_id, lead_id, from_status, to_status, reason, actor_user_id) values (${ctx.tenantId}::uuid, ${leadId}::uuid, null, 'NEW'::lead_status, 'CSV 导入线索', ${ctx.userId}::uuid)`);
          await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail) values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, 'lead.import', 'lead', ${leadId}::uuid, '{}'::jsonb)`);
          leadIds.push(leadId);
          created += 1;
        }
        await tx.execute(sql`release savepoint ${batchSp}`);
      } catch (batchErr: unknown) {
        await tx.execute(sql`rollback to savepoint ${batchSp}`);
        await tx.execute(sql`release savepoint ${batchSp}`);
        // 回退逐行
        for (const c of candidates) {
          const sp = sql.raw(`import_row_${c.idx}`);
          await tx.execute(sql`savepoint ${sp}`);
          try {
            const res = await tx.execute<{ id: string }>(sql`
              insert into leads
                (tenant_id, owner_user_id, contact_name, contact_phone, contact_email, company_name, title, intended_product_id, intended_product, budget, channel, utm_source, utm_medium, utm_campaign, note, source, is_possible_duplicate)
              values (${ctx.tenantId}::uuid, null, ${c.row.contactName}, ${c.row.contactPhone}, ${c.row.contactEmail ?? null}, ${c.row.companyName ?? null}, ${c.row.title ?? null}, ${c.row.intendedProductId ? sql`${c.row.intendedProductId}::uuid` : null}, ${c.row.intendedProduct ?? null}, ${c.row.budget ?? null}, ${c.row.channel ?? null}, ${c.row.utmSource ?? null}, ${c.row.utmMedium ?? null}, ${c.row.utmCampaign ?? null}, ${c.row.note ?? null}, 'import', ${c.hasCollision})
              returning id
            `);
            const leadId = res.rows[0].id;
            await tx.execute(sql`insert into lead_status_history (tenant_id, lead_id, from_status, to_status, reason, actor_user_id) values (${ctx.tenantId}::uuid, ${leadId}::uuid, null, 'NEW'::lead_status, 'CSV 导入线索', ${ctx.userId}::uuid)`);
            await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail) values (${ctx.tenantId}::uuid, ${ctx.userId}::uuid, 'lead.import', 'lead', ${leadId}::uuid, '{}'::jsonb)`);
            await tx.execute(sql`release savepoint ${sp}`);
            leadIds.push(leadId);
            created += 1;
          } catch (err: unknown) {
            await tx.execute(sql`rollback to savepoint ${sp}`);
            await tx.execute(sql`release savepoint ${sp}`);
            failed += 1;
            pushError(c.rowNumber, c.contactMasked, err);
          }
        }
      }
    }
    return { created, skipped, failed, leadIds, errors };
  });
  // 受控并发（chunk 8）执行评分与洞察刷新，不引入第三方依赖
  if (result.leadIds.length > 0) {
    for (let i = 0; i < result.leadIds.length; i += CONCURRENCY) {
      const chunk = result.leadIds.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map((leadId) => scoreAndRefreshLeadAfterCommit(ctx, leadId, true)));
    }
  }
  const base = {
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
  };
  return result.errors.length > 0 ? { ...base, errors: result.errors } : base;
}

export async function classifyImportRowsService(ctx: TenantContext, rows: CsvPreviewRow[]) {
  if (ctx.role === "SALES") throw new BusinessError("FORBIDDEN", "你没有权限执行此操作");
  return withTenant(ctx.tenantId, async (tx) => {
    const valid: CsvPreviewRow[] = [];
    const duplicates: Array<CsvPreviewRow & { reason: string }> = [];
    for (const row of rows) {
      const duplicate = await findDuplicate(tx, row.data.contactPhone);
      if (duplicate) duplicates.push({ ...row, reason: `已存在线索：${duplicate.contactName}` });
      else valid.push(row);
    }
    return { valid, duplicates };
  });
}

export async function getAssignableUsersService(ctx: TenantContext) {
  if (ctx.role === "SALES") return [];
  return withTenant(ctx.tenantId, async (tx) => (await tx.execute<{ id: string; name: string; role?: "ADMIN" | "MANAGER" | "SALES" }>(sql`
    select id, name, role::text as role from users where status = 'ACTIVE' order by name`)).rows);
}
