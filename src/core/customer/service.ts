import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { sqlDate } from "@/core/shared/date";
import { decodeDetailCollectionCursor, decodePoolCursor, encodeDetailCollectionCursor, encodePoolCursor, nextTimelineLimit, type DetailCollectionCursor } from "@/core/shared/pagination";
import { refreshInsightsSafely } from "@/core/insight/service";
import { maskPhone, maskEmail } from "@/core/security/masking";
import { getPluginFactsProvider } from "@/core/plugin-facts";
import type { ContactCreateInput, ContactUpdateInput, ConvertLeadInput, CustomerCreateDirectInput, CustomerDetail, CustomerDetailCollection, CustomerDetailCollectionPage, CustomerDetailContact, CustomerDetailOpenTask, CustomerDetailOpportunity, CustomerDetailSourceLead, CustomerList, CustomerSort, CustomerStatus, CustomerTimelinePage, CustomerUpdateInput } from "./types";

const canSee = (ctx: TenantContext, ownerId: string) => ctx.role !== "SALES" || ctx.userId === ownerId;

async function audit(tx: TenantTransaction, ctx: TenantContext, action: string, type: string, id: string, detail: object = {}) {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, ${type}, ${id}, ${JSON.stringify(detail)}::jsonb)`);
}

export async function createCustomerDirectService(ctx: TenantContext, input: CustomerCreateDirectInput) {
  return withTenant(ctx.tenantId, async (tx) => {
    if (input.contactPhone) {
      const contactResult = await tx.execute<{ id: string }>(sql`
        select c.id from contacts c
        join customers cu on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
        where c.tenant_id = ${ctx.tenantId} and c.phone = ${input.contactPhone} and c.deleted_at is null and cu.deleted_at is null
        limit 1
      `);
      if (contactResult.rows.length > 0) {
        throw new BusinessError("DUPLICATE_PHONE", "该手机号已关联其他客户", "contactPhone");
      }
    }

    const customerType = input.customerType ?? "ENTERPRISE";
    const customerRes = await tx.execute<{ id: string }>(sql`
      insert into customers (
        tenant_id,
        owner_user_id,
        customer_type,
        name,
        industry,
        region,
        size,
        created_at,
        updated_at
      ) values (
        ${ctx.tenantId},
        ${ctx.userId},
        ${customerType}::customer_type,
        ${input.name},
        ${input.industry ?? null},
        ${input.region ?? null},
        ${input.size ?? null}::customer_size,
        now(),
        now()
      ) returning id
    `);
    const customerId = customerRes.rows[0].id;

    let contactId: string | null = null;
    if (input.contactName && input.contactPhone) {
      const contactRes = await tx.execute<{ id: string }>(sql`
        insert into contacts (
          tenant_id,
          customer_id,
          name,
          phone,
          email,
          title,
          role_tag,
          is_primary,
          created_at,
          updated_at
        ) values (
          ${ctx.tenantId},
          ${customerId},
          ${input.contactName},
          ${input.contactPhone},
          ${input.contactEmail ?? null},
          ${input.contactTitle ?? null},
          ${input.contactRoleTag ?? "DECISION_MAKER"}::contact_role_tag,
          true,
          now(),
          now()
        ) returning id
      `);
      contactId = contactRes.rows[0].id;
    }

    await audit(tx, ctx, "customer.create_direct", "customer", customerId, { name: input.name, contactId });
    return { customerId, contactId };
  });
}

export async function convertLeadToCustomerService(ctx: TenantContext, input: ConvertLeadInput) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const leadResult = await tx.execute<{
      id: string;
      owner_user_id: string | null;
      status: string;
      contact_name: string;
      contact_phone: string;
      contact_email: string | null;
      company_name: string | null;
      title: string | null;
      intended_product_id: string | null;
      intended_product: string | null;
    }>(sql`
      select id, owner_user_id, status, contact_name, contact_phone, contact_email, company_name, title,
        intended_product_id::text as intended_product_id, intended_product
      from leads where id = ${input.leadId} and deleted_at is null for update`);
    const lead = leadResult.rows[0];
    if (!lead) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    if (lead.owner_user_id && !canSee(ctx, lead.owner_user_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    if (lead.status !== "QUALIFIED" || !lead.owner_user_id) {
      if (lead.status === "CONVERTED") throw new BusinessError("CONFLICT", "该线索已完成转化，请刷新");
      throw new BusinessError("INVALID_TRANSITION", "只有已确认需求且已分配负责人的线索可以转客户");
    }

    // 检查客户共享机制
    const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean; require_product_exclusivity: boolean }>(sql`
      select allow_multi_sales_followup, require_product_exclusivity
      from public.customer_collaboration_settings
      where tenant_id = ${ctx.tenantId}
      limit 1
    `);
    const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;
    // 排他保护默认开启（与设置页口径一致，可由管理员显式关闭）
    const requireProductExclusivity = collabSettings.rows[0]?.require_product_exclusivity ?? true;

    const contactResult = await tx.execute<{ id: string; customer_id: string; owner_user_id: string }>(sql`
      select c.id, c.customer_id, cu.owner_user_id from contacts c join customers cu on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
      where c.phone = ${input.contactPhone} and c.deleted_at is null and cu.deleted_at is null for update`);
    const existingContact = contactResult.rows[0];
    let customerId: string;
    let contactId: string;
    if (input.linkToExistingCustomerId) {
      const existing = await tx.execute<{ id: string; owner_user_id: string }>(sql`
        select id, owner_user_id from customers where id = ${input.linkToExistingCustomerId} and deleted_at is null for update`);
      const customer = existing.rows[0];
      if (!customer) {
        throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
      }

      const isCustomerOwner = customer.owner_user_id === ctx.userId;
      const isManagerOrAdmin = ctx.role === "MANAGER" || ctx.role === "ADMIN";

      if (!allowMultiSalesFollowup && !isCustomerOwner && !isManagerOrAdmin) {
        throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
      }

      customerId = customer.id;
      if (existingContact && existingContact.customer_id === customer.id) {
        contactId = existingContact.id;
      } else if (!existingContact) {
        const contact = await tx.execute<{ id: string }>(sql`insert into contacts
          (tenant_id, customer_id, name, phone, email, title, role_tag, is_primary)
          values (${ctx.tenantId}, ${customerId}, ${input.contactName}, ${input.contactPhone}, ${input.contactEmail ?? null}, ${input.contactTitle ?? null}, ${input.contactRoleTag ?? "OTHER"}::contact_role_tag, false) returning id`);
        contactId = contact.rows[0].id;
      } else {
        throw new BusinessError("DUPLICATE_PHONE", "该手机号已关联其他客户", "contactPhone");
      }
    } else {
      if (existingContact) throw new BusinessError("DUPLICATE_PHONE", "该手机号已关联其他客户", "contactPhone");
      const customerType = input.customerType ?? "ENTERPRISE";
      const customer = await tx.execute<{ id: string }>(sql`insert into customers
        (tenant_id, owner_user_id, customer_type, name, industry, region, size)
        values (${ctx.tenantId}, ${lead.owner_user_id}, ${customerType}::customer_type, ${input.customerName}, ${input.industry ?? null}, ${input.region ?? null}, ${input.size ?? null}::customer_size) returning id`);
      customerId = customer.rows[0].id;
      const contact = await tx.execute<{ id: string }>(sql`insert into contacts
        (tenant_id, customer_id, name, phone, email, title, role_tag, is_primary)
        values (${ctx.tenantId}, ${customerId}, ${input.contactName}, ${input.contactPhone}, ${input.contactEmail ?? null}, ${input.contactTitle ?? null}, ${input.contactRoleTag ?? "OTHER"}::contact_role_tag, true) returning id`);
      contactId = contact.rows[0].id;
    }

    // 意向产品判定与防撞单排他校验
    const primaryLineItemProductId = input.lineItems?.[0]?.productId ?? null;
    const effectiveIntendedProductId = primaryLineItemProductId ?? lead.intended_product_id ?? null;
    const effectiveIntendedProduct = lead.intended_product ?? null;
    const lineItemProductIds = input.lineItems?.map((li) => li.productId) ?? [];

    // 防撞单排他扫描（管理员显式关闭排他保护后跳过，允许并行立项）
    if (requireProductExclusivity) {
    const existingActiveOpps = await tx.execute<{
      id: string;
      name: string;
      owner_user_id: string;
      owner_name: string;
      stage: string;
      intended_product_id: string | null;
      intended_product: string | null;
      intended_product_name: string | null;
      line_item_product_ids: string[] | null;
    }>(sql`
      select
        o.id,
        o.name,
        o.owner_user_id,
        coalesce(u.name, '其他销售') as owner_name,
        o.stage::text as stage,
        o.intended_product_id::text,
        o.intended_product,
        p.name as intended_product_name,
        array_remove(array_agg(distinct oli.product_id::text), null) as line_item_product_ids
      from public.opportunities o
      left join public.users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      left join public.products p on p.tenant_id = o.tenant_id and p.id = o.intended_product_id and p.deleted_at is null
      left join public.opportunity_line_items oli on oli.tenant_id = o.tenant_id and oli.opportunity_id = o.id
      where o.tenant_id = ${ctx.tenantId}
        and o.customer_id = ${customerId}
        and o.stage not in ('WON', 'LOST')
        and o.deleted_at is null
      group by o.id, o.name, o.owner_user_id, u.name, o.stage, o.intended_product_id, o.intended_product, p.name
    `);

    for (const existingOpp of existingActiveOpps.rows) {
      if (existingOpp.owner_user_id === ctx.userId) {
        continue;
      }

      let isCollision = false;
      let collisionProductLabel = "";

      if (effectiveIntendedProductId) {
        if (
          existingOpp.intended_product_id === effectiveIntendedProductId ||
          (existingOpp.line_item_product_ids && existingOpp.line_item_product_ids.includes(effectiveIntendedProductId))
        ) {
          isCollision = true;
          collisionProductLabel = existingOpp.intended_product_name || existingOpp.intended_product || "该产品";
        }
      }

      if (!isCollision && effectiveIntendedProduct && effectiveIntendedProduct.trim()) {
        const trimmedTarget = effectiveIntendedProduct.trim().toLowerCase();
        if (
          (existingOpp.intended_product && existingOpp.intended_product.trim().toLowerCase() === trimmedTarget) ||
          (existingOpp.intended_product_name && existingOpp.intended_product_name.trim().toLowerCase() === trimmedTarget)
        ) {
          isCollision = true;
          collisionProductLabel = existingOpp.intended_product || existingOpp.intended_product_name || effectiveIntendedProduct;
        }
      }

      if (!isCollision && lineItemProductIds.length > 0) {
        for (const pid of lineItemProductIds) {
          if (
            existingOpp.intended_product_id === pid ||
            (existingOpp.line_item_product_ids && existingOpp.line_item_product_ids.includes(pid))
          ) {
            isCollision = true;
            collisionProductLabel = existingOpp.intended_product_name || "选配产品";
            break;
          }
        }
      }

      if (
        !isCollision &&
        !effectiveIntendedProductId &&
        !effectiveIntendedProduct &&
        !existingOpp.intended_product_id &&
        !existingOpp.intended_product &&
        (!existingOpp.line_item_product_ids || existingOpp.line_item_product_ids.length === 0)
      ) {
        isCollision = true;
        collisionProductLabel = "通用业务";
      }

      if (isCollision) {
        throw new BusinessError(
          "COLLISION",
          `该客户已有销售【${existingOpp.owner_name}】在推进【${collisionProductLabel}】相关商机（${existingOpp.name}），同客户同产品方向暂不允许重复立项`,
        );
      }
    }
    }

    const converted = await tx.execute(sql`update leads set status = 'CONVERTED', updated_at = now()
      where id = ${lead.id} and status = 'QUALIFIED'`);
    if (converted.rowCount !== 1) throw new BusinessError("CONFLICT", "数据已被他人修改，请刷新后重试");
    await tx.execute(sql`insert into lead_status_history (tenant_id, lead_id, from_status, to_status, reason, actor_user_id)
      values (${ctx.tenantId}, ${lead.id}, 'QUALIFIED', 'CONVERTED', '转客户并创建商机', ${ctx.userId})`);
    let expectedAmount = input.expectedAmount !== undefined && input.expectedAmount !== null ? BigInt(input.expectedAmount) : null;
    let computedLineItemsTotal = 0;
    if (input.lineItems && input.lineItems.length > 0) {
      for (const item of input.lineItems) {
        const subtotal = Math.round((item.unitPrice * item.quantity * item.discountRate) / 100);
        computedLineItemsTotal += subtotal;
      }
      if (!expectedAmount || expectedAmount === BigInt(0)) {
        expectedAmount = BigInt(computedLineItemsTotal);
      }
    }

    const expectedCloseAt = sqlDate(input.expectedCloseAt);
    const demandNote = input.demandNote ?? null;

    // 新商机归属线索负责人（一线销售）。管理员/主管代点转化按钮时
    // ctx 是管理员——商机、推进待办、业绩口径都必须落在销售名下，
    // 否则销售配额大盘看不到这笔、待办错派给管理员
    const opportunityOwnerUserId = lead.owner_user_id;

    const opportunity = await tx.execute<{ id: string }>(sql`insert into opportunities
      (tenant_id, customer_id, owner_user_id, primary_contact_id, intended_product_id, intended_product, name, stage, expected_amount, expected_close_at, demand_note)
      values (
        ${ctx.tenantId},
        ${customerId},
        ${opportunityOwnerUserId},
        ${contactId},
        ${effectiveIntendedProductId ? sql`${effectiveIntendedProductId}::uuid` : null},
        ${effectiveIntendedProduct ?? null},
        ${input.opportunityName},
        'DISCOVERY',
        ${expectedAmount},
        ${expectedCloseAt},
        ${demandNote}
      ) returning id`);

    const opportunityId = opportunity.rows[0].id;

    if (input.lineItems && input.lineItems.length > 0) {
      for (const item of input.lineItems) {
        const subtotal = Math.round((item.unitPrice * item.quantity * item.discountRate) / 100);
        await tx.execute(sql`
          insert into public.opportunity_line_items (
            tenant_id,
            opportunity_id,
            product_id,
            quantity,
            unit_price,
            discount_rate,
            subtotal_amount,
            custom_notes,
            created_at,
            updated_at
          ) values (
            ${ctx.tenantId},
            ${opportunityId}::uuid,
            ${item.productId}::uuid,
            ${item.quantity},
            ${item.unitPrice},
            ${item.discountRate},
            ${subtotal},
            ${item.customNotes ?? null},
            now(),
            now()
          )
        `);
      }
    }

    await tx.execute(sql`insert into lead_conversions
      (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values (${ctx.tenantId}, ${lead.id}, ${customerId}, ${opportunityId}, ${ctx.userId})`);
    await tx.execute(sql`insert into opportunity_stage_history
      (tenant_id, opportunity_id, from_stage, to_stage, note, operator_user_id)
      values (${ctx.tenantId}, ${opportunityId}, null, 'DISCOVERY', '转化时创建首个商机', ${ctx.userId})`);
    await tx.execute(sql`update tasks set status = 'DONE', completed_at = now(), updated_at = now() where lead_id = ${lead.id} and status = 'OPEN'`);
    await tx.execute(sql`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
      values (${ctx.tenantId}, ${opportunityId}, ${opportunityOwnerUserId}, 'STAGE_PUSH', now() + interval '7 days')`);
    await audit(tx, ctx, "lead.convert", "lead", lead.id, {
      customerId,
      opportunityId,
      intendedProductId: effectiveIntendedProductId,
      intendedProduct: effectiveIntendedProduct,
      lineItemCount: input.lineItems?.length ?? 0,
    });
    await audit(tx, ctx, "customer.create_or_link", "customer", customerId, { leadId: lead.id });
    await audit(tx, ctx, "opportunity.create", "opportunity", opportunityId, {
      leadId: lead.id,
      intendedProductId: effectiveIntendedProductId,
      intendedProduct: effectiveIntendedProduct,
      lineItemCount: input.lineItems?.length ?? 0,
    });
    return { customerId, opportunityId, leadId: lead.id };
  });
  await refreshInsightsSafely(ctx, { type: "lead", id: result.leadId });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: result.opportunityId });
  return { customerId: result.customerId, opportunityId: result.opportunityId };
}

async function customerForWrite(tx: TenantTransaction, ctx: TenantContext, id: string) {
  const result = await tx.execute<{ id: string; owner_user_id: string }>(sql`select id, owner_user_id from customers where id = ${id} and deleted_at is null for update`);
  const row = result.rows[0];
  if (!row || !canSee(ctx, row.owner_user_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  return row;
}

export async function updateCustomerService(ctx: TenantContext, input: CustomerUpdateInput) {
  return withTenant(ctx.tenantId, async (tx) => {
    await customerForWrite(tx, ctx, input.customerId);
    await tx.execute(sql`update customers set name = coalesce(${input.name ?? null}, name),
      customer_type = case when ${input.customerType === undefined} then customer_type else ${input.customerType}::customer_type end,
      industry = case when ${input.industry === undefined} then industry else ${input.industry ?? null} end,
      region = case when ${input.region === undefined} then region else ${input.region ?? null} end,
      size = case when ${input.size === undefined} then size else ${input.size ?? null}::customer_size end, updated_at = now() where id = ${input.customerId}`);
    await audit(tx, ctx, "customer.update", "customer", input.customerId, input);
    return { customerId: input.customerId };
  });
}

export async function deleteCustomerService(ctx: TenantContext, customerId: string) {
  if (ctx.role === "SALES") throw new BusinessError("FORBIDDEN", "只有主管或管理员可以删除客户档案");
  return withTenant(ctx.tenantId, async (tx) => {
    await customerForWrite(tx, ctx, customerId);
    const active = await tx.execute(sql`select 1 from opportunities where customer_id = ${customerId} and deleted_at is null and stage not in ('WON', 'LOST') limit 1`);
    if (active.rows[0]) throw new BusinessError("INVALID_TRANSITION", "仍有进行中的商机，不能删除客户");
    await tx.execute(sql`update customers set deleted_at = now(), updated_at = now() where id = ${customerId}`);
    await tx.execute(sql`update contacts set deleted_at = now(), updated_at = now() where customer_id = ${customerId} and deleted_at is null`);
    // 取消该客户 tasks 里 OPEN 待办（置 CANCELLED）
    await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where tenant_id = ${ctx.tenantId} and status = 'OPEN' and (customer_id = ${customerId} or opportunity_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}))`);
    await audit(tx, ctx, "customer.delete", "customer", customerId);
    return { customerId };
  });
}

export async function addContactService(ctx: TenantContext, input: ContactCreateInput) {
  return withTenant(ctx.tenantId, async (tx) => {
    await customerForWrite(tx, ctx, input.customerId);
    if (input.isPrimary) {
      await tx.execute(sql`update contacts set is_primary = false, updated_at = now()
        where customer_id = ${input.customerId} and deleted_at is null`);
    }
    const inserted = await tx.execute<{ id: string }>(sql`insert into contacts (tenant_id, customer_id, name, phone, email, title, role_tag, is_primary)
      values (${ctx.tenantId}, ${input.customerId}, ${input.name}, ${input.phone}, ${input.email ?? null}, ${input.title ?? null}, ${input.roleTag ?? "OTHER"}::contact_role_tag, ${input.isPrimary ?? false}) returning id`);
    await audit(tx, ctx, "contact.create", "customer", input.customerId, { contactId: inserted.rows[0].id });
    return { contactId: inserted.rows[0].id };
  });
}

export async function updateContactService(ctx: TenantContext, input: ContactUpdateInput) {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ customer_id: string }>(sql`select customer_id from contacts c join customers cu on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
      where c.id = ${input.contactId} and c.deleted_at is null and cu.deleted_at is null for update`);
    const contact = result.rows[0];
    if (!contact) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    await customerForWrite(tx, ctx, contact.customer_id);
    await tx.execute(sql`update contacts set name = coalesce(${input.name ?? null}, name), phone = coalesce(${input.phone ?? null}, phone),
      email = case when ${input.email === undefined} then email else ${input.email ?? null} end,
      title = case when ${input.title === undefined} then title else ${input.title ?? null} end,
      role_tag = case when ${input.roleTag === undefined} then role_tag else ${input.roleTag}::contact_role_tag end,
      updated_at = now() where id = ${input.contactId}`);
    await audit(tx, ctx, "contact.update", "customer", contact.customer_id, { contactId: input.contactId });
    return { contactId: input.contactId };
  });
}

export async function deleteContactService(ctx: TenantContext, contactId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ customer_id: string; is_primary: boolean }>(sql`select customer_id, is_primary from contacts where id = ${contactId} and deleted_at is null for update`);
    const contact = result.rows[0];
    if (!contact) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    await customerForWrite(tx, ctx, contact.customer_id);
    const count = await tx.execute(sql`select count(*) from contacts where customer_id = ${contact.customer_id} and deleted_at is null`);
    if (contact.is_primary || Number(count.rows[0].count) <= 1) throw new BusinessError("INVALID_TRANSITION", "请先指定新的主联系人");
    await tx.execute(sql`update contacts set deleted_at = now(), updated_at = now() where id = ${contactId}`);
    await audit(tx, ctx, "contact.delete", "customer", contact.customer_id, { contactId });
    return { contactId };
  });
}

export async function setPrimaryContactService(ctx: TenantContext, customerId: string, contactId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    await customerForWrite(tx, ctx, customerId);
    const contact = await tx.execute(sql`select 1 from contacts where id = ${contactId} and customer_id = ${customerId} and deleted_at is null`);
    if (!contact.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    await tx.execute(sql`update contacts set is_primary = false, updated_at = now() where customer_id = ${customerId} and deleted_at is null`);
    await tx.execute(sql`update contacts set is_primary = true, updated_at = now() where id = ${contactId}`);
    await audit(tx, ctx, "contact.set_primary", "customer", customerId, { contactId });
    return { customerId, contactId };
  });
}

export async function getCustomerOperatingStatusService(ctx: TenantContext, customerId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await tx.execute<{ owner_user_id: string; progressing_stage: string | null; won_count: number; active_count: number; lost_count: number }>(sql`
      select c.owner_user_id,
        case max(case o.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 else 0 end)
          when 3 then 'NEGOTIATION' when 2 then 'PROPOSAL' when 1 then 'DISCOVERY' else null end as progressing_stage,
        count(*) filter (where o.stage = 'WON')::int as won_count, count(*) filter (where o.stage not in ('WON','LOST'))::int as active_count,
        count(*) filter (where o.stage = 'LOST')::int as lost_count from customers c left join opportunities o on o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null
      where c.id = ${customerId} and c.deleted_at is null group by c.owner_user_id`);
    const row = result.rows[0];
    if (!row || !canSee(ctx, row.owner_user_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    return { customerId, status: Number(row.active_count) > 0 ? "推进中" : Number(row.won_count) > 0 ? "已成交" : "待立项", progressingStage: row.progressing_stage };
  });
}

export async function listCustomersService(ctx: TenantContext, input: { search?: string; status?: CustomerStatus; sort?: CustomerSort; cursor?: string } = {}): Promise<CustomerList> {
  return withTenant(ctx.tenantId, async (tx) => {
    const search = input.search?.trim() ?? "";
    const status = input.status ?? "all";
    const sort = input.sort ?? "recent";
    let cursorValue: string | null = null;
    let cursorId: string | null = null;
    if (input.cursor) {
      try {
        const cursor = decodePoolCursor(input.cursor, sort);
        cursorValue = cursor.value;
        cursorId = cursor.id;
        if (cursorValue !== null && Number.isNaN(Date.parse(cursorValue))) throw new Error();
      } catch {
        throw new BusinessError("VALIDATION_ERROR", "分页游标无效", "cursor");
      }
    }

    const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
      select allow_multi_sales_followup from public.customer_collaboration_settings
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;

    const rows = await tx.execute<CustomerList["items"][number] & { _createdAt: string }>(sql`
      with customer_base as (
        select c.id, c.tenant_id, c.customer_type as "customerType", c.name, c.industry, c.region, c.size, c.owner_user_id,
          c.created_at, c.last_activity_at, coalesce(u.name, '公海/待分配') as owner_name
        from customers c left join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
        where c.tenant_id = ${ctx.tenantId} and c.deleted_at is null
          and (${ctx.role} <> 'SALES' or c.owner_user_id = ${ctx.userId}
            or (${allowMultiSalesFollowup} and exists (select 1 from opportunities o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.owner_user_id = ${ctx.userId} and o.deleted_at is null)))
          and (${search} = '' or c.name ilike ${`${search}%`}
            or exists (select 1 from contacts sc where sc.tenant_id = c.tenant_id and sc.customer_id = c.id and sc.deleted_at is null and (sc.name ilike ${`${search}%`} or sc.phone = ${search})))
          and (
            ${status} = 'all'
            or (${status} = 'active' and exists (select 1 from opportunities os where os.tenant_id = c.tenant_id and os.customer_id = c.id and os.deleted_at is null and os.stage not in ('WON','LOST')))
            or (${status} = 'no-active' and not exists (select 1 from opportunities os where os.tenant_id = c.tenant_id and os.customer_id = c.id and os.deleted_at is null and os.stage not in ('WON','LOST')))
            or (${status} = 'stalled' and exists (select 1 from tasks st where st.tenant_id = c.tenant_id and st.status = 'OPEN' and (st.customer_id = c.id or st.opportunity_id in (select so.id from opportunities so where so.tenant_id = c.tenant_id and so.customer_id = c.id and so.deleted_at is null)) and st.due_at < now()))
          )
          and (
            ${cursorValue}::timestamptz is null and ${sort} = 'recent' and (c.last_activity_at is null and c.id < ${cursorId}::uuid)
            or ${cursorValue}::timestamptz is not null and ${sort} = 'recent' and (c.last_activity_at is null or c.last_activity_at < ${cursorValue}::timestamptz or (c.last_activity_at = ${cursorValue}::timestamptz and c.id < ${cursorId}::uuid))
            or ${sort} = 'created' and (c.created_at < ${cursorValue}::timestamptz or (c.created_at = ${cursorValue}::timestamptz and c.id < ${cursorId}::uuid))
            or ${cursorValue}::timestamptz is null and ${cursorId}::uuid is null
          )
        order by case when ${sort} = 'recent' then c.last_activity_at end desc nulls last,
          case when ${sort} = 'created' then c.created_at end desc nulls last, c.id desc
        limit 51
      ), customer_summary as (
        select cb.*,
          (select count(*)::int from opportunities oc where oc.tenant_id = cb.tenant_id and oc.customer_id = cb.id and oc.deleted_at is null) as opportunity_count,
          (select count(*)::int from opportunities oc where oc.tenant_id = cb.tenant_id and oc.customer_id = cb.id and oc.deleted_at is null and oc.stage not in ('WON','LOST')) as active_opportunity_count,
          (select count(*)::int from opportunities oc where oc.tenant_id = cb.tenant_id and oc.customer_id = cb.id and oc.deleted_at is null and oc.stage = 'WON') as won_opportunity_count,
          (select oc.stage from opportunities oc where oc.tenant_id = cb.tenant_id and oc.customer_id = cb.id and oc.deleted_at is null and oc.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
            order by case oc.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 end desc, oc.created_at desc, oc.id desc limit 1) as progressing_stage,
          (select po.id from opportunities po where po.tenant_id = cb.tenant_id and po.customer_id = cb.id and po.deleted_at is null and po.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
            order by case po.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 end desc, po.created_at desc, po.id desc limit 1) as primary_opportunity_id,
          (select min(next_task.due_at)::text from (
            (select customer_task.due_at
              from tasks customer_task
              where customer_task.tenant_id = cb.tenant_id and customer_task.customer_id = cb.id and customer_task.status = 'OPEN'
              order by customer_task.due_at
              limit 1)
            union all
            (select opportunity_task.due_at
              from opportunities task_opportunity
              join tasks opportunity_task on opportunity_task.tenant_id = task_opportunity.tenant_id and opportunity_task.opportunity_id = task_opportunity.id
              where task_opportunity.tenant_id = cb.tenant_id and task_opportunity.customer_id = cb.id
                and task_opportunity.deleted_at is null and opportunity_task.status = 'OPEN'
              order by opportunity_task.due_at
              limit 1)
          ) next_task) as next_task_due_at,
          (select ct.name from contacts ct where ct.tenant_id = cb.tenant_id and ct.customer_id = cb.id and ct.deleted_at is null order by ct.is_primary desc, ct.created_at limit 1) as primary_contact_name,
          (select ct.phone from contacts ct where ct.tenant_id = cb.tenant_id and ct.customer_id = cb.id and ct.deleted_at is null order by ct.is_primary desc, ct.created_at limit 1) as primary_contact_phone
        from customer_base cb
      )
      select id, "customerType", name, industry, region, size, owner_name as "ownerName", owner_user_id as "ownerUserId", created_at::text as "_createdAt",
        opportunity_count as "opportunityCount", active_opportunity_count as "activeOpportunityCount", won_opportunity_count as "wonOpportunityCount",
        case when active_opportunity_count > 0 then '推进中' when won_opportunity_count > 0 then '已成交' else '待立项' end as "operatingStatus",
        progressing_stage as "progressingStage", primary_opportunity_id as "primaryOpportunityId", next_task_due_at as "nextTaskDueAt",
        primary_contact_name as "primaryContactName", primary_contact_phone as "primaryContactPhone", last_activity_at::text as "recentInteractionAt"
      from customer_summary
      order by case when ${sort} = 'recent' then last_activity_at end desc nulls last,
        case when ${sort} = 'created' then created_at end desc nulls last, id desc`);

    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;

    const items = rows.rows.slice(0, 50).map((row) => {
      const isOwner = (row as unknown as { ownerUserId: string | null }).ownerUserId === ctx.userId;
      const shouldMask = isPhoneMasking && ctx.role === "SALES" && !isOwner;
      return {
        ...row,
        primaryContactPhone: shouldMask ? maskPhone(row.primaryContactPhone) : row.primaryContactPhone,
      };
    });
    const last = items.at(-1);
    const nextCursor = rows.rows.length > 50 && last
      ? encodePoolCursor({ sort, value: sort === "recent" ? last.recentInteractionAt : last._createdAt, id: last.id })
      : null;
    return { items, nextCursor };
  });
}

export const CUSTOMER_DETAIL_COLLECTION_LIMIT = 100;

type DetailCursor = DetailCollectionCursor | null;

async function customerForRead(tx: TenantTransaction, ctx: TenantContext, customerId: string) {
  const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
    select allow_multi_sales_followup from public.customer_collaboration_settings
    where tenant_id = ${ctx.tenantId} limit 1
  `);
  const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;

  const result = await tx.execute<{ id: string }>(sql`select c.id from customers c
    where c.tenant_id = ${ctx.tenantId} and c.id = ${customerId} and c.deleted_at is null
      and (${ctx.role} <> 'SALES' or c.owner_user_id = ${ctx.userId}
        or (${allowMultiSalesFollowup} and exists (select 1 from opportunities o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.owner_user_id = ${ctx.userId} and o.deleted_at is null)))`);
  if (!result.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
}

function detailCollectionLimit(limit?: number) {
  if (limit === undefined) return CUSTOMER_DETAIL_COLLECTION_LIMIT;
  return Math.max(1, Math.min(limit, CUSTOMER_DETAIL_COLLECTION_LIMIT));
}

function detailCursor(collection: CustomerDetailCollection, cursor?: string | null): DetailCursor {
  if (!cursor) return null;
  try {
    return decodeDetailCollectionCursor(cursor, collection);
  } catch {
    throw new BusinessError("VALIDATION_ERROR", "分页游标无效", "cursor");
  }
}

async function getCustomerDetailCollectionPage<K extends CustomerDetailCollection>(
  tx: TenantTransaction,
  ctx: TenantContext,
  customerId: string,
  collection: K,
  input: { cursor?: string | null; limit?: number },
): Promise<CustomerDetailCollectionPage<K>> {
  const limit = detailCollectionLimit(input.limit);
  const boundedLimit = limit + 1;
  const cursor = detailCursor(collection, input.cursor);

  if (collection === "sourceLeadNames") {
    type SourceRow = CustomerDetailSourceLead & { _createdAt: string };
    const afterCursor = cursor
      ? sql`and (source.created_at > ${cursor.value}::timestamptz or (source.created_at = ${cursor.value}::timestamptz and source.lead_id > ${cursor.id}::uuid))`
      : sql``;
    const result = await tx.execute<SourceRow>(sql`
      with conversion_candidates as (
        select l.contact_name, l.contact_phone, l.company_name, l.title,
          coalesce(prod.name, l.intended_product) as intended_product,
          prod.category as intended_product_category,
          l.budget, l.note, l.source,
          l.status, lc.created_at as converted_at, lc.created_at as created_at, lc.lead_id, o.name as opportunity_name, o.id as opportunity_id, 1 as precedence
        from lead_conversions lc
        join leads l on l.tenant_id = lc.tenant_id and l.id = lc.lead_id
        left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
        left join opportunities o on o.tenant_id = lc.tenant_id and o.id = lc.opportunity_id
        where lc.tenant_id = ${ctx.tenantId} and lc.customer_id = ${customerId}
      ), legacy_customer_candidates as (
        select l.contact_name, l.contact_phone, l.company_name, l.title,
          coalesce(prod.name, l.intended_product) as intended_product,
          prod.category as intended_product_category,
          l.budget, l.note, l.source,
          l.status, l.created_at as converted_at, l.created_at, l.id as lead_id, null::text as opportunity_name, null::uuid as opportunity_id, 0 as precedence
        from leads l
        left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
        where l.tenant_id = ${ctx.tenantId} and l.customer_id = ${customerId}
          and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
      ), legacy_customer_origin_candidates as (
        select l.contact_name, l.contact_phone, l.company_name, l.title,
          coalesce(prod.name, l.intended_product) as intended_product,
          prod.category as intended_product_category,
          l.budget, l.note, l.source,
          l.status, l.created_at as converted_at, l.created_at, l.id as lead_id, null::text as opportunity_name, null::uuid as opportunity_id, 0 as precedence
        from customers legacy_customer
        join leads l on l.tenant_id = legacy_customer.tenant_id and l.id = legacy_customer.from_lead_id
        left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
        where legacy_customer.tenant_id = ${ctx.tenantId} and legacy_customer.id = ${customerId}
          and legacy_customer.from_lead_id is not null
          and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
      ), legacy_opportunity_origin_candidates as (
        select distinct on (l.id) l.contact_name, l.contact_phone, l.company_name, l.title,
          coalesce(prod.name, l.intended_product) as intended_product,
          prod.category as intended_product_category,
          l.budget, l.note, l.source,
          l.status, l.created_at as converted_at, l.created_at, l.id as lead_id, legacy_opportunity.name as opportunity_name, legacy_opportunity.id as opportunity_id, 0 as precedence
        from opportunities legacy_opportunity
        join leads l on l.tenant_id = legacy_opportunity.tenant_id and l.id = legacy_opportunity.from_lead_id
        left join products prod on prod.tenant_id = l.tenant_id and prod.id = l.intended_product_id and prod.deleted_at is null
        where legacy_opportunity.tenant_id = ${ctx.tenantId} and legacy_opportunity.customer_id = ${customerId}
          and legacy_opportunity.from_lead_id is not null
          and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
        order by l.id, l.created_at
      ), candidates as (
        select * from conversion_candidates
        union all select * from legacy_customer_candidates
        union all select * from legacy_customer_origin_candidates
        union all select * from legacy_opportunity_origin_candidates
      ), source as (
        select distinct on (candidate.lead_id)
          candidate.contact_name, candidate.contact_phone, candidate.company_name, candidate.title,
          candidate.intended_product, candidate.intended_product_category, candidate.budget, candidate.note, candidate.source,
          candidate.status, candidate.converted_at, candidate.created_at, candidate.lead_id, candidate.opportunity_name, candidate.opportunity_id
        from candidates candidate
        order by candidate.lead_id, candidate.precedence desc, candidate.created_at
      )
      select
        source.lead_id as id,
        source.contact_name as name,
        source.contact_phone as phone,
        source.company_name as "companyName",
        source.title,
        source.intended_product as "intendedProduct",
        source.intended_product_category as "intendedProductCategory",
        source.budget,
        source.note,
        source.source,
        source.status,
        source.created_at::text as "createdAt",
        source.converted_at::text as "convertedAt",
        source.opportunity_name as "opportunityName",
        source.opportunity_id as "opportunityId",
        source.created_at::text as "_createdAt"
      from source
      where true ${afterCursor}
      order by source.created_at, source.lead_id
      limit ${boundedLimit}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const custOwnerRes = await tx.execute<{ owner_user_id: string | null }>(sql`
      select owner_user_id from customers where tenant_id = ${ctx.tenantId} and id = ${customerId}
    `);
    const isOwner = custOwnerRes.rows[0]?.owner_user_id === ctx.userId;
    const shouldMask = isPhoneMasking && ctx.role === "SALES" && !isOwner;

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: shouldMask ? maskPhone(row.phone) : row.phone,
        companyName: row.companyName,
        title: row.title,
        intendedProduct: row.intendedProduct,
        intendedProductCategory: row.intendedProductCategory,
        budget: row.budget,
        note: row.note,
        source: row.source,
        status: row.status,
        createdAt: row.createdAt,
        convertedAt: row.convertedAt,
        opportunityName: row.opportunityName,
        opportunityId: row.opportunityId,
      })) as CustomerDetailCollectionPage<K>["items"],
      nextCursor: result.rows.length > limit && last
        ? encodeDetailCollectionCursor({ collection, value: last._createdAt, id: last.id })
        : null,
    };
  }

  if (collection === "contacts") {
    type ContactRow = CustomerDetailContact & { _createdAt: string };
    const afterCursor = cursor
      ? sql`and (
          (contacts.is_primary = false and ${cursor.isPrimary!} = true)
          or (contacts.is_primary = ${cursor.isPrimary!} and (
            contacts.created_at > ${cursor.value}::timestamptz
            or (contacts.created_at = ${cursor.value}::timestamptz and contacts.id > ${cursor.id}::uuid)
          ))
        )`
      : sql``;
    const result = await tx.execute<ContactRow>(sql`
      select id, name, phone, email, title, role_tag as "roleTag", is_primary as "isPrimary", created_at::text as "_createdAt"
      from contacts
      where tenant_id = ${ctx.tenantId} and customer_id = ${customerId} and deleted_at is null ${afterCursor}
      order by is_primary desc, created_at, id
      limit ${boundedLimit}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);

    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean; is_email_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled, is_email_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const isEmailMasking = secRes.rows[0]?.is_email_masking_enabled ?? false;
    const custOwnerRes = await tx.execute<{ owner_user_id: string | null }>(sql`
      select owner_user_id from customers where tenant_id = ${ctx.tenantId} and id = ${customerId}
    `);
    const isOwner = custOwnerRes.rows[0]?.owner_user_id === ctx.userId;
    const shouldMask = ctx.role === "SALES" && !isOwner;

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: (isPhoneMasking && shouldMask) ? maskPhone(row.phone) : row.phone,
        email: (isEmailMasking && shouldMask) ? maskEmail(row.email) : row.email,
        title: row.title,
        roleTag: row.roleTag ?? "OTHER",
        isPrimary: row.isPrimary,
      })) as CustomerDetailCollectionPage<K>["items"],
      nextCursor: result.rows.length > limit && last
        ? encodeDetailCollectionCursor({ collection, value: last._createdAt, id: last.id, isPrimary: last.isPrimary })
        : null,
    };
  }

  if (collection === "opportunities") {
    type OpportunityRow = CustomerDetailOpportunity & { _createdAt: string };
    const afterCursor = cursor
      ? sql`and (o.created_at < ${cursor.value}::timestamptz or (o.created_at = ${cursor.value}::timestamptz and o.id < ${cursor.id}::uuid))`
      : sql``;
    const result = await tx.execute<OpportunityRow>(sql`
      select o.id, o.name, o.stage, o.owner_user_id::text as "ownerUserId", coalesce(u.name, '销售') as "ownerName",
        coalesce(prod.name, o.intended_product) as "intendedProduct",
        o.expected_amount::text as "expectedAmount", o.expected_close_at::text as "expectedCloseAt",
        task.type as "openTaskType", task.due_at::text as "openTaskDueAt", o.created_at::text as "_createdAt"
      from opportunities o
      left join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      left join products prod on prod.tenant_id = o.tenant_id and prod.id = o.intended_product_id and prod.deleted_at is null
      left join lateral (
        select t.type, t.due_at
        from tasks t
        where t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
        order by t.due_at, t.id
        limit 1
      ) task on true
      where o.tenant_id = ${ctx.tenantId} and o.customer_id = ${customerId} and o.deleted_at is null ${afterCursor}
      order by o.created_at desc, o.id desc
      limit ${boundedLimit}`);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        stage: row.stage,
        ownerUserId: row.ownerUserId,
        ownerName: row.ownerName,
        intendedProduct: row.intendedProduct,
        expectedAmount: row.expectedAmount,
        expectedCloseAt: row.expectedCloseAt,
        openTaskType: row.openTaskType,
        openTaskDueAt: row.openTaskDueAt,
      })) as CustomerDetailCollectionPage<K>["items"],
      nextCursor: result.rows.length > limit && last
        ? encodeDetailCollectionCursor({ collection, value: last._createdAt, id: last.id })
        : null,
    };
  }

  type TaskRow = CustomerDetailOpenTask;
  const afterCursor = cursor
    ? sql`where task_source.due_at > ${cursor.value}::timestamptz or (task_source.due_at = ${cursor.value}::timestamptz and task_source.id > ${cursor.id}::uuid)`
    : sql``;
  const result = await tx.execute<TaskRow>(sql`
    with task_source as (
      select t.id, t.type, t.due_at, 'customer'::text as "subjectType"
      from tasks t
      where t.tenant_id = ${ctx.tenantId} and t.customer_id = ${customerId} and t.status = 'OPEN'
      union all
      select t.id, t.type, t.due_at, 'opportunity'::text as "subjectType"
      from tasks t
      join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
      where t.tenant_id = ${ctx.tenantId} and o.customer_id = ${customerId} and o.deleted_at is null and t.status = 'OPEN'
    )
    select id, type, due_at::text as "dueAt", "subjectType"
    from task_source
    ${afterCursor}
    order by due_at, id
    limit ${boundedLimit}`);
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows as CustomerDetailCollectionPage<K>["items"],
    nextCursor: result.rows.length > limit && last
      ? encodeDetailCollectionCursor({ collection, value: last.dueAt, id: last.id })
      : null,
  };
}

export async function getCustomerDetailCollectionService<K extends CustomerDetailCollection>(
  ctx: TenantContext,
  customerId: string,
  collection: K,
  input: { cursor?: string | null; limit?: number } = {},
): Promise<CustomerDetailCollectionPage<K>> {
  return withTenant(ctx.tenantId, async (tx) => {
    await customerForRead(tx, ctx, customerId);
    return getCustomerDetailCollectionPage(tx, ctx, customerId, collection, input);
  });
}

export async function getCustomerDetailService(ctx: TenantContext, customerId: string): Promise<CustomerDetail> {
  return withTenant(ctx.tenantId, async (tx) => {
    const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
      select allow_multi_sales_followup from public.customer_collaboration_settings
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;

    const customerResult = await tx.execute<CustomerDetail["customer"]>(sql`
      select c.id, c.owner_user_id as "ownerUserId", c.customer_type as "customerType", c.name, c.industry, c.region, c.size, coalesce(u.name, '公海/待分配') as "ownerName", c.created_at::text as "createdAt",
        count(distinct o.id)::int as "opportunityCount", count(distinct o.id) filter (where o.stage not in ('WON','LOST'))::int as "activeOpportunityCount", count(distinct o.id) filter (where o.stage = 'WON')::int as "wonOpportunityCount",
        case when count(distinct o.id) filter (where o.stage not in ('WON','LOST')) > 0 then '推进中' when count(distinct o.id) filter (where o.stage = 'WON') > 0 then '已成交' else '待立项' end as "operatingStatus",
        case max(case o.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 else 0 end) when 3 then 'NEGOTIATION' when 2 then 'PROPOSAL' when 1 then 'DISCOVERY' else null end as "progressingStage",
        (select po.id from opportunities po
          where po.tenant_id = c.tenant_id and po.customer_id = c.id and po.deleted_at is null
            and po.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
          order by case po.stage when 'NEGOTIATION' then 3 when 'PROPOSAL' then 2 when 'DISCOVERY' then 1 end desc, po.created_at desc, po.id desc
          limit 1) as "primaryOpportunityId",
        (select min(next_task.due_at)::text from (
          (select customer_task.due_at
            from tasks customer_task
            where customer_task.tenant_id = c.tenant_id and customer_task.customer_id = c.id and customer_task.status = 'OPEN'
            order by customer_task.due_at
            limit 1)
          union all
          (select opportunity_task.due_at
            from opportunities task_opportunity
            join tasks opportunity_task on opportunity_task.tenant_id = task_opportunity.tenant_id and opportunity_task.opportunity_id = task_opportunity.id
            where task_opportunity.tenant_id = c.tenant_id and task_opportunity.customer_id = c.id
              and task_opportunity.deleted_at is null and opportunity_task.status = 'OPEN'
            order by opportunity_task.due_at
            limit 1)
        ) next_task) as "nextTaskDueAt",
        (select ct.name from contacts ct where ct.tenant_id = c.tenant_id and ct.customer_id = c.id and ct.deleted_at is null order by ct.is_primary desc, ct.created_at limit 1) as "primaryContactName",
        (select ct.phone from contacts ct where ct.tenant_id = c.tenant_id and ct.customer_id = c.id and ct.deleted_at is null order by ct.is_primary desc, ct.created_at limit 1) as "primaryContactPhone",
        c.last_activity_at::text as "recentInteractionAt"
      from customers c left join users u on u.tenant_id = c.tenant_id and u.id = c.owner_user_id
      left join opportunities o on o.tenant_id = c.tenant_id and o.customer_id = c.id and o.deleted_at is null
      where c.tenant_id = ${ctx.tenantId} and c.id = ${customerId} and c.deleted_at is null
        and (${ctx.role} <> 'SALES' or c.owner_user_id = ${ctx.userId}
          or (${allowMultiSalesFollowup} and exists (select 1 from opportunities o2 where o2.tenant_id = c.tenant_id and o2.customer_id = c.id and o2.owner_user_id = ${ctx.userId} and o2.deleted_at is null)))
      group by c.id, c.owner_user_id, u.name`);
    const customer = customerResult.rows[0];
    if (!customer) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");

    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const isOwner = (customer as unknown as { ownerUserId: string | null }).ownerUserId === ctx.userId;
    const shouldMask = isPhoneMasking && ctx.role === "SALES" && !isOwner;
    if (shouldMask && customer.primaryContactPhone) {
      customer.primaryContactPhone = maskPhone(customer.primaryContactPhone);
    }
    const [sourceLeadNames, contacts, opportunities, openTasks, commerce] = await Promise.all([
      getCustomerDetailCollectionPage(tx, ctx, customerId, "sourceLeadNames", { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT }),
      getCustomerDetailCollectionPage(tx, ctx, customerId, "contacts", { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT }),
      getCustomerDetailCollectionPage(tx, ctx, customerId, "opportunities", { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT }),
      getCustomerDetailCollectionPage(tx, ctx, customerId, "openTasks", { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT }),
      getPluginFactsProvider().getCustomerCommerceFacts(tx, ctx.tenantId, customerId).catch(() => ({
        contracts: [],
        orders: [],
        projects: [],
      })),
    ]);
    return {
      customer: { ...customer, sourceLeadNames: sourceLeadNames.items.map((row) => row.name) },
      sourceLeads: sourceLeadNames.items,
      contacts: contacts.items,
      opportunities: opportunities.items,
      activities: [],
      openTasks: openTasks.items,
      commerce,
      truncation: {
        sourceLeadNames: { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT, hasMore: Boolean(sourceLeadNames.nextCursor), nextCursor: sourceLeadNames.nextCursor },
        contacts: { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT, hasMore: Boolean(contacts.nextCursor), nextCursor: contacts.nextCursor },
        opportunities: { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT, hasMore: Boolean(opportunities.nextCursor), nextCursor: opportunities.nextCursor },
        openTasks: { limit: CUSTOMER_DETAIL_COLLECTION_LIMIT, hasMore: Boolean(openTasks.nextCursor), nextCursor: openTasks.nextCursor },
      },
    };
  });
}

export async function getCustomerTimelineService(ctx: TenantContext, customerId: string, limit = 20): Promise<CustomerTimelinePage> {
  return withTenant(ctx.tenantId, async (tx) => {
    const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean }>(sql`
      select allow_multi_sales_followup from public.customer_collaboration_settings
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;

    const visible = await tx.execute<{ id: string }>(sql`select c.id from customers c
      where c.tenant_id = ${ctx.tenantId} and c.id = ${customerId} and c.deleted_at is null
        and (${ctx.role} <> 'SALES' or c.owner_user_id = ${ctx.userId}
          or (${allowMultiSalesFollowup} and exists (select 1 from opportunities o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.owner_user_id = ${ctx.userId} and o.deleted_at is null)))`);
    if (!visible.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    const total = Math.max(20, Math.min(Math.floor(limit), 100));
    const result = await tx.execute<CustomerTimelinePage["items"][number]>(sql`
      with customer_activity_events as (
        select a.id::text as id, a.type::text as type, a.outcome::text as outcome, a.summary, a.occurred_at, u.name as "userName"
        from activities a
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
        where a.tenant_id = ${ctx.tenantId} and a.customer_id = ${customerId}
        order by a.occurred_at desc, a.id desc
        limit ${total + 1}
      ), opportunity_activity_events as (
        select a.id::text as id, a.type::text as type, a.outcome::text as outcome, a.summary, a.occurred_at, u.name as "userName"
        from opportunities activity_opportunity
        join activities a on a.tenant_id = activity_opportunity.tenant_id and a.opportunity_id = activity_opportunity.id
        join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
        where activity_opportunity.tenant_id = ${ctx.tenantId} and activity_opportunity.customer_id = ${customerId}
        order by a.occurred_at desc, a.id desc
        limit ${total + 1}
      ), activity_events as (
        select * from customer_activity_events
        union all select * from opportunity_activity_events
      ), converted_lead_events as (
        select ('lead-created:' || l.id)::text as id, 'LEAD_CREATED' as type, null::text as outcome, '线索创建：' || l.contact_name as summary, l.created_at as occurred_at, u.name as "userName"
          from lead_conversions lc join leads l on l.tenant_id = lc.tenant_id and l.id = lc.lead_id
          join users u on u.tenant_id = l.tenant_id and u.id = coalesce(l.owner_user_id, lc.converted_by_user_id)
          where lc.tenant_id = ${ctx.tenantId} and lc.customer_id = ${customerId}
          order by l.created_at desc, l.id desc
          limit ${total + 1}
      ), converted_events as (
        select ('converted:' || lc.id)::text as id, 'CONVERTED' as type, null::text as outcome, '线索转为客户' as summary, lc.created_at as occurred_at, u.name as "userName"
          from lead_conversions lc join users u on u.tenant_id = lc.tenant_id and u.id = lc.converted_by_user_id
          where lc.tenant_id = ${ctx.tenantId} and lc.customer_id = ${customerId}
          order by lc.created_at desc, lc.id desc
          limit ${total + 1}
      ), legacy_customer_lead_candidates as (
        select l.id as lead_id, l.created_at
        from leads l
        where l.tenant_id = ${ctx.tenantId} and l.customer_id = ${customerId}
          and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
        order by l.created_at desc, l.id desc
        limit ${total + 1}
      ), legacy_customer_origin_lead_candidates as (
        select l.id as lead_id, l.created_at
        from customers legacy_customer
        join leads l on l.tenant_id = legacy_customer.tenant_id and l.id = legacy_customer.from_lead_id
        where legacy_customer.tenant_id = ${ctx.tenantId} and legacy_customer.id = ${customerId}
          and legacy_customer.from_lead_id is not null
          and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
        order by l.created_at desc, l.id desc
        limit ${total + 1}
      ), legacy_opportunity_origin_lead_candidates as (
        select candidate.lead_id, candidate.created_at
        from (
          select distinct on (l.id) l.id as lead_id, l.created_at
          from opportunities legacy_opportunity
          join leads l on l.tenant_id = legacy_opportunity.tenant_id and l.id = legacy_opportunity.from_lead_id
          where legacy_opportunity.tenant_id = ${ctx.tenantId} and legacy_opportunity.customer_id = ${customerId}
            and legacy_opportunity.from_lead_id is not null
            and not exists (select 1 from lead_conversions existing where existing.tenant_id = l.tenant_id and existing.lead_id = l.id)
          order by l.id, l.created_at desc
        ) candidate
        order by candidate.created_at desc, candidate.lead_id desc
        limit ${total + 1}
      ), legacy_lead_candidates as (
        select * from legacy_customer_lead_candidates
        union all select * from legacy_customer_origin_lead_candidates
        union all select * from legacy_opportunity_origin_lead_candidates
      ), legacy_lead_ids as (
        select distinct on (candidate.lead_id) candidate.lead_id, candidate.created_at
        from legacy_lead_candidates candidate
        order by candidate.lead_id, candidate.created_at desc
      ), legacy_lead_events as (
        select ('lead-created:' || l.id)::text as id, 'LEAD_CREATED' as type, null::text as outcome, '线索创建：' || l.contact_name as summary, l.created_at as occurred_at, u.name as "userName"
        from legacy_lead_ids legacy_lead
        join leads l on l.tenant_id = ${ctx.tenantId} and l.id = legacy_lead.lead_id
        join users u on u.tenant_id = l.tenant_id and u.id = l.owner_user_id
        order by l.created_at desc, l.id desc
        limit ${total + 1}
      ), legacy_converted_events as (
        select ('converted-legacy:' || l.id)::text as id, 'CONVERTED' as type, null::text as outcome, '线索转为客户' as summary, conversion_audit.created_at as occurred_at, u.name as "userName"
        from legacy_lead_ids legacy_lead
        join leads l on l.tenant_id = ${ctx.tenantId} and l.id = legacy_lead.lead_id
        join lateral (
          select al.actor_user_id, al.created_at
          from audit_logs al
          where al.tenant_id = l.tenant_id and al.action = 'lead.convert'
            and al.subject_type = 'lead' and al.subject_id = l.id
          order by al.created_at, al.id
          limit 1
        ) conversion_audit on true
        join users u on u.tenant_id = l.tenant_id and u.id = conversion_audit.actor_user_id
        order by conversion_audit.created_at desc, l.id desc
        limit ${total + 1}
      ), opportunity_created_events as (
        select ('opportunity-created:' || al.id)::text as id, 'OPPORTUNITY_CREATED' as type, null::text as outcome, '创建商机：' || o.name as summary, al.created_at as occurred_at, u.name as "userName"
          from audit_logs al join opportunities o on o.tenant_id = al.tenant_id and o.id = al.subject_id join users u on u.tenant_id = al.tenant_id and u.id = al.actor_user_id
          where al.tenant_id = ${ctx.tenantId} and al.action = 'opportunity.create' and al.subject_type = 'opportunity' and al.subject_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and customer_id = ${customerId})
          order by al.created_at desc, al.id desc
          limit ${total + 1}
      ), stage_events as (
        select ('stage:' || h.id)::text as id, case when h.to_stage = 'WON' then 'WON' when h.to_stage = 'LOST' then 'LOST' else 'STAGE_CHANGED' end as type, null::text as outcome, coalesce(h.note, '商机阶段变化：' || h.to_stage) as summary, h.created_at as occurred_at, u.name as "userName"
          from opportunity_stage_history h join users u on u.tenant_id = h.tenant_id and u.id = h.operator_user_id
          where h.tenant_id = ${ctx.tenantId} and h.opportunity_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and customer_id = ${customerId})
          order by h.created_at desc, h.id desc
          limit ${total + 1}
      ), events as (
        select * from activity_events
        union all select * from converted_lead_events
        union all select * from legacy_lead_events
        union all select * from converted_events
        union all select * from legacy_converted_events
        union all select * from opportunity_created_events
        union all select * from stage_events
      )
      select events.id, events.type, events.outcome, events.summary, events.occurred_at::text as "occurredAt", events."userName"
      from events
      order by events.occurred_at desc, events.id desc
      limit ${total + 1}`);
    return { items: result.rows.slice(0, total), nextLimit: nextTimelineLimit(total, result.rows.length > total) };
  });
}

export interface GlobalContactItem {
  id: string;
  customerId: string;
  customerName: string;
  customerType: string;
  customerOwnerUserId: string | null;
  customerOwnerUserName: string | null;
  inPublicPool: boolean;
  name: string;
  phone: string;
  email: string | null;
  title: string | null;
  roleTag: string;
  isPrimary: boolean;
  opportunityCount: number;
  createdAt: string;
  updatedAt: string;
}

export async function listGlobalContactsService(
  ctx: TenantContext,
  filter: {
    scope?: "MY" | "PUBLIC" | "ALL";
    roleTag?: string;
    search?: string;
  } = {},
): Promise<GlobalContactItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const scope = filter.scope ?? "ALL";
    const search = filter.search?.trim();

    const result = await tx.execute<{
      id: string;
      customer_id: string;
      customer_name: string;
      customer_type: string;
      customer_owner_user_id: string | null;
      customer_owner_user_name: string | null;
      name: string;
      phone: string;
      email: string | null;
      title: string | null;
      role_tag: string;
      is_primary: boolean;
      opportunity_count: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      select 
        c.id,
        c.customer_id,
        cu.name as customer_name,
        cu.customer_type,
        cu.owner_user_id as customer_owner_user_id,
        u.name as customer_owner_user_name,
        c.name,
        c.phone,
        c.email,
        c.title,
        c.role_tag,
        c.is_primary,
        (select count(o.id) from public.opportunities o where o.tenant_id = c.tenant_id and o.customer_id = cu.id and o.deleted_at is null) as opportunity_count,
        c.created_at,
        c.updated_at
      from public.contacts c
      join public.customers cu on cu.tenant_id = c.tenant_id and cu.id = c.customer_id
      left join public.users u on u.tenant_id = c.tenant_id and u.id = cu.owner_user_id
      where c.tenant_id = ${ctx.tenantId}
        and c.deleted_at is null
        and cu.deleted_at is null
        ${
          scope === "MY"
            ? sql`and cu.owner_user_id = ${ctx.userId}`
            : scope === "PUBLIC"
            ? sql`and cu.owner_user_id is null`
            : sql``
        }
        ${filter.roleTag && filter.roleTag !== "ALL" ? sql`and c.role_tag = ${filter.roleTag}::contact_role_tag` : sql``}
        ${
          search
            ? sql`and (
                c.name ilike ${`%${search}%`}
                or c.phone like ${`%${search}%`}
                or c.email ilike ${`%${search}%`}
                or c.title ilike ${`%${search}%`}
                or cu.name ilike ${`%${search}%`}
              )`
            : sql``
        }
      order by c.is_primary desc, c.updated_at desc
      limit 200
    `);

    const secRes = await tx.execute<{ is_phone_masking_enabled: boolean; is_email_masking_enabled: boolean }>(sql`
      select is_phone_masking_enabled, is_email_masking_enabled from security_compliance_configs
      where tenant_id = ${ctx.tenantId} limit 1
    `);
    const isPhoneMasking = secRes.rows[0]?.is_phone_masking_enabled ?? false;
    const isEmailMasking = secRes.rows[0]?.is_email_masking_enabled ?? false;

    return result.rows.map((r) => {
      const isOwner = r.customer_owner_user_id === ctx.userId;
      const shouldMask = ctx.role === "SALES" && !isOwner;

      return {
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerType: r.customer_type,
        customerOwnerUserId: r.customer_owner_user_id,
        customerOwnerUserName: r.customer_owner_user_name,
        inPublicPool: r.customer_owner_user_id === null,
        name: r.name,
        phone: (isPhoneMasking && shouldMask) ? maskPhone(r.phone) : r.phone,
        email: (isEmailMasking && shouldMask) ? maskEmail(r.email) : r.email,
        title: r.title,
        roleTag: r.role_tag,
        isPrimary: r.is_primary,
        opportunityCount: Number(r.opportunity_count || 0),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  });
}

/**
 * 检查客户名下是否有"跟进中的未成交商机"（owner 必填，不存在无主商机）。
 * 业务规则：在途商机代表仍有销售在该客户身上做生意，客户不能进公海
 * 也不能被认领（否则商机归属会跟着客户跑掉）；WON/LOST 商机是历史
 * 业绩记录，归属永不变化，不阻塞客户流转。
 */
async function findBlockingOpenOpportunities(
  tx: TenantTransaction,
  ctx: TenantContext,
  customerId: string,
): Promise<{ name: string; owner_name: string }[]> {
  const res = await tx.execute<{ name: string; owner_name: string }>(sql`
    select o.name, u.name as owner_name
    from public.opportunities o
    join public.users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
    where o.tenant_id = ${ctx.tenantId}
      and o.customer_id = ${customerId}
      and o.deleted_at is null
      and o.stage not in ('WON', 'LOST')
      and o.owner_user_id <> ${ctx.userId}
    limit 3
  `);
  return res.rows;
}

export async function claimCustomerService(ctx: TenantContext, customerId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{ id: string; owner_user_id: string | null; name: string }>(sql`
      select id, owner_user_id, name from public.customers
      where tenant_id = ${ctx.tenantId} and id = ${customerId} and deleted_at is null
      for update
    `);
    const customer = res.rows[0];
    if (!customer) throw new BusinessError("NOT_FOUND", "客户不存在或已被删除");
    if (customer.owner_user_id !== null) {
      throw new BusinessError("CONFLICT", "该客户已被其他销售人员领取进私海");
    }

    // 有他人跟进中的未成交商机 → 客户不可被认领（先完成商机转移或关单）。
    // 商机 owner 必填（无主商机不存在），公海客户正常不应有在途商机，
    // 此检查同时拦截历史遗留的脏数据
    const blockers = await findBlockingOpenOpportunities(tx, ctx, customerId);
    if (blockers.length > 0) {
      const first = blockers[0];
      throw new BusinessError(
        "CONFLICT",
        `该客户名下有销售「${first.owner_name}」跟进中的商机「${first.name}」，需先完成商机转移或关单后才能认领`,
      );
    }

    await tx.execute(sql`
      update public.customers
      set owner_user_id = ${ctx.userId}, claimed_at = now(), updated_at = now()
      where id = ${customerId}
    `);

    // 不划拨任何商机：在途商机有主（上面已拦截他人），WON/LOST 是历史
    // 业绩记录归属永不变；认领人自己名下的在途商机本就归他，无需动

    await audit(tx, ctx, "customer.claim", "customer", customerId, { name: customer.name });
    return { customerId, claimed: true };
  });
}

export async function releaseCustomerToPoolService(ctx: TenantContext, customerId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{ id: string; owner_user_id: string | null; name: string }>(sql`
      select id, owner_user_id, name from public.customers
      where tenant_id = ${ctx.tenantId} and id = ${customerId} and deleted_at is null
      for update
    `);
    const customer = res.rows[0];
    if (!customer) throw new BusinessError("NOT_FOUND", "客户不存在或已被删除");
    if (ctx.role === "SALES" && customer.owner_user_id !== ctx.userId) {
      throw new BusinessError("FORBIDDEN", "无权释放他人客户至公海");
    }

    // 对称规则：客户名下有任何跟进中的未成交商机 → 不可释放进公海。
    // 商机 owner 必填（不能置为无主），自己的在途商机同样阻止——
    // 要么先关单/赢单，要么把商机转移到接手人名下再释放客户。
    // WON/LOST 是历史业绩，归属永不变化，不阻塞释放
    const anyOpenRes = await tx.execute<{ name: string; owner_name: string }>(sql`
      select o.name, u.name as owner_name
      from public.opportunities o
      join public.users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      where o.tenant_id = ${ctx.tenantId}
        and o.customer_id = ${customerId}
        and o.deleted_at is null
        and o.stage not in ('WON', 'LOST')
      limit 3
    `);
    if (anyOpenRes.rows.length > 0) {
      const first = anyOpenRes.rows[0];
      throw new BusinessError(
        "CONFLICT",
        `该客户名下有跟进中的商机「${first.name}」（归属：${first.owner_name}），需先关单、赢单或转移商机后才能释放至公海`,
      );
    }

    await tx.execute(sql`
      update public.customers
      set owner_user_id = null, claimed_at = null, updated_at = now()
      where id = ${customerId}
    `);

    // 取消该客户 tasks 里 OPEN 待办（置 CANCELLED）
    await tx.execute(sql`update tasks set status = 'CANCELLED', updated_at = now() where tenant_id = ${ctx.tenantId} and status = 'OPEN' and (customer_id = ${customerId} or opportunity_id in (select id from opportunities where tenant_id = ${ctx.tenantId} and customer_id = ${customerId}))`);

    await audit(tx, ctx, "customer.release", "customer", customerId, { name: customer.name });
    return { customerId, released: true };
  });
}


