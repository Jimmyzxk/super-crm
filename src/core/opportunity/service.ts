import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import { decodePoolCursor, encodePoolCursor, nextTimelineLimit } from "@/core/shared/pagination";
import { sqlDate } from "@/core/shared/date";
import { refreshInsightsSafely } from "@/core/insight/service";
import { generateWinReviewSafely } from "@/core/win-review/service";
import { dispatchWorkplaceNotificationService } from "@/core/workplace/service";
import type { CreateOpportunityInput, OpportunityDetail, OpportunityFilter, OpportunityList, StageChangeInput, OpportunityStage } from "./types";

const stageOrder: OpportunityStage[] = ["DISCOVERY", "PROPOSAL", "NEGOTIATION"];
const stageDays: Record<string, number> = { DISCOVERY: 7, PROPOSAL: 14, NEGOTIATION: 14 };
const canSee = (ctx: TenantContext, ownerId: string) => ctx.role !== "SALES" || ctx.userId === ownerId;

function amountToBigint(value: number | undefined, field: string): bigint | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BusinessError("VALIDATION_ERROR", "金额必须是非负安全整数（单位：分）", field);
  }
  return BigInt(value);
}

async function assertProductInTenant(tx: TenantTransaction, ctx: TenantContext, productId: string | null | undefined, field = "intendedProductId") {
  if (!productId) return;
  const result = await tx.execute(sql`
    select id from public.products
    where tenant_id = ${ctx.tenantId} and id = ${productId}::uuid and deleted_at is null
  `);
  if (result.rows.length === 0) {
    throw new BusinessError("VALIDATION_ERROR", "指定的产品不存在或已被删除", field);
  }
}

async function audit(tx: TenantTransaction, ctx: TenantContext, action: string, id: string, detail: object = {}) {
  await tx.execute(sql`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
    values (${ctx.tenantId}, ${ctx.userId}, ${action}, 'opportunity', ${id}, ${JSON.stringify(detail)}::jsonb)`);
}

async function getOpportunityForWrite(tx: TenantTransaction, ctx: TenantContext, id: string) {
  const result = await tx.execute<{
    id: string;
    customer_id: string;
    owner_user_id: string;
    stage: OpportunityStage;
    stage_entered_at: string;
    expected_amount: string | null;
    expected_close_at: string | null;
    demand_note: string | null;
    intended_product_id: string | null;
    intended_product: string | null;
  }>(sql`
    select id, customer_id, owner_user_id, stage, stage_entered_at::text, expected_amount::text, expected_close_at::text, demand_note, intended_product_id::text, intended_product
    from opportunities where id = ${id} and deleted_at is null for update`);
  const row = result.rows[0];
  if (!row || !canSee(ctx, row.owner_user_id)) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
  return row;
}

async function addStageTask(tx: TenantTransaction, ctx: TenantContext, opportunityId: string, ownerId: string, stage: string) {
  const days = stageDays[stage];
  if (!days) return;
  await tx.execute(sql`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
    select ${ctx.tenantId}, o.id, ${ownerId}, 'STAGE_PUSH', o.stage_entered_at + (${days}::text || ' days')::interval
    from opportunities o where o.tenant_id = ${ctx.tenantId} and o.id = ${opportunityId}
      and o.stage = ${stage}::opportunity_stage`);
}

function assertAdjacent(from: OpportunityStage, to: OpportunityStage, direction: 1 | -1) {
  const fromIndex = stageOrder.indexOf(from);
  const toIndex = stageOrder.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || toIndex - fromIndex !== direction) {
    throw new BusinessError("INVALID_TRANSITION", "只能相邻推进或回退阶段");
  }
}

export async function createOpportunityService(ctx: TenantContext, input: CreateOpportunityInput) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const rawExpectedAmount = typeof input.expectedAmount === "string" && input.expectedAmount.trim() !== "" ? Number(input.expectedAmount) : (typeof input.expectedAmount === "number" ? input.expectedAmount : undefined);
    let expectedAmount = amountToBigint(rawExpectedAmount, "expectedAmount");
    const customer = await tx.execute<{ id: string; owner_user_id: string | null }>(
      sql`select id, owner_user_id from customers where id = ${input.customerId} and deleted_at is null for update`,
    );
    const customerRow = customer.rows[0];
    if (!customerRow || !customerRow.owner_user_id) {
      throw new BusinessError("NOT_FOUND", "客户不存在、处于未分配状态或已被删除");
    }

    // 1. 客户共享机制校验（系统设置默认关闭）
    const collabSettings = await tx.execute<{ allow_multi_sales_followup: boolean; require_product_exclusivity: boolean }>(sql`
      select allow_multi_sales_followup, require_product_exclusivity
      from public.customer_collaboration_settings
      where tenant_id = ${ctx.tenantId}
      limit 1
    `);
    const allowMultiSalesFollowup = collabSettings.rows[0]?.allow_multi_sales_followup ?? false;
    // 排他保护默认开启（与设置页口径一致，可由管理员显式关闭）
    const requireProductExclusivity = collabSettings.rows[0]?.require_product_exclusivity ?? true;

    const isCustomerOwner = customerRow.owner_user_id === ctx.userId;
    const isManagerOrAdmin = ctx.role === "MANAGER" || ctx.role === "ADMIN";

    if (!allowMultiSalesFollowup && !isCustomerOwner && !isManagerOrAdmin) {
      throw new BusinessError("NOT_FOUND", "客户不存在、处于未分配状态或当前用户无权操作");
    }

    if (input.primaryContactId) {
      const contact = await tx.execute(
        sql`select id from contacts where id = ${input.primaryContactId} and customer_id = ${input.customerId} and deleted_at is null`,
      );
      if (!contact.rows[0]) throw new BusinessError("NOT_FOUND", "主联系人不存在或不属于该客户");
    }

    // 2. 解析目标意向产品与产品清单
    const primaryLineItemProductId = input.lineItems?.[0]?.productId ?? null;
    const effectiveIntendedProductId = input.intendedProductId ?? primaryLineItemProductId;
    const effectiveIntendedProduct = input.intendedProduct ?? null;
    const lineItemProductIds = input.lineItems?.map((li) => li.productId) ?? [];

    // 校验指定产品属于当前租户且未被删除
    if (input.intendedProductId) {
      await assertProductInTenant(tx, ctx, input.intendedProductId, "intendedProductId");
    }
    if (input.lineItems && input.lineItems.length > 0) {
      for (const item of input.lineItems) {
        await assertProductInTenant(tx, ctx, item.productId, "lineItems.productId");
      }
    }

    // 3. 防撞单排他扫描：同客户同产品方向只允许一个销售新建/推进活跃商机
    // （管理员在设置页显式关闭排他保护后跳过，允许并行立项）
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
        and o.customer_id = ${input.customerId}
        and o.stage not in ('WON', 'LOST')
        and o.deleted_at is null
      group by o.id, o.name, o.owner_user_id, u.name, o.stage, o.intended_product_id, o.intended_product, p.name
    `);

    for (const existingOpp of existingActiveOpps.rows) {
      if (existingOpp.owner_user_id === ctx.userId) {
        // 自身已有的商机不视为与他人撞单
        continue;
      }

      let isCollision = false;
      let collisionProductLabel = "";

      // A. 指定了产品 ID
      if (effectiveIntendedProductId) {
        if (
          existingOpp.intended_product_id === effectiveIntendedProductId ||
          (existingOpp.line_item_product_ids && existingOpp.line_item_product_ids.includes(effectiveIntendedProductId))
        ) {
          isCollision = true;
          collisionProductLabel = existingOpp.intended_product_name || existingOpp.intended_product || "该产品";
        }
      }

      // B. 填写了意向产品名称文本
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

      // C. 选配了产品清单中的对应产品
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

      // D. 若双方均未指定具体产品（无产品通用商机）
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

    // 若配置了选配产品明细，计算总金额并优先采用产品报价核算
    let computedLineItemsTotal = 0;
    if (input.lineItems && input.lineItems.length > 0) {
      for (const item of input.lineItems) {
        const qty = item.quantity ?? 1;
        const disc = item.discountRate ?? 100;
        const subtotal = Math.round((item.unitPrice * qty * disc) / 100);
        computedLineItemsTotal += subtotal;
      }
      if (!expectedAmount || expectedAmount === BigInt(0)) {
        expectedAmount = BigInt(computedLineItemsTotal);
      }
    }

    // 4. 新商机负责人：销售立项归自己（跨产品线协同）；管理员/主管
    // 代操作时归客户负责人（一线销售）——管理员是编排者不是业绩
    // 承接人，否则销售配额大盘漏掉这笔、待办错派给管理员
    const opportunityOwnerUserId = ctx.role === "SALES" ? ctx.userId : customerRow.owner_user_id;

    const inserted = await tx.execute<{ id: string }>(sql`insert into opportunities
      (tenant_id, customer_id, owner_user_id, primary_contact_id, intended_product_id, intended_product, name, stage, expected_amount, expected_close_at, demand_note)
      values (
        ${ctx.tenantId},
        ${input.customerId},
        ${opportunityOwnerUserId},
        ${input.primaryContactId ?? null},
        ${effectiveIntendedProductId ? sql`${effectiveIntendedProductId}::uuid` : null},
        ${effectiveIntendedProduct ?? null},
        ${input.name},
        ${input.stage ?? "DISCOVERY"}::opportunity_stage,
        ${expectedAmount},
        ${input.expectedCloseAt ? sqlDate(input.expectedCloseAt) : null},
        ${input.demandNote ?? null}
      ) returning id`);
    const id = inserted.rows[0].id;

    // 批量原子化写入产品报价明细
    if (input.lineItems && input.lineItems.length > 0) {
      for (const item of input.lineItems) {
        const qty = item.quantity ?? 1;
        const disc = item.discountRate ?? 100;
        const subtotal = Math.round((item.unitPrice * qty * disc) / 100);
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
            ${id}::uuid,
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

    const effectiveStage = input.stage ?? "DISCOVERY";
    await tx.execute(sql`insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, operator_user_id)
      values (${ctx.tenantId}, ${id}, null, ${effectiveStage}::opportunity_stage, ${ctx.userId})`);
    await addStageTask(tx, ctx, id, opportunityOwnerUserId, effectiveStage);
    await audit(tx, ctx, "opportunity.create", id, {
      customerId: input.customerId,
      intendedProductId: effectiveIntendedProductId,
      intendedProduct: effectiveIntendedProduct,
      lineItemCount: input.lineItems?.length ?? 0,
    });
    return { opportunityId: id };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: result.opportunityId });
  return result;
}

async function changeStage(ctx: TenantContext, input: StageChangeInput, direction: 1 | -1) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    assertAdjacent(input.fromStage, input.toStage, direction);
    const opportunity = await getOpportunityForWrite(tx, ctx, input.opportunityId);
    if (opportunity.stage !== input.fromStage) throw new BusinessError("CONFLICT", "数据已被他人修改，请刷新后重试");
    const expectedAmount = amountToBigint(input.expectedAmount, "expectedAmount");
    const updated = await tx.execute(sql`update opportunities set stage = ${input.toStage}::opportunity_stage, stage_entered_at = now(),
      expected_amount = case when ${input.expectedAmount === undefined} then expected_amount else ${expectedAmount} end,
      expected_close_at = case when ${input.expectedCloseAt === undefined} then expected_close_at else ${input.expectedCloseAt ? sqlDate(input.expectedCloseAt) : null} end,
      updated_at = now() where id = ${input.opportunityId} and stage = ${input.fromStage}::opportunity_stage`);
    if (updated.rowCount !== 1) throw new BusinessError("CONFLICT", "数据已被他人修改，请刷新后重试");
    await tx.execute(sql`update tasks set status = 'DONE', completed_at = now(), updated_at = now()
      where opportunity_id = ${input.opportunityId} and status = 'OPEN'`);
    await addStageTask(tx, ctx, input.opportunityId, opportunity.owner_user_id, input.toStage);
    await tx.execute(sql`insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, note, operator_user_id)
      values (${ctx.tenantId}, ${input.opportunityId}, ${input.fromStage}::opportunity_stage, ${input.toStage}::opportunity_stage, ${input.note ?? null}, ${ctx.userId})`);

    await audit(tx, ctx, direction === 1 ? "opportunity.advance" : "opportunity.revert", input.opportunityId, { fromStage: input.fromStage, toStage: input.toStage });
    return { opportunityId: input.opportunityId, stage: input.toStage };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: input.opportunityId });
  return result;
}

export const advanceStageService = (ctx: TenantContext, input: StageChangeInput) => changeStage(ctx, input, 1);
export const revertStageService = (ctx: TenantContext, input: StageChangeInput) => changeStage(ctx, input, -1);

export async function winOpportunityService(ctx: TenantContext, input: { opportunityId: string; actualAmount: number; actualCloseAt?: Date; note?: string }) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const opportunity = await getOpportunityForWrite(tx, ctx, input.opportunityId);
    if (opportunity.stage !== "NEGOTIATION") throw new BusinessError("INVALID_TRANSITION", "只有商务谈判阶段可以赢单");
    const actualAmount = amountToBigint(input.actualAmount, "actualAmount");
    const actualCloseAtDate = input.actualCloseAt || new Date();
    const updated = await tx.execute(sql`update opportunities set stage = 'WON', stage_entered_at = now(), actual_amount = ${actualAmount}, actual_close_at = ${sqlDate(actualCloseAtDate)}, updated_at = now()
      where id = ${input.opportunityId} and stage = 'NEGOTIATION'`);
    if (updated.rowCount !== 1) throw new BusinessError("CONFLICT", "数据已被他人修改，请刷新后重试");
    await tx.execute(sql`update tasks set status = 'CANCELLED', completed_at = null, updated_at = now() where opportunity_id = ${input.opportunityId} and status = 'OPEN'`);
    await tx.execute(sql`insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, note, operator_user_id)
      values (${ctx.tenantId}, ${input.opportunityId}, 'NEGOTIATION', 'WON', ${input.note ?? null}, ${ctx.userId})`);

    // 赢单接力：为销售负责人创建【起草合同】待办任务与 DEAL_WON 通知
    const oppInfoRes = await tx.execute<{ name: string; customerId: string; customerName: string; ownerUserId: string }>(sql`
      select o.name, o.customer_id as "customerId", c.name as "customerName", o.owner_user_id as "ownerUserId"
      from opportunities o
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = ${ctx.tenantId} and o.id = ${input.opportunityId}
    `);
    const oppInfo = oppInfoRes.rows[0];

    if (oppInfo) {
      // 避免撞 tasks_open_customer_unique 唯一索引（每个客户仅允许一条 OPEN 待办）：
      // 若客户已有 OPEN 待办，复用并更新其到期时间、指派人与类型；若无则新建
      const existingTaskRes = await tx.execute<{ id: string }>(sql`
        select id from tasks
        where tenant_id = ${ctx.tenantId}
          and customer_id = ${oppInfo.customerId}
          and status = 'OPEN'
        limit 1
        for update
      `);

      if (existingTaskRes.rows.length > 0) {
        await tx.execute(sql`
          update tasks
          set
            assignee_user_id = ${oppInfo.ownerUserId},
            type = 'STAGE_PUSH'::task_type,
            due_at = now() + interval '3 days',
            updated_at = now()
          where id = ${existingTaskRes.rows[0].id}
        `);
      } else {
        await tx.execute(sql`
          insert into tasks (
            tenant_id, customer_id, assignee_user_id, type, due_at, status, created_at, updated_at
          ) values (
            ${ctx.tenantId}, ${oppInfo.customerId}, ${oppInfo.ownerUserId},
            'STAGE_PUSH'::task_type, now() + interval '3 days', 'OPEN', now(), now()
          )
        `);
      }

      const amountYuan = (Number(input.actualAmount) / 100).toFixed(2);
      await tx.execute(sql`
        insert into notifications (
          tenant_id, user_id, type, title, body, link, created_at
        ) values (
          ${ctx.tenantId}, ${oppInfo.ownerUserId}, 'DEAL_WON'::notification_type,
          ${`【商机赢单待办】请为客户【${oppInfo.customerName}】推进商务流程`},
          ${`商机【${oppInfo.name}】已成功赢单（成交金额 ¥${amountYuan}）！请在 3 个工作日内完成商务流程推进。`},
          ${`/opportunities/${input.opportunityId}`},
          now()
        )
      `);
    }

    await audit(tx, ctx, "opportunity.won", input.opportunityId, { actualAmount: String(input.actualAmount) });
    return { opportunityId: input.opportunityId, stage: "WON" as const, oppInfo, actualAmount: input.actualAmount };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: input.opportunityId });
  await generateWinReviewSafely(ctx, input.opportunityId);

  if (result.oppInfo) {
    const amountYuan = (Number(result.actualAmount) / 100).toFixed(2);
    dispatchWorkplaceNotificationService(ctx, {
      event: "DEAL_WON",
      title: "【商机赢单喜报】",
      markdownContent: `### 赢单喜报\n\n**客户**：${result.oppInfo.customerName}\n**商机**：${result.oppInfo.name}\n**成交金额**：¥${amountYuan}\n\n*请各部门注意配合后续交付工作！*`,
      data: { opportunityId: input.opportunityId },
    }).catch(console.error);
  }

  return { opportunityId: result.opportunityId, stage: result.stage };
}

export async function loseOpportunityService(ctx: TenantContext, input: { opportunityId: string; reason: string; note?: string }) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const opportunity = await getOpportunityForWrite(tx, ctx, input.opportunityId);
    if (!["DISCOVERY", "PROPOSAL", "NEGOTIATION"].includes(opportunity.stage)) throw new BusinessError("INVALID_TRANSITION", "终态商机不能再次变更");
    const updated = await tx.execute(sql`update opportunities set stage = 'LOST', stage_entered_at = now(), lost_reason = ${input.reason}::lost_reason, lost_note = ${input.note ?? null}, updated_at = now()
      where id = ${input.opportunityId} and stage not in ('WON', 'LOST')`);
    if (updated.rowCount !== 1) throw new BusinessError("CONFLICT", "数据已被他人修改，请刷新后重试");
    await tx.execute(sql`update tasks set status = 'CANCELLED', completed_at = null, updated_at = now() where opportunity_id = ${input.opportunityId} and status = 'OPEN'`);
    await tx.execute(sql`insert into opportunity_stage_history (tenant_id, opportunity_id, from_stage, to_stage, note, operator_user_id)
      values (${ctx.tenantId}, ${input.opportunityId}, ${opportunity.stage}::opportunity_stage, 'LOST', ${input.note ?? null}, ${ctx.userId})`);
    await audit(tx, ctx, "opportunity.lost", input.opportunityId, { reason: input.reason });
    return { opportunityId: input.opportunityId, stage: "LOST" as const };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: input.opportunityId });
  return result;
}

/**
 * 商机归属转移（管理员/主管专用纠错手段）。
 * 为什么需要：商机归属创建时写死=客户负责人，但实际经营中同一客户
 * 不同产品线可能由不同销售负责——分派错了、或产品线换人接手，
 * 没有转移能力就只能删库改数据。
 * 边界：
 * - 销售无权操作（归属调整是管理动作，与线索指派口径一致）
 * - WON/LOST 终态锁定：业绩已定案，转移=篡改业绩归属
 * - 客户归属不动（只动商机）；商机名下 OPEN 待办随之改派新负责人
 * - 同归属 no-op 幂等
 */
export async function transferOpportunityService(
  ctx: TenantContext,
  opportunityId: string,
  toOwnerUserId: string,
  options?: { reason?: string; note?: string },
) {
  if (ctx.role === "SALES") {
    throw new BusinessError("FORBIDDEN", "商机归属调整请联系主管或管理员操作");
  }
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const opportunity = await getOpportunityForWrite(tx, ctx, opportunityId);
    if (opportunity.stage === "WON" || opportunity.stage === "LOST") {
      throw new BusinessError("INVALID_TRANSITION", "已赢单/丢单的商机业绩归属已定案，不可转移");
    }
    const target = await tx.execute<{ id: string }>(sql`
      select id from users where tenant_id = ${ctx.tenantId} and id = ${toOwnerUserId} and status = 'ACTIVE'`);
    if (!target.rows[0]) throw new BusinessError("NOT_FOUND", "目标负责人不存在或已停用");
    if (opportunity.owner_user_id === toOwnerUserId) {
      return { opportunityId, fromOwnerUserId: opportunity.owner_user_id, toOwnerUserId };
    }
    await tx.execute(sql`update opportunities set owner_user_id = ${toOwnerUserId}, updated_at = now() where id = ${opportunityId}`);
    // 商机推进待办跟着人走：留在原负责人名下会误导其工作台
    await tx.execute(sql`update tasks set assignee_user_id = ${toOwnerUserId}, updated_at = now()
      where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId} and status = 'OPEN'`);
    await audit(tx, ctx, "opportunity.transfer", opportunityId, {
      fromOwnerUserId: opportunity.owner_user_id,
      toOwnerUserId,
      reason: options?.reason,
      note: options?.note,
    });
    return { opportunityId, fromOwnerUserId: opportunity.owner_user_id, toOwnerUserId };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: opportunityId });
  return result;
}

export async function updateOpportunityService(ctx: TenantContext, input: { opportunityId: string; name?: string; primaryContactId?: string; intendedProductId?: string | null; intendedProduct?: string | null; expectedAmount?: number; expectedCloseAt?: Date; demandNote?: string }) {
  const result = await withTenant(ctx.tenantId, async (tx) => {
    const expectedAmount = amountToBigint(input.expectedAmount, "expectedAmount");
    const opportunity = await getOpportunityForWrite(tx, ctx, input.opportunityId);
    if (opportunity.stage === "WON" || opportunity.stage === "LOST") {
      throw new BusinessError("INVALID_TRANSITION", "终态商机不能编辑");
    }
    if (input.primaryContactId) {
      const contact = await tx.execute(sql`select 1 from contacts where id = ${input.primaryContactId} and customer_id = ${opportunity.customer_id} and deleted_at is null`);
      if (!contact.rows[0]) throw new BusinessError("NOT_FOUND", "主联系人不存在或不属于该客户");
    }
    if (input.intendedProductId) {
      await assertProductInTenant(tx, ctx, input.intendedProductId, "intendedProductId");
    }

    // 意向产品排他防撞单校验
    if (input.intendedProductId !== undefined || input.intendedProduct !== undefined) {
      const collabRes = await tx.execute<{ require_product_exclusivity: boolean }>(sql`
        select require_product_exclusivity
        from public.customer_collaboration_settings
        where tenant_id = ${ctx.tenantId}
        limit 1
      `);
      const requireProductExclusivity = collabRes.rows[0]?.require_product_exclusivity ?? true;
      if (requireProductExclusivity) {
        const targetProdId = input.intendedProductId !== undefined ? input.intendedProductId : opportunity.intended_product_id;
        const targetProdName = input.intendedProduct !== undefined ? input.intendedProduct : opportunity.intended_product;
        if (targetProdId || targetProdName) {
          const conflictRes = await tx.execute<{ id: string; name: string; owner_name: string }>(sql`
            select o.id, o.name, coalesce(u.name, '其他销售') as owner_name
            from public.opportunities o
            left join public.users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
            where o.tenant_id = ${ctx.tenantId}
              and o.customer_id = ${opportunity.customer_id}
              and o.id <> ${input.opportunityId}
              and o.stage in ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION')
              and o.deleted_at is null
              and (
                (${targetProdId ? sql`o.intended_product_id = ${targetProdId}::uuid` : sql`false`})
                or (${targetProdName ? sql`o.intended_product = ${targetProdName}` : sql`false`})
              )
            limit 1
          `);
          if (conflictRes.rows[0]) {
            throw new BusinessError(
              "CONFLICT",
              `撞单拦截：该客户名下已有活跃商机「${conflictRes.rows[0].name}」（负责人：${conflictRes.rows[0].owner_name}）在跟进相同产品，禁止跨销售重复立项或变更`,
              "intendedProductId",
            );
          }
        }
      }
    }
    await tx.execute(sql`update opportunities set
      name = coalesce(${input.name ?? null}, name),
      primary_contact_id = coalesce(${input.primaryContactId ?? null}, primary_contact_id),
      intended_product_id = case when ${input.intendedProductId === undefined} then intended_product_id else ${input.intendedProductId ? sql`${input.intendedProductId}::uuid` : null} end,
      intended_product = case when ${input.intendedProduct === undefined} then intended_product else ${input.intendedProduct ?? null} end,
      expected_amount = case when ${input.expectedAmount === undefined} then expected_amount else ${expectedAmount} end,
      expected_close_at = case when ${input.expectedCloseAt === undefined} then expected_close_at else ${input.expectedCloseAt ? sqlDate(input.expectedCloseAt) : null} end,
      demand_note = case when ${input.demandNote === undefined} then demand_note else ${input.demandNote ?? null} end,
      updated_at = now()
      where id = ${input.opportunityId}`);
    await audit(tx, ctx, "opportunity.update", input.opportunityId);
    return { opportunityId: input.opportunityId };
  });
  await refreshInsightsSafely(ctx, { type: "opportunity", id: result.opportunityId });
  return result;
}

export async function listOpportunitiesService(ctx: TenantContext, input: { filter?: OpportunityFilter; search?: string; cursor?: string; ownerUserId?: string; stage?: string; minAmountCents?: number; stalledDaysMin?: number } = {}): Promise<OpportunityList> {
  return withTenant(ctx.tenantId, async (tx) => {
    const filter = input.filter ?? "active";
    const search = input.search?.trim() ?? "";
    let cursorPriority: number | null = null;
    let cursorClose: string | null = null;
    let cursorUpdated: string | null = null;
    let cursorId: string | null = null;
    if (input.cursor) {
      try {
        const cursor = decodePoolCursor(input.cursor, filter);
        const value = JSON.parse(cursor.value ?? "") as { priority?: number; close?: string | null; updated?: string };
        if (![0, 1].includes(value.priority ?? -1) || typeof value.updated !== "string" || !value.updated
          || Number.isNaN(Date.parse(value.updated)) || (value.close !== undefined && value.close !== null && (typeof value.close !== "string" || Number.isNaN(Date.parse(value.close))))) throw new Error();
        cursorPriority = value.priority!;
        cursorClose = value.close ?? null;
        cursorUpdated = value.updated;
        cursorId = cursor.id;
      } catch {
        throw new BusinessError("VALIDATION_ERROR", "分页游标无效", "cursor");
      }
    }
    const ownerFilterSql = input.ownerUserId ? sql`and o.owner_user_id = ${input.ownerUserId}::uuid` : sql``;
    const stageFilterSql = input.stage ? sql`and o.stage = ${input.stage}::opportunity_stage` : sql``;
    const minAmountFilterSql = typeof input.minAmountCents === "number" ? sql`and coalesce(o.expected_amount, 0) >= ${input.minAmountCents}` : sql``;
    const stalledDaysFilterSql = typeof input.stalledDaysMin === "number" ? sql`and (now() - coalesce(o.stage_entered_at, o.updated_at)) >= make_interval(days => ${input.stalledDaysMin})` : sql``;
    const useActivePoolPath = search === "" && (filter === "active" || filter === "stalled") && !input.ownerUserId && !input.stage && typeof input.minAmountCents !== "number" && typeof input.stalledDaysMin !== "number";
    const rows = useActivePoolPath
      ? await tx.execute<OpportunityList["items"][number] & { _updatedAt: string; _priority: number }>(sql`
      with candidates as (
        (
          select o.id, o.name, o.stage, o.customer_id as "customerId", c.name as "customerName", u.name as "ownerName",
            o.owner_user_id::text as "ownerUserId", co.name as "customerOwnerName",
            o.intended_product_id::text as "intendedProductId", coalesce(p.name, o.intended_product) as "intendedProduct",
            p.category as "intendedProductCategory",
            o.expected_amount::text as "expectedAmount", o.expected_close_at::text as "expectedCloseAt",
            o.stage_entered_at::text as "stageEnteredAt", o.updated_at::text as "_updatedAt", 0 as "_priority",
            pc.name as "primaryContactName", t.id as "openTaskId", t.type as "openTaskType",
            t.due_at::text as "openTaskDueAt", true as "isStalled"
          from tasks t
          join opportunities o on o.tenant_id = t.tenant_id and o.id = t.opportunity_id
          join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
          join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
          left join users co on co.tenant_id = c.tenant_id and co.id = c.owner_user_id
          left join products p on p.tenant_id = o.tenant_id and p.id = o.intended_product_id and p.deleted_at is null
          left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
          where t.tenant_id = ${ctx.tenantId} and t.status = 'OPEN' and t.opportunity_id is not null and t.due_at < now()
            and o.deleted_at is null and o.stage not in ('WON', 'LOST')
            and (${ctx.role} <> 'SALES' or o.owner_user_id = ${ctx.userId})
            ${ownerFilterSql}
            ${stageFilterSql}
            ${minAmountFilterSql}
            ${stalledDaysFilterSql}
            and (${cursorPriority}::int is null or (${cursorPriority} = 0 and (
              (${cursorClose}::date is null and o.expected_close_at is null and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))
              or (${cursorClose}::date is not null and (o.expected_close_at is null or o.expected_close_at > ${cursorClose}::date or (o.expected_close_at = ${cursorClose}::date and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))))
            )))
          order by o.expected_close_at nulls last, o.updated_at desc, o.id desc
          limit 51
        )
        union all
        (
          select o.id, o.name, o.stage, o.customer_id as "customerId", c.name as "customerName", u.name as "ownerName",
            o.owner_user_id::text as "ownerUserId", co.name as "customerOwnerName",
            o.intended_product_id::text as "intendedProductId", coalesce(p.name, o.intended_product) as "intendedProduct",
            p.category as "intendedProductCategory",
            o.expected_amount::text as "expectedAmount", o.expected_close_at::text as "expectedCloseAt",
            o.stage_entered_at::text as "stageEnteredAt", o.updated_at::text as "_updatedAt", 1 as "_priority",
            pc.name as "primaryContactName", t.id as "openTaskId", t.type as "openTaskType",
            t.due_at::text as "openTaskDueAt", false as "isStalled"
          from (
            select o.id, o.tenant_id, o.customer_id, o.owner_user_id, o.primary_contact_id, o.intended_product_id, o.intended_product, o.name, o.stage,
              o.expected_amount, o.expected_close_at, o.stage_entered_at, o.updated_at
            from opportunities o
            where ${filter} = 'active' and o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and o.stage not in ('WON', 'LOST')
              and (${ctx.role} <> 'SALES' or o.owner_user_id = ${ctx.userId})
              ${ownerFilterSql}
              ${stageFilterSql}
              ${minAmountFilterSql}
              ${stalledDaysFilterSql}
              and not exists (
                select 1 from tasks overdue_task
                where overdue_task.tenant_id = o.tenant_id and overdue_task.opportunity_id = o.id
                  and overdue_task.status = 'OPEN' and overdue_task.due_at < now()
              )
              and (
              ${cursorPriority}::int is null or ${cursorPriority} = 0 or (${cursorPriority} = 1 and (
                (${cursorClose}::date is null and o.expected_close_at is null and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))
                or (${cursorClose}::date is not null and (o.expected_close_at is null or o.expected_close_at > ${cursorClose}::date or (o.expected_close_at = ${cursorClose}::date and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))))
              ))
              )
            order by o.expected_close_at nulls last, o.updated_at desc, o.id desc
            limit 51
          ) o
          join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
          join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
          left join users co on co.tenant_id = c.tenant_id and co.id = c.owner_user_id
          left join products p on p.tenant_id = o.tenant_id and p.id = o.intended_product_id and p.deleted_at is null
          left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
          left join tasks t on t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
        )
      )
      select * from candidates
      order by "_priority", "expectedCloseAt" nulls last, "_updatedAt" desc, id desc
      limit 51`)
      : await tx.execute<OpportunityList["items"][number] & { _updatedAt: string; _priority: number }>(sql`
      select o.id, o.name, o.stage, o.customer_id as "customerId", c.name as "customerName", u.name as "ownerName",
        o.owner_user_id::text as "ownerUserId", co.name as "customerOwnerName",
        o.intended_product_id::text as "intendedProductId", coalesce(p.name, o.intended_product) as "intendedProduct",
        p.category as "intendedProductCategory",
        o.expected_amount::text as "expectedAmount", o.expected_close_at::text as "expectedCloseAt", o.stage_entered_at::text as "stageEnteredAt",
        o.updated_at::text as "_updatedAt", case when t.due_at < now() then 0 else 1 end as "_priority",
        pc.name as "primaryContactName", t.id as "openTaskId", t.type as "openTaskType", t.due_at::text as "openTaskDueAt", (t.due_at < now()) as "isStalled"
      from opportunities o
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      left join users co on co.tenant_id = c.tenant_id and co.id = c.owner_user_id
      left join products p on p.tenant_id = o.tenant_id and p.id = o.intended_product_id and p.deleted_at is null
      left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
      left join tasks t on t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
      where o.tenant_id = ${ctx.tenantId} and o.deleted_at is null and (${ctx.role} <> 'SALES' or o.owner_user_id = ${ctx.userId}) and (${search} = '' or o.name ilike ${`%${search}%`} or c.name ilike ${`%${search}%`})
        ${ownerFilterSql}
        ${stageFilterSql}
        ${minAmountFilterSql}
        ${stalledDaysFilterSql}
        and ((${filter} = 'active' and o.stage not in ('WON','LOST')) or (${filter} = 'stalled' and o.stage not in ('WON','LOST') and t.due_at < now()) or (${filter} = 'month' and o.expected_close_at >= (date_trunc('month', now() at time zone 'Asia/Shanghai'))::date and o.expected_close_at < ((date_trunc('month', now() at time zone 'Asia/Shanghai'))::date + interval '1 month')::date) or (${filter} = 'won' and o.stage = 'WON') or (${filter} = 'lost' and o.stage = 'LOST'))
        and (
          ${cursorPriority}::int is null
          or (case when t.due_at < now() then 0 else 1 end) > ${cursorPriority}
          or (case when t.due_at < now() then 0 else 1 end) = ${cursorPriority} and (
            (${cursorClose}::date is null and o.expected_close_at is null and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))
            or (${cursorClose}::date is not null and (o.expected_close_at is null or o.expected_close_at > ${cursorClose}::date or (o.expected_close_at = ${cursorClose}::date and (o.updated_at, o.id) < (${cursorUpdated}::timestamptz, ${cursorId}::uuid))))
          )
        )
      order by case when t.due_at < now() then 0 else 1 end, o.expected_close_at nulls last, o.updated_at desc, o.id desc limit 51`);
    const items = rows.rows.slice(0, 50);
    const last = items.at(-1);
    const nextCursor = rows.rows.length > 50 && last
      ? encodePoolCursor({ sort: filter, value: JSON.stringify({ priority: last._priority, close: last.expectedCloseAt, updated: last._updatedAt }), id: last.id })
      : null;
    return { items, nextCursor };
  });
}

export async function getOpportunityDetailService(ctx: TenantContext, opportunityId: string): Promise<OpportunityDetail> {
  return withTenant(ctx.tenantId, async (tx) => {
    const opportunityResult = await tx.execute<OpportunityDetail["opportunity"]>(sql`
      select o.id, o.name, o.stage, o.customer_id as "customerId", c.name as "customerName", u.name as "ownerName",
        o.owner_user_id::text as "ownerUserId", co.name as "customerOwnerName",
        o.intended_product_id::text as "intendedProductId", coalesce(p.name, o.intended_product) as "intendedProduct",
        p.category as "intendedProductCategory",
        o.expected_amount::text as "expectedAmount", o.expected_close_at::text as "expectedCloseAt", o.stage_entered_at::text as "stageEnteredAt",
        pc.name as "primaryContactName", pc.id as "primaryContactId", pc.phone as "contactPhone", pc.title as "contactTitle",
        o.demand_note as "demandNote", o.actual_amount::text as "actualAmount", o.actual_close_at::text as "actualCloseAt",
        o.lost_reason as "lostReason", o.lost_note as "lostNote", t.id as "openTaskId", t.type as "openTaskType",
        t.due_at::text as "openTaskDueAt", (t.due_at < now()) as "isStalled",
        (
          select json_build_object('id', l.id::text, 'name', l.contact_name, 'phone', l.contact_phone, 'convertedAt', lc.created_at::text)
          from public.lead_conversions lc
          join public.leads l on l.tenant_id = lc.tenant_id and l.id = lc.lead_id
          where lc.tenant_id = o.tenant_id and lc.opportunity_id = o.id
          limit 1
        ) as "sourceLead"
      from opportunities o
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join users u on u.tenant_id = o.tenant_id and u.id = o.owner_user_id
      left join users co on co.tenant_id = c.tenant_id and co.id = c.owner_user_id
      left join products p on p.tenant_id = o.tenant_id and p.id = o.intended_product_id and p.deleted_at is null
      left join contacts pc on pc.tenant_id = o.tenant_id and pc.id = o.primary_contact_id
      left join tasks t on t.tenant_id = o.tenant_id and t.opportunity_id = o.id and t.status = 'OPEN'
      where o.tenant_id = ${ctx.tenantId} and o.id = ${opportunityId} and o.deleted_at is null and (${ctx.role} <> 'SALES' or o.owner_user_id = ${ctx.userId})`);
    const opportunity = opportunityResult.rows[0];
    if (!opportunity) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    return { opportunity, stageHistory: [], activities: [], openTask: opportunity.openTaskId ? { id: opportunity.openTaskId, type: opportunity.openTaskType!, dueAt: opportunity.openTaskDueAt! } : null };
  });
}

export async function getOpportunityTimelineService(ctx: TenantContext, opportunityId: string, limit = 20): Promise<Pick<OpportunityDetail, "stageHistory" | "activities"> & { nextLimit: number | null }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const visible = await tx.execute<{ id: string }>(sql`select id from opportunities where tenant_id = ${ctx.tenantId} and id = ${opportunityId} and deleted_at is null and (${ctx.role} <> 'SALES' or owner_user_id = ${ctx.userId})`);
    if (!visible.rows[0]) throw new BusinessError("NOT_FOUND", "内容不存在或已被删除");
    const total = Math.max(20, Math.min(Math.floor(limit), 100));
    const [stageHistory, activities] = await Promise.all([
      tx.execute<OpportunityDetail["stageHistory"][number]>(sql`select h.id::text as id, h.from_stage as "fromStage", h.to_stage as "toStage", h.note, coalesce(u.name, '历史成员') as "operatorName", h.created_at::text as "createdAt" from opportunity_stage_history h left join users u on u.tenant_id = h.tenant_id and u.id = h.operator_user_id where h.tenant_id = ${ctx.tenantId} and h.opportunity_id = ${opportunityId} order by h.created_at desc limit ${total + 1}`),
      tx.execute<OpportunityDetail["activities"][number]>(sql`select a.id, a.type, a.outcome, a.summary, a.occurred_at::text as "occurredAt", coalesce(u.name, '历史成员') as "userName" from activities a left join users u on u.tenant_id = a.tenant_id and u.id = a.user_id where a.tenant_id = ${ctx.tenantId} and a.opportunity_id = ${opportunityId} order by a.occurred_at desc, a.created_at desc limit ${total + 1}`),
    ]);
    const hasMore = stageHistory.rows.length > total || activities.rows.length > total;
    return { stageHistory: stageHistory.rows.slice(0, total), activities: activities.rows.slice(0, total), nextLimit: nextTimelineLimit(total, hasMore) };
  });
}
