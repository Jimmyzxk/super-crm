import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import type {
  CreateProductInput,
  OpportunityLineItem,
  ProductCategorySummary,
  ProductItem,
  ProductStatus,
  SaveLineItemInput,
  UpdateProductInput,
} from "./types";

export async function listProductsService(
  ctx: TenantContext,
  params?: { category?: string; status?: ProductStatus; search?: string },
): Promise<ProductItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    let whereClause = sql`p.tenant_id = ${ctx.tenantId} and p.deleted_at is null`;

    if (params?.category) {
      whereClause = sql`${whereClause} and p.category = ${params.category}`;
    }
    if (params?.status) {
      whereClause = sql`${whereClause} and p.status = ${params.status}`;
    }
    if (params?.search && params.search.trim()) {
      const q = `%${params.search.trim()}%`;
      whereClause = sql`${whereClause} and (p.name ilike ${q} or p.code ilike ${q} or p.category ilike ${q})`;
    }

    const res = await tx.execute<{
      id: string;
      code: string;
      name: string;
      category: string;
      pricing_model: ProductItem["pricingModel"];
      unit_price: number;
      unit: string;
      description: string | null;
      status: ProductStatus;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        p.id,
        p.code,
        p.name,
        p.category,
        p.pricing_model,
        p.unit_price,
        p.unit,
        p.description,
        p.status,
        p.created_at::text as created_at,
        p.updated_at::text as updated_at
      from products p
      where ${whereClause}
      order by p.category asc, p.created_at desc
    `);

    return res.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      pricingModel: r.pricing_model,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function listProductCategoriesService(ctx: TenantContext): Promise<ProductCategorySummary[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{ category: string; product_count: string; active_count: string }>(sql`
      select
        p.category,
        count(*)::text as product_count,
        count(*) filter (where p.status = 'ACTIVE')::text as active_count
      from products p
      where p.tenant_id = ${ctx.tenantId} and p.deleted_at is null
      group by p.category
      order by p.category asc
    `);

    return res.rows.map((r) => ({
      category: r.category,
      productCount: Number(r.product_count),
      activeCount: Number(r.active_count),
    }));
  });
}

export async function getProductByIdService(ctx: TenantContext, id: string): Promise<ProductItem | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      code: string;
      name: string;
      category: string;
      pricing_model: ProductItem["pricingModel"];
      unit_price: number;
      unit: string;
      description: string | null;
      status: ProductStatus;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        p.id,
        p.code,
        p.name,
        p.category,
        p.pricing_model,
        p.unit_price,
        p.unit,
        p.description,
        p.status,
        p.created_at::text as created_at,
        p.updated_at::text as updated_at
      from products p
      where p.tenant_id = ${ctx.tenantId} and p.id = ${id} and p.deleted_at is null
      limit 1
    `);

    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      pricingModel: r.pricing_model,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function createProductService(
  ctx: TenantContext,
  input: CreateProductInput,
): Promise<ProductItem> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const category = input.category.trim() || "未分类";
  const unit = input.unit.trim() || "套";
  const unitPrice = Math.max(0, Math.floor(input.unitPrice));
  const desc = input.description?.trim() || null;

  if (!code || code.length > 50) {
    throw new Error("产品编码不能为空且长度不得超过 50 个字符");
  }
  if (!name || name.length > 100) {
    throw new Error("产品名称不能为空且长度不得超过 100 个字符");
  }

  return withTenant(ctx.tenantId, async (tx) => {
    // 检查重复编码
    const dup = await tx.execute(sql`
      select 1 from products
      where tenant_id = ${ctx.tenantId} and code = ${code} and deleted_at is null
      limit 1
    `);
    if (dup.rows.length > 0) {
      throw new Error(`产品编码 "${code}" 已存在，请使用唯一编码`);
    }

    const res = await tx.execute<{
      id: string;
      code: string;
      name: string;
      category: string;
      pricing_model: ProductItem["pricingModel"];
      unit_price: number;
      unit: string;
      description: string | null;
      status: ProductStatus;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into products (
        tenant_id, code, name, category, pricing_model, unit_price, unit, description, status
      ) values (
        ${ctx.tenantId}, ${code}, ${name}, ${category}, ${input.pricingModel}, ${unitPrice}, ${unit}, ${desc}, 'ACTIVE'
      )
      returning
        id, code, name, category, pricing_model, unit_price, unit, description, status,
        created_at::text as created_at, updated_at::text as updated_at
    `);

    const r = res.rows[0];
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      pricingModel: r.pricing_model,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function updateProductService(
  ctx: TenantContext,
  id: string,
  input: UpdateProductInput,
): Promise<ProductItem> {
  return withTenant(ctx.tenantId, async (tx) => {
    const existing = await getProductByIdService(ctx, id);
    if (!existing) {
      throw new Error("指定的产品不存在或已被删除");
    }

    const name = input.name !== undefined ? input.name.trim() : existing.name;
    const category = input.category !== undefined ? input.category.trim() : existing.category;
    const pricingModel = input.pricingModel ?? existing.pricingModel;
    const unitPrice = input.unitPrice !== undefined ? Math.max(0, Math.floor(input.unitPrice)) : existing.unitPrice;
    const unit = input.unit !== undefined ? input.unit.trim() : existing.unit;
    const desc = input.description !== undefined ? (input.description?.trim() || null) : existing.description;
    const status = input.status ?? existing.status;

    const res = await tx.execute<{
      id: string;
      code: string;
      name: string;
      category: string;
      pricing_model: ProductItem["pricingModel"];
      unit_price: number;
      unit: string;
      description: string | null;
      status: ProductStatus;
      created_at: string;
      updated_at: string;
    }>(sql`
      update products
      set
        name = ${name},
        category = ${category},
        pricing_model = ${pricingModel},
        unit_price = ${unitPrice},
        unit = ${unit},
        description = ${desc},
        status = ${status},
        updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${id} and deleted_at is null
      returning
        id, code, name, category, pricing_model, unit_price, unit, description, status,
        created_at::text as created_at, updated_at::text as updated_at
    `);

    const r = res.rows[0];
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category,
      pricingModel: r.pricing_model,
      unitPrice: Number(r.unit_price),
      unit: r.unit,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function archiveProductService(
  ctx: TenantContext,
  id: string,
): Promise<{ success: boolean; message: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.execute(sql`
      update products
      set status = 'ARCHIVED', updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${id} and deleted_at is null
    `);
    return { success: true, message: "产品已归档" };
  });
}

async function fetchOpportunityLineItemsWithTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  opportunityId: string,
): Promise<OpportunityLineItem[]> {
  const res = await tx.execute(sql`
    select
      oli.id,
      oli.opportunity_id,
      oli.product_id,
      p.name as product_name,
      p.code as product_code,
      p.category,
      p.pricing_model,
      p.unit,
      oli.quantity,
      oli.unit_price,
      oli.discount_rate,
      oli.subtotal_amount,
      oli.note,
      oli.created_at::text as created_at
    from opportunity_line_items oli
    inner join products p on p.tenant_id = oli.tenant_id and p.id = oli.product_id
    where oli.tenant_id = ${tenantId} and oli.opportunity_id = ${opportunityId}
    order by oli.created_at asc
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res.rows.map((r: any) => ({
    id: r.id,
    opportunityId: r.opportunity_id,
    productId: r.product_id,
    productName: r.product_name,
    productCode: r.product_code,
    category: r.category,
    pricingModel: r.pricing_model,
    unit: r.unit,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    discountRate: Number(r.discount_rate),
    subtotalAmount: Number(r.subtotal_amount),
    note: r.note,
    createdAt: r.created_at,
  }));
}

export async function listOpportunityLineItemsService(
  ctx: TenantContext,
  opportunityId: string,
): Promise<OpportunityLineItem[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    // 验证商机存在与访问权限（仅自身负责或管理员/主管放行）
    const oppRes = await tx.execute<{ id: string; owner_user_id: string }>(sql`
      select id, owner_user_id from opportunities
      where tenant_id = ${ctx.tenantId} and id = ${opportunityId} and deleted_at is null
      limit 1
    `);
    if (oppRes.rows.length === 0) {
      throw new Error("商机不存在或已被删除");
    }
    const opp = oppRes.rows[0];
    const canAccess = ctx.role === "ADMIN" || ctx.role === "MANAGER" || opp.owner_user_id === ctx.userId;
    if (!canAccess) {
      throw new Error("无权查看他人商机的产品报价明细");
    }

    return fetchOpportunityLineItemsWithTx(tx, ctx.tenantId, opportunityId);
  });
}

export async function saveOpportunityLineItemsService(
  ctx: TenantContext,
  opportunityId: string,
  items: SaveLineItemInput[],
): Promise<{ lineItems: OpportunityLineItem[]; totalExpectedAmount: number }> {
  return withTenant(ctx.tenantId, async (tx) => {
    // 1. 验证商机存在、权限与阶段
    const oppRes = await tx.execute<{ id: string; stage: string; owner_user_id: string }>(sql`
      select id, stage::text as stage, owner_user_id from opportunities
      where tenant_id = ${ctx.tenantId} and id = ${opportunityId} and deleted_at is null
      limit 1
    `);
    if (oppRes.rows.length === 0) {
      throw new Error("商机不存在或已被删除");
    }
    const opp = oppRes.rows[0];
    const canAccess = ctx.role === "ADMIN" || ctx.role === "MANAGER" || opp.owner_user_id === ctx.userId;
    if (!canAccess) {
      throw new Error("无权修改他人商机的产品报价明细");
    }
    if (opp.stage === "WON" || opp.stage === "LOST") {
      throw new Error(`商机处于 ${opp.stage} 阶段，已结单或已归档商机不可修改报价明细`);
    }

    // 2. 清理当前商机所有旧明细
    await tx.execute(sql`
      delete from opportunity_line_items
      where tenant_id = ${ctx.tenantId} and opportunity_id = ${opportunityId}
    `);

    let totalAmount = 0;

    // 3. 逐项插入新明细
    for (const item of items) {
      const pRes = await tx.execute<{ id: string }>(sql`
        select id from products
        where tenant_id = ${ctx.tenantId} and id = ${item.productId} and deleted_at is null
        limit 1
      `);
      if (pRes.rows.length === 0) {
        throw new Error(`选中的产品 ID (${item.productId}) 不存在`);
      }

      const qty = Math.max(1, Math.floor(item.quantity));
      const uPrice = Math.max(0, Math.floor(item.unitPrice));
      const discount = Math.min(100, Math.max(1, Math.floor(item.discountRate)));
      const subtotal = Math.round((qty * uPrice * discount) / 100);
      const note = item.note?.trim() || null;

      totalAmount += subtotal;

      await tx.execute(sql`
        insert into opportunity_line_items (
          tenant_id, opportunity_id, product_id, quantity, unit_price, discount_rate, subtotal_amount, note
        ) values (
          ${ctx.tenantId}, ${opportunityId}, ${item.productId}, ${qty}, ${uPrice}, ${discount}, ${subtotal}, ${note}
        )
      `);
    }

    // 4. 自动回写商机预估总金额
    await tx.execute(sql`
      update opportunities
      set
        expected_amount = ${totalAmount},
        updated_at = now()
      where tenant_id = ${ctx.tenantId} and id = ${opportunityId}
    `);

    // 5. 在当前事务中获取最新明细列表返回
    const lineItems = await fetchOpportunityLineItemsWithTx(tx, ctx.tenantId, opportunityId);
    return { lineItems, totalExpectedAmount: totalAmount };
  });
}
