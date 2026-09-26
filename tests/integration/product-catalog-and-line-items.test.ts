import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let productsService: typeof import("@/core/products/service");
let withTenant: typeof import("@/core/tenant").withTenant;
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;
let ctx: TenantContext;

describe("多业务线产品目录库与商机产品明细挂载 (Product Catalog & Line Items)", () => {
  beforeAll(async () => {
    await owner.connect();
    productsService = await import("@/core/products/service");
    withTenant = (await import("@/core/tenant")).withTenant;
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('产品目录测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const uRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '产品销售', 'SALES') returning id",
      [tenantId, `prod-sales-${ts}@example.com`],
    );
    salesId = uRes.rows[0].id;

    ctx = { tenantId, userId: salesId, role: "SALES" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from opportunity_line_items where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from products where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 产品 SKU 目录库：支持多计费模式创建、更新、分类聚合与防重复校验", async () => {
    // 1. 创建 3 款不同计费模式的产品
    const p1 = await productsService.createProductService(ctx, {
      code: "SAAS-STD-2026",
      name: "企业级数智协同平台 (标准版)",
      category: "数字化云平台",
      pricingModel: "SUBSCRIPTION_YEARLY",
      unitPrice: 1980000, // 19,800 元 (分)
      unit: "年/席位",
      description: "包含核心工作台、多渠道进线与全息时间轴",
    });

    const p2 = await productsService.createProductService(ctx, {
      code: "CUSTOM-DEV-MM",
      name: "行业业务系统定制开发服务",
      category: "定制开发与服务",
      pricingModel: "MAN_MONTH",
      unitPrice: 3500000, // 35,000 元/人月
      unit: "人月",
    });

    const p3 = await productsService.createProductService(ctx, {
      code: "IOT-GATEWAY-HW",
      name: "边缘计算工业网关设备",
      category: "智能硬件",
      pricingModel: "ONE_TIME",
      unitPrice: 880000, // 8,800 元/台
      unit: "台",
    });

    expect(p1.id).toBeDefined();
    expect(p1.code).toBe("SAAS-STD-2026");
    expect(p2.pricingModel).toBe("MAN_MONTH");
    expect(p3.category).toBe("智能硬件");

    // 2. 验证防重复编码检查
    await expect(
      productsService.createProductService(ctx, {
        code: "saas-std-2026", // 大小写不敏感校验
        name: "重复编码测试",
        category: "测试",
        pricingModel: "ONE_TIME",
        unitPrice: 100,
        unit: "套",
      }),
    ).rejects.toThrow(/已存在/);

    // 3. 验证品类聚合
    const categories = await productsService.listProductCategoriesService(ctx);
    expect(categories.length).toBe(3);
    const cloudCat = categories.find((c) => c.category === "数字化云平台");
    expect(cloudCat?.productCount).toBe(1);
    expect(cloudCat?.activeCount).toBe(1);

    // 4. 验证列表查询与关键字搜索
    const searchRes = await productsService.listProductsService(ctx, { search: "数智协同" });
    expect(searchRes.length).toBe(1);
    expect(searchRes[0].id).toBe(p1.id);

    // 5. 验证更新产品
    const updatedP1 = await productsService.updateProductService(ctx, p1.id, {
      name: "企业级数智协同平台 (旗舰版)",
      unitPrice: 2980000,
    });
    expect(updatedP1.name).toBe("企业级数智协同平台 (旗舰版)");
    expect(updatedP1.unitPrice).toBe(2980000);

    // 6. 验证产品归档
    await productsService.archiveProductService(ctx, p3.id);
    const activeList = await productsService.listProductsService(ctx, { status: "ACTIVE" });
    expect(activeList.find((p) => p.id === p3.id)).toBeUndefined();

    const archivedP3 = await productsService.getProductByIdService(ctx, p3.id);
    expect(archivedP3?.status).toBe("ARCHIVED");
  });

  it("2. 商机产品明细挂载 (Line Items)：自动核算预估总金额并与商机主表双向联动", async () => {
    // 创建测试客户与商机
    const customerId = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        insert into customers (tenant_id, name, customer_type, owner_user_id)
        values (${tenantId}, '测试先进制造科技股份', 'ENTERPRISE', ${salesId})
        returning id
      `);
      return res.rows[0].id;
    });

    const opportunityId = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount, stage_entered_at)
        values (${tenantId}, ${customerId}, ${salesId}, '数智化转型一期工程', 'PROPOSAL', 0, now())
        returning id
      `);
      return res.rows[0].id;
    });

    // 创建两款标准产品
    const pSaaS = await productsService.createProductService(ctx, {
      code: "SAAS-2026",
      name: "平台标准版",
      category: "云服务",
      pricingModel: "SUBSCRIPTION_YEARLY",
      unitPrice: 2000000, // 20,000 元
      unit: "年",
    });

    const pService = await productsService.createProductService(ctx, {
      code: "DEV-2026",
      name: "专家驻场定制实施",
      category: "服务",
      pricingModel: "MAN_MONTH",
      unitPrice: 3000000, // 30,000 元
      unit: "人月",
    });

    // 挂载明细：
    // Item 1: 平台标准版 * 2年，85折 (2 * 20000 * 0.85 = 34000 元 = 3,400,000 分)
    // Item 2: 定制实施 * 3人月，无折扣 (3 * 30000 * 1.00 = 90000 元 = 9,000,000 分)
    // 合计预估总额 = 3,400,000 + 9,000,000 = 12,400,000 分 (124,000 元)
    const saveResult = await productsService.saveOpportunityLineItemsService(ctx, opportunityId, [
      {
        productId: pSaaS.id,
        quantity: 2,
        unitPrice: 2000000,
        discountRate: 85,
        note: "两年长约优惠 85 折",
      },
      {
        productId: pService.id,
        quantity: 3,
        unitPrice: 3000000,
        discountRate: 100,
        note: "3人月驻场交付",
      },
    ]);

    expect(saveResult.lineItems.length).toBe(2);
    expect(saveResult.totalExpectedAmount).toBe(12400000);

    // 验证数据库 opportunities 主表中的 expected_amount 已被自动同步回写
    const oppDb = await withTenant(tenantId, async (tx) => {
      const res = await tx.execute<{ expected_amount: number }>(sql`
        select expected_amount from opportunities where tenant_id = ${tenantId} and id = ${opportunityId}
      `);
      return res.rows[0];
    });

    expect(Number(oppDb.expected_amount)).toBe(12400000);

    // 查询验证商机明细列表
    const fetchedItems = await productsService.listOpportunityLineItemsService(ctx, opportunityId);
    expect(fetchedItems.length).toBe(2);
    expect(fetchedItems[0].productName).toBe("平台标准版");
    expect(fetchedItems[0].subtotalAmount).toBe(3400000);
    expect(fetchedItems[1].productName).toBe("专家驻场定制实施");
    expect(fetchedItems[1].subtotalAmount).toBe(9000000);
  });

  it("3. 商机报价明细权限与阶段保护 (Line Items ACL & Stage Guard)：禁止越权与已结单篡改", async () => {
    // 创建另一位销售人员
    const ts = Date.now();
    const otherUserRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '其他销售', 'SALES') returning id",
      [tenantId, `other-sales-${ts}@example.com`],
    );
    const otherSalesId = otherUserRes.rows[0].id;
    const otherCtx: TenantContext = { tenantId, userId: otherSalesId, role: "SALES" };
    const managerCtx: TenantContext = { tenantId, userId: otherSalesId, role: "MANAGER" };

    // 获取之前测试中创建的商机
    const oppRes = await owner.query<{ id: string }>(
      "select id from opportunities where tenant_id = $1 and owner_user_id = $2 limit 1",
      [tenantId, salesId],
    );
    const targetOppId = oppRes.rows[0].id;

    // 1. 非归属人 SALES 查看他人商机报价明细应被拦截
    await expect(
      productsService.listOpportunityLineItemsService(otherCtx, targetOppId),
    ).rejects.toThrow("无权查看他人商机的产品报价明细");

    // 2. 非归属人 SALES 修改他人商机报价明细应被拦截
    await expect(
      productsService.saveOpportunityLineItemsService(otherCtx, targetOppId, []),
    ).rejects.toThrow("无权修改他人商机的产品报价明细");

    // 3. 管理员/主管角色放行查看
    const mgrList = await productsService.listOpportunityLineItemsService(managerCtx, targetOppId);
    expect(mgrList.length).toBeGreaterThan(0);

    // 4. 将商机流转为已赢单 (WON)，补齐 actual_amount / actual_close_at 满足 opportunities_won_fields CHECK 约束
    // 商机归属人本人也禁止再篡改报价明细
    await owner.query(
      "update opportunities set stage = 'WON', actual_amount = 12400000, actual_close_at = CURRENT_DATE, lost_reason = null where id = $1",
      [targetOppId],
    );
    await expect(
      productsService.saveOpportunityLineItemsService(ctx, targetOppId, []),
    ).rejects.toThrow(/已结单或已归档商机不可修改报价明细/);

    // 5. 将商机流转为已输单 (LOST)，设置 lost_reason 并清空 actual 字段满足 opportunities_lost_fields CHECK 约束
    // 同样禁止篡改报价明细
    await owner.query(
      "update opportunities set stage = 'LOST', actual_amount = null, actual_close_at = null, lost_reason = 'PRICE' where id = $1",
      [targetOppId],
    );
    await expect(
      productsService.saveOpportunityLineItemsService(ctx, targetOppId, []),
    ).rejects.toThrow(/已结单或已归档商机不可修改报价明细/);
  });
});
