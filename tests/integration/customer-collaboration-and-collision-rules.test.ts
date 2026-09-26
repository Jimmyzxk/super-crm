import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });

let collaborationService: typeof import("@/core/collaboration/service");
let customerService: typeof import("@/core/customer/service");
let opportunityService: typeof import("@/core/opportunity/service");
let leadsService: typeof import("@/core/leads/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let sales1Id: string;
let sales2Id: string;

let productSoftwareId: string;
let productHardwareId: string;
let productCloudId: string;

describe("客户共享协同与商机产品线防撞单排他机制集成测试", () => {
  beforeAll(async () => {
    await owner.connect();
    collaborationService = await import("@/core/collaboration/service");
    customerService = await import("@/core/customer/service");
    opportunityService = await import("@/core/opportunity/service");
    leadsService = await import("@/core/leads/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(
      `insert into tenants (name) values ('客户协同与防撞单测试租户') returning id`,
    );
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();

    const adminRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, $3, '系统管理员', 'ADMIN') returning id`,
      [tenantId, `collab-admin-${ts}@test.com`, pw],
    );
    adminId = adminRes.rows[0].id;

    const managerRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, $3, '业务总监', 'MANAGER') returning id`,
      [tenantId, `collab-mgr-${ts}@test.com`, pw],
    );
    void managerRes; // 主管账号为后续用例预留

    const sales1Res = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, $3, '软件销售顾问张三', 'SALES') returning id`,
      [tenantId, `collab-sales1-${ts}@test.com`, pw],
    );
    sales1Id = sales1Res.rows[0].id;

    const sales2Res = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, $3, '硬件销售顾问李四', 'SALES') returning id`,
      [tenantId, `collab-sales2-${ts}@test.com`, pw],
    );
    sales2Id = sales2Res.rows[0].id;

    // 创建标准测试产品
    const prod1Res = await owner.query<{ id: string }>(
      `insert into products (tenant_id, name, code, category, unit_price, status)
       values ($1, '商脉AI企业标准版', 'CODE-CRM-STD', '软件服务', 500000, 'ACTIVE') returning id`,
      [tenantId],
    );
    productSoftwareId = prod1Res.rows[0].id;

    const prod2Res = await owner.query<{ id: string }>(
      `insert into products (tenant_id, name, code, category, unit_price, status)
       values ($1, '商脉边缘计算网关盒', 'CODE-HW-BOX', '硬件终端', 300000, 'ACTIVE') returning id`,
      [tenantId],
    );
    productHardwareId = prod2Res.rows[0].id;

    const prod3Res = await owner.query<{ id: string }>(
      `insert into products (tenant_id, name, code, category, unit_price, status)
       values ($1, '私有化云部署服务包', 'CODE-CLOUD-DEP', '云部署', 800000, 'ACTIVE') returning id`,
      [tenantId],
    );
    productCloudId = prod3Res.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query(`delete from audit_logs where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from lead_conversions where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_line_items where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunity_stage_history where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tasks where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from opportunities where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from lead_status_history where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from leads where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from contacts where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customers where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from customer_collaboration_settings where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from products where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from users where tenant_id = $1`, [tenantId]);
      await owner.query(`delete from tenants where id = $1`, [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 协同设置默认应为关闭状态（独占模式），非客户负责人跨销售立项应被拦截", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    // 获取默认设置
    const defaultSettings = await collaborationService.getCustomerCollaborationSettingsService(adminCtx);
    expect(defaultSettings.allowMultiSalesFollowup).toBe(false);

    // 销售 1 创建客户与主联系人
    const custRes = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, owner_user_id, name, customer_type)
       values ($1, $2, '未来科技有限公司', 'ENTERPRISE') returning id`,
      [tenantId, sales1Id],
    );
    const customerId = custRes.rows[0].id;

    const contactRes = await owner.query<{ id: string }>(
      `insert into contacts (tenant_id, customer_id, name, phone, is_primary)
       values ($1, $2, '王总', '13900010001', true) returning id`,
      [tenantId, customerId],
    );
    const contactId = contactRes.rows[0].id;

    // 销售 1 为自己的客户立项软件商机成功
    const opp1 = await opportunityService.createOpportunityService(sales1Ctx, {
      customerId,
      primaryContactId: contactId,
      name: "未来科技-软件系统采购项目",
      intendedProductId: productSoftwareId,
      expectedAmount: 500000,
    });
    expect(opp1.opportunityId).toBeDefined();

    // 默认关闭客户共享时，销售 2 尝试在该客户下立项应抛出 FORBIDDEN
    await expect(
      opportunityService.createOpportunityService(sales2Ctx, {
        customerId,
        primaryContactId: contactId,
        name: "未来科技-硬件终端采购项目",
        intendedProductId: productHardwareId,
        expectedAmount: 300000,
      }),
    ).rejects.toThrow("客户不存在、处于未分配状态或当前用户无权操作");
  });

  it("2. 管理员开启客户共享协同开关后，允许不同销售在同一客户下创建不同产品线的商机", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    // 管理员开启客户共享
    const updatedSettings = await collaborationService.updateCustomerCollaborationSettingsService(adminCtx, {
      allowMultiSalesFollowup: true,
    });
    expect(updatedSettings.allowMultiSalesFollowup).toBe(true);

    const cust = await owner.query<{ id: string }>(
      `select id from customers where tenant_id = $1 and name = '未来科技有限公司'`,
      [tenantId],
    );
    const customerId = cust.rows[0].id;

    const contact = await owner.query<{ id: string }>(
      `select id from contacts where tenant_id = $1 and customer_id = $2 and is_primary = true`,
      [tenantId, customerId],
    );
    const contactId = contact.rows[0].id;

    // 销售 2（硬件顾问）为客户立项不同产品（硬件）的商机应成功
    const opp2 = await opportunityService.createOpportunityService(sales2Ctx, {
      customerId,
      primaryContactId: contactId,
      name: "未来科技-硬件终端部署项目",
      intendedProductId: productHardwareId,
      expectedAmount: 300000,
    });
    expect(opp2.opportunityId).toBeDefined();

    // 校验商机负责人为销售 2，而客户主档负责人仍为销售 1
    const oppRow = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id from opportunities where id = $1`,
      [opp2.opportunityId],
    );
    expect(oppRow.rows[0].owner_user_id).toBe(sales2Id);

    const custRow = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id from customers where id = $1`,
      [customerId],
    );
    expect(custRow.rows[0].owner_user_id).toBe(sales1Id);

    // 校验销售 2 可以查看该协同客户详情
    const custDetail = await customerService.getCustomerDetailService(sales2Ctx, customerId);
    expect(custDetail.customer.name).toBe("未来科技有限公司");
    expect(custDetail.opportunities.length).toBeGreaterThanOrEqual(2);
  });

  it("3. 防撞单排他控制：相同客户相同产品方向，禁止不同销售重复立项推进中商机", async () => {
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    const cust = await owner.query<{ id: string }>(
      `select id from customers where tenant_id = $1 and name = '未来科技有限公司'`,
      [tenantId],
    );
    const customerId = cust.rows[0].id;

    const contact = await owner.query<{ id: string }>(
      `select id from contacts where tenant_id = $1 and customer_id = $2 and is_primary = true`,
      [tenantId, customerId],
    );
    const contactId = contact.rows[0].id;

    // 销售 1 已经在推进 productSoftwareId (商脉AI企业标准版)
    // 销售 2 尝试立项相同产品，应被即时拦截并报错 COLLISION
    await expect(
      opportunityService.createOpportunityService(sales2Ctx, {
        customerId,
        primaryContactId: contactId,
        name: "未来科技-软件加购项目",
        intendedProductId: productSoftwareId,
        expectedAmount: 500000,
      }),
    ).rejects.toThrow("该客户已有销售【软件销售顾问张三】在推进【商脉AI企业标准版】相关商机");

    // 销售 2 尝试通过选配报价 lineItems 包含相同产品立项，应同样被拦截
    await expect(
      opportunityService.createOpportunityService(sales2Ctx, {
        customerId,
        primaryContactId: contactId,
        name: "未来科技-软件二次报价",
        lineItems: [
          {
            productId: productSoftwareId,
            quantity: 2,
            unitPrice: 500000,
            discountRate: 100,
          },
        ],
      }),
    ).rejects.toThrow("该客户已有销售【软件销售顾问张三】在推进【商脉AI企业标准版】相关商机");

    // 销售 2 尝试通过产品名称文本相同立项，应同样被拦截
    await expect(
      opportunityService.createOpportunityService(sales2Ctx, {
        customerId,
        primaryContactId: contactId,
        name: "未来科技-软件意向项目",
        intendedProduct: "商脉AI企业标准版",
      }),
    ).rejects.toThrow("同客户同产品方向暂不允许重复立项");
  });

  it("4. 线索转化关联已有客户时，严格执行防撞单排他规则", async () => {
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    const cust = await owner.query<{ id: string }>(
      `select id from customers where tenant_id = $1 and name = '未来科技有限公司'`,
      [tenantId],
    );
    const customerId = cust.rows[0].id;

    // 创建一条属于销售 2 的线索，意向为软件产品（与销售 1 已有商机冲突）
    const leadCollision = await leadsService.createLeadService(sales2Ctx, {
      contactName: "赵总监",
      contactPhone: "13900020002",
      companyName: "未来科技有限公司",
      intendedProductId: productSoftwareId,
    });
    // 确认需求
    await owner.query(`update leads set status = 'QUALIFIED' where id = $1`, [leadCollision.leadId!]);

    // 销售 2 尝试将该线索转化为已有客户商机 -> 触发撞单拦截
    await expect(
      customerService.convertLeadToCustomerService(sales2Ctx, {
        leadId: leadCollision.leadId!,
        customerName: "未来科技有限公司",
        linkToExistingCustomerId: customerId,
        contactName: "赵总监",
        contactPhone: "13900020002",
        opportunityName: "未来科技-线索转化软件商机",
        expectedAmount: 500000,
        expectedCloseAt: new Date(Date.now() + 86400000),
        demandNote: "意向软件产品冲突",
      }),
    ).rejects.toThrow("该客户已有销售【软件销售顾问张三】在推进【商脉AI企业标准版】相关商机");

    // 创建另一条属于销售 2 的线索，意向为云部署产品（不冲突）
    const leadValid = await leadsService.createLeadService(sales2Ctx, {
      contactName: "钱总监",
      contactPhone: "13900030003",
      companyName: "未来科技有限公司",
      intendedProductId: productCloudId,
    });
    await owner.query(`update leads set status = 'QUALIFIED' where id = $1`, [leadValid.leadId!]);

    // 转化成功
    const convertRes = await customerService.convertLeadToCustomerService(sales2Ctx, {
      leadId: leadValid.leadId!,
      customerName: "未来科技有限公司",
      linkToExistingCustomerId: customerId,
      contactName: "钱总监",
      contactPhone: "13900030003",
      opportunityName: "未来科技-私有云部署项目",
      expectedAmount: 800000,
      expectedCloseAt: new Date(Date.now() + 86400000),
      demandNote: "云部署方案已确认",
    });
    expect(convertRes.opportunityId).toBeDefined();

    // 验证新商机归属销售 2
    const oppCloud = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id from opportunities where id = $1`,
      [convertRes.opportunityId],
    );
    expect(oppCloud.rows[0].owner_user_id).toBe(sales2Id);
  });

  it("5. 当原有推进中商机标记为输单（LOST）后，排他保护自动释放，允许其他销售重新立项", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    const cust = await owner.query<{ id: string }>(
      `select id from customers where tenant_id = $1 and name = '未来科技有限公司'`,
      [tenantId],
    );
    const customerId = cust.rows[0].id;

    const contact = await owner.query<{ id: string }>(
      `select id from contacts where tenant_id = $1 and customer_id = $2 and is_primary = true`,
      [tenantId, customerId],
    );
    const contactId = contact.rows[0].id;

    // 查出销售 1 的软件商机
    const opp1Row = await owner.query<{ id: string }>(
      `select id from opportunities where tenant_id = $1 and customer_id = $2 and intended_product_id = $3 and owner_user_id = $4`,
      [tenantId, customerId, productSoftwareId, sales1Id],
    );
    const opp1Id = opp1Row.rows[0].id;

    // 销售 1 将该商机标记为输单
    await opportunityService.loseOpportunityService(sales1Ctx, {
      opportunityId: opp1Id,
      reason: "PRICE",
      note: "客户预算临时缩减，软件项目终止",
    });

    // 此时排他保护应自动释放，销售 2 重新立项相同软件产品应该成功
    const oppNew = await opportunityService.createOpportunityService(sales2Ctx, {
      customerId,
      primaryContactId: contactId,
      name: "未来科技-软件重启跟进项目",
      intendedProductId: productSoftwareId,
      expectedAmount: 450000,
    });
    expect(oppNew.opportunityId).toBeDefined();

    const oppNewRow = await owner.query<{ owner_user_id: string; stage: string }>(
      `select owner_user_id, stage from opportunities where id = $1`,
      [oppNew.opportunityId],
    );
    expect(oppNewRow.rows[0].owner_user_id).toBe(sales2Id);
    expect(oppNewRow.rows[0].stage).toBe("DISCOVERY");
  });

  it("6. 管理员/主管代操作时商机归属必须落在一线销售名下（不能归管理员）", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

    // 路径一：管理员转化销售的合格线索
    const lead = await leadsService.createLeadService(sales1Ctx, {
      contactName: "孙负责人",
      contactPhone: "13900060006",
      companyName: "管理者代操作验证公司",
      intendedProductId: productCloudId,
    });
    await owner.query(`update leads set status = 'QUALIFIED' where id = $1`, [lead.leadId!]);

    const convertRes = await customerService.convertLeadToCustomerService(adminCtx, {
      leadId: lead.leadId!,
      customerName: "管理者代操作验证公司",
      contactName: "孙负责人",
      contactPhone: "13900060006",
      opportunityName: "代操作转化商机",
      expectedAmount: 200000,
      expectedCloseAt: new Date(Date.now() + 86400000),
      demandNote: "管理员代销售转化",
    });

    const convOpp = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id from opportunities where id = $1`,
      [convertRes.opportunityId],
    );
    // 商机归属线索负责人（一线销售），而非点击按钮的管理员
    expect(convOpp.rows[0].owner_user_id).toBe(sales1Id);

    // 推进待办也应指派给销售
    const convTask = await owner.query<{ assignee_user_id: string }>(
      `select assignee_user_id from tasks where opportunity_id = $1 and status = 'OPEN' order by created_at desc limit 1`,
      [convertRes.opportunityId],
    );
    if (convTask.rows[0]) {
      expect(convTask.rows[0].assignee_user_id).toBe(sales1Id);
    }

    // 路径二：管理员直接在销售的客户上立项
    const cust = await owner.query<{ id: string; contact_id: string }>(
      `select c.id, (select id from contacts ct where ct.customer_id = c.id and ct.is_primary limit 1) as contact_id
       from customers c where c.tenant_id = $1 and c.name = '管理者代操作验证公司'`,
      [tenantId],
    );
    const directOpp = await opportunityService.createOpportunityService(adminCtx, {
      customerId: cust.rows[0].id,
      primaryContactId: cust.rows[0].contact_id,
      name: "管理员直接立项商机",
      intendedProductId: productHardwareId,
      expectedAmount: 300000,
    });
    const directOppRow = await owner.query<{ owner_user_id: string }>(
      `select owner_user_id from opportunities where id = $1`,
      [directOpp.opportunityId],
    );
    // 直建商机归属客户负责人（一线销售）
    expect(directOppRow.rows[0].owner_user_id).toBe(sales1Id);
  });

  it("7. 排他保护开关可关闭：关闭后同产品允许多销售并行立项，且设置真实落库", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    // 管理员关闭排他保护（协同保持开启）
    const saved = await collaborationService.updateCustomerCollaborationSettingsService(adminCtx, {
      allowMultiSalesFollowup: true,
      requireProductExclusivity: false,
    });
    expect(saved.requireProductExclusivity).toBe(false);

    // 读取回来也应为关闭（真实落库，不是只在内存里转一圈）
    const reread = await collaborationService.getCustomerCollaborationSettingsService(adminCtx);
    expect(reread.requireProductExclusivity).toBe(false);

    // 销售 2 再立一个与销售 1 相同软件产品的商机 → 不再拦截
    const cust = await owner.query<{ id: string; contact_id: string }>(
      `select c.id, (select id from contacts ct where ct.customer_id = c.id and ct.is_primary limit 1) as contact_id
       from customers c where c.tenant_id = $1 and c.name = '未来科技有限公司'`,
      [tenantId],
    );
    const parallelOpp = await opportunityService.createOpportunityService(sales2Ctx, {
      customerId: cust.rows[0].id,
      primaryContactId: cust.rows[0].contact_id,
      name: "未来科技-软件并行跟进（排他已关）",
      intendedProductId: productSoftwareId,
      expectedAmount: 400000,
    });
    expect(parallelOpp.opportunityId).toBeDefined();

    // 恢复默认：排他保护重新开启，避免影响其他用例
    await collaborationService.updateCustomerCollaborationSettingsService(adminCtx, {
      allowMultiSalesFollowup: true,
      requireProductExclusivity: true,
    });
    const restored = await collaborationService.getCustomerCollaborationSettingsService(adminCtx);
    expect(restored.requireProductExclusivity).toBe(true);
  });
});
