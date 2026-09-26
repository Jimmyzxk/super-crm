/**
 * 多产品线协同全链路故事线测试（复盘实证）
 *
 * 故事：客户归销售甲。协同开启后，销售乙在该客户身上立项不同产品线商机，
 * 乙推进并赢单。验证此前"商机单独转移"模型的三个割裂在新模型下全部闭合：
 *   割裂1：乙看不到客户档案 → 协同开启后乙可见（列表+详情）
 *   割裂2：甲被乙的在途商机卡死 → 乙在途时甲释放被拦（合理保护+引导），
 *          乙赢单后甲可释放（WON 不阻塞）
 *   割裂3：业绩与档案错位 → 乙赢单业绩归乙，客户归属仍甲，释放后客户回公海、
 *          乙的 WON 商机与业绩记录永存
 */
import "dotenv/config";
import pg from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let closeDb: typeof import("@/db/client").closeDb;
let customerService: typeof import("@/core/customer/service");
let opportunityService: typeof import("@/core/opportunity/service");
let collaborationService: typeof import("@/core/collaboration/service");

let tenantId: string;
let adminId: string;
let salesAId: string; // 客户主负责人
let salesBId: string; // 跨产品线协同销售
let productIdA: string;
let productIdB: string;

const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";

describe("多产品线协同全链路故事线（复盘实证）", () => {
  beforeAll(async () => {
    await owner.connect();
    customerService = await import("@/core/customer/service");
    opportunityService = await import("@/core/opportunity/service");
    collaborationService = await import("@/core/collaboration/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(
      `insert into tenants (name) values ('协同故事线复盘租户') returning id`,
    );
    tenantId = tenantRes.rows[0].id;
    const ts = Date.now();

    const mkUser = async (name: string, role: "ADMIN" | "SALES", tag: string) => {
      const res = await owner.query<{ id: string }>(
        `insert into users (tenant_id, email, password_hash, name, role)
         values ($1, $2, $3, $4, $5) returning id`,
        [tenantId, `story-${tag}-${ts}@test.com`, pw, name, role],
      );
      return res.rows[0].id;
    };
    adminId = await mkUser("复盘管理员", "ADMIN", "admin");
    salesAId = await mkUser("软件线销售甲", "SALES", "a");
    salesBId = await mkUser("硬件线销售乙", "SALES", "b");

    const mkProduct = async (name: string, code: string) => {
      const res = await owner.query<{ id: string }>(
        `insert into products (tenant_id, name, code, category, unit_price, status)
         values ($1, $2, $3, $4, 500000, 'ACTIVE') returning id`,
        [tenantId, name, code, name.slice(0, 2)],
      );
      return res.rows[0].id;
    };
    productIdA = await mkProduct("故事线CRM套件", "STORY-CRM");
    productIdB = await mkProduct("故事线边缘网关", "STORY-HW");

    // 开启协同（排他保护保持默认开启）
    await collaborationService.updateCustomerCollaborationSettingsService(
      { tenantId, userId: adminId, role: "ADMIN" },
      { allowMultiSalesFollowup: true },
    );
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query(`delete from audit_logs where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from win_reviews where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from sales_insights where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from activities where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from lead_conversions where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_line_items where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_stage_history where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tasks where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunities where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from contacts where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customer_collaboration_settings where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from notifications where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from products where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from users where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tenants where id = $1`, [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("完整故事线：协同立项 → 乙可见客户 → 甲被在途商机保护 → 乙赢单 → 甲可释放 → 业绩永存", async () => {
    const aCtx = { tenantId, userId: salesAId, role: "SALES" as const };
    const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

    // 0. 甲建客户（软件线商机 A）
    const customer = await customerService.createCustomerDirectService(aCtx, {
      name: "故事线集团",
      customerType: "ENTERPRISE",
      contactName: "王董事长",
      contactPhone: "13711112222",
    });
    const customerId = customer.customerId;
    await opportunityService.createOpportunityService(aCtx, {
      customerId,
      primaryContactId: customer.contactId!,
      name: "故事线-CRM套件",
      intendedProductId: productIdA,
      expectedAmount: 500000,
    });

    // 1. 割裂1修复实证：乙在协同开启后能立项不同产品线
    const oppB = await opportunityService.createOpportunityService(bCtx, {
      customerId,
      primaryContactId: customer.contactId!,
      name: "故事线-边缘网关",
      intendedProductId: productIdB,
      expectedAmount: 300000,
    });
    expect(oppB.opportunityId).toBeDefined();

    // 乙能看到客户（列表可见 + 详情可开）
    const bList = await customerService.listCustomersService(bCtx, { search: "故事线集团" });
    expect(bList.items.some((c) => c.id === customerId)).toBe(true);
    const bDetail = await customerService.getCustomerDetailService(bCtx, customerId);
    expect(bDetail.customer.name).toBe("故事线集团");

    // 2. 割裂2前半实证：乙的在途商机保护客户——甲释放被拦（引导先处理商机）
    await expect(
      customerService.releaseCustomerToPoolService(aCtx, customerId),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // 3. 割裂3前半实证：乙赢单，业绩归乙
    await opportunityService.advanceStageService(bCtx, {
      opportunityId: oppB.opportunityId,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      note: "硬件方案报价",
    });
    await opportunityService.advanceStageService(bCtx, {
      opportunityId: oppB.opportunityId,
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
      note: "进入商务条款",
    });
    await opportunityService.winOpportunityService(bCtx, {
      opportunityId: oppB.opportunityId,
      actualAmount: 280000,
      actualCloseAt: new Date(),
    });

    const wonOpp = await owner.query<{ owner_user_id: string; stage: string }>(
      `select owner_user_id::text, stage from opportunities where id = $1`,
      [oppB.opportunityId],
    );
    expect(wonOpp.rows[0].stage).toBe("WON");
    expect(wonOpp.rows[0].owner_user_id).toBe(salesBId);

    // 客户归属仍甲
    const custRow = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id::text from customers where id = $1`,
      [customerId],
    );
    expect(custRow.rows[0].owner_user_id).toBe(salesAId);

    // 4. 割裂2后半实证：WON 不阻塞——甲先关掉自己的商机，再释放客户成功
    const aOppRow = await owner.query<{ id: string }>(
      `select id from opportunities where customer_id = $1 and owner_user_id = $2 and stage not in ('WON','LOST')`,
      [customerId, salesAId],
    );
    await opportunityService.loseOpportunityService(aCtx, {
      opportunityId: aOppRow.rows[0].id,
      reason: "NO_BUDGET",
      note: "软件线本期预算冻结",
    });
    await customerService.releaseCustomerToPoolService(aCtx, customerId);

    const released = await owner.query<{ owner_user_id: string | null }>(
      `select owner_user_id from customers where id = $1`,
      [customerId],
    );
    expect(released.rows[0].owner_user_id).toBeNull();

    // 5. 永恒不变量：WON 商机归属不随客户进公海而变，业绩记录永存
    const wonAfterRelease = await owner.query<{ owner_user_id: string; stage: string }>(
      `select owner_user_id::text, stage from opportunities where id = $1`,
      [oppB.opportunityId],
    );
    expect(wonAfterRelease.rows[0].stage).toBe("WON");
    expect(wonAfterRelease.rows[0].owner_user_id).toBe(salesBId);

    // 6. 公海客户被丙认领时：乙的 WON 不阻塞（历史业绩），可正常认领
    await customerService.claimCustomerService(aCtx, customerId);
    const reclaimed = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id::text from customers where id = $1`,
      [customerId],
    );
    expect(reclaimed.rows[0].owner_user_id).toBe(salesAId);
  });

  it("离职交接：乙的商机可转移给甲（WON 不可转），转移后客户归属不动", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const bCtx = { tenantId, userId: salesBId, role: "SALES" as const };

    // 找客户（已被甲认领），乙再立一个硬件线新商机
    const cust = await owner.query<{ id: string; contact_id: string }>(
      `select c.id, (select id from contacts ct where ct.customer_id = c.id and ct.is_primary limit 1) as contact_id
       from customers c where c.tenant_id = $1 and c.name = '故事线集团'`,
      [tenantId],
    );
    const oppB2 = await opportunityService.createOpportunityService(bCtx, {
      customerId: cust.rows[0].id,
      primaryContactId: cust.rows[0].contact_id,
      name: "故事线-网关二期",
      intendedProductId: productIdB,
      expectedAmount: 150000,
    });

    // 乙转给甲（管理员操作），客户归属不动
    const res = await opportunityService.transferOpportunityService(adminCtx, oppB2.opportunityId, salesAId, {
      reason: "MULTI_PRODUCT_COLLAB",
      note: "乙离职交接",
    });
    expect(res.toOwnerUserId).toBe(salesAId);

    const custAfter = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id::text from customers where id = $1`,
      [cust.rows[0].id],
    );
    expect(custAfter.rows[0].owner_user_id).toBe(salesAId);

    // 已 WON 的商机（上一个用例的）不可转移
    const wonOpp = await owner.query<{ id: string }>(
      `select id from opportunities where tenant_id = $1 and stage = 'WON' limit 1`,
      [tenantId],
    );
    await expect(
      opportunityService.transferOpportunityService(adminCtx, wonOpp.rows[0].id, salesAId),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});
