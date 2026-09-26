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

let leadsService: typeof import("@/core/leads/service");
let followupService: typeof import("@/core/followup/service");
let customerService: typeof import("@/core/customer/service");
let opportunityService: typeof import("@/core/opportunity/service");
let winReviewService: typeof import("@/core/win-review/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let sales1Id: string;
let sales2Id: string;

describe("线索与客户全生命周期流转、分配与多角色权限隔离端到端测试", () => {
  beforeAll(async () => {
    await owner.connect();
    leadsService = await import("@/core/leads/service");
    followupService = await import("@/core/followup/service");
    customerService = await import("@/core/customer/service");
    opportunityService = await import("@/core/opportunity/service");
    winReviewService = await import("@/core/win-review/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('流转与权限验证租户') returning id`);
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();

    const adminRes = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '总管理员', 'ADMIN') returning id`, [tenantId, `admin-${ts}@test.com`, pw]);
    adminId = adminRes.rows[0].id;

    await owner.query(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '销售经理', 'MANAGER')`, [tenantId, `mgr-${ts}@test.com`, pw]);

    const sales1Res = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '销售专员甲', 'SALES') returning id`, [tenantId, `sales1-${ts}@test.com`, pw]);
    sales1Id = sales1Res.rows[0].id;

    const sales2Res = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '销售专员乙', 'SALES') returning id`, [tenantId, `sales2-${ts}@test.com`, pw]);
    sales2Id = sales2Res.rows[0].id;
  });

  afterAll(async () => {
    await closeDb();
    await owner.end();
  });

  it("1. 权限测试：管理员与主管能纵览全量线索与客户，销售专员仅可见自身与公海线索", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    // 销售1 创建属于自己的线索
    const leadS1 = await leadsService.createLeadService(sales1Ctx, {
      contactName: "销售1的独家客户",
      contactPhone: "13911110001",
      companyName: "独家科技1",
    });

    // 销售2 创建属于自己的线索
    const leadS2 = await leadsService.createLeadService(sales2Ctx, {
      contactName: "销售2的独家客户",
      contactPhone: "13911110002",
      companyName: "独家科技2",
    });

    // 公海线索 (未分配)
    const unassignedLead = await leadsService.createLeadService(adminCtx, {
      contactName: "公海待分配线索",
      contactPhone: "13911110003",
      companyName: "公海集团",
    });
    // 置空 owner 成为公海线索
    await owner.query(`update leads set owner_user_id = null where id = $1`, [unassignedLead.leadId]);

    // 验证：管理员能看到全部 3 条线索 (包含 sales1, sales2 和 unassigned)
    const adminList = await leadsService.listLeadsService(adminCtx, { filter: "all" });
    const adminLeadIds = adminList.items.map((i) => i.id);
    expect(adminLeadIds).toContain(leadS1.leadId);
    expect(adminLeadIds).toContain(leadS2.leadId);

    // 验证：销售1 只能看到自己的线索，看不到销售2的独家线索
    const sales1List = await leadsService.listLeadsService(sales1Ctx, { filter: "all" });
    const sales1LeadIds = sales1List.items.map((i) => i.id);
    expect(sales1LeadIds).toContain(leadS1.leadId);
    expect(sales1LeadIds).not.toContain(leadS2.leadId);

    // 验证：销售1 和 销售2 均可在公海视图中查看到未分配的公海线索
    const sales1Unassigned = await leadsService.listLeadsService(sales1Ctx, { filter: "unassigned" });
    expect(sales1Unassigned.items.some((i) => i.id === unassignedLead.leadId)).toBe(true);

    // 验证客户权限：管理员能看到所有客户 (包含公海无责任人客户)
    // 创建一个公海客户 (owner_user_id = null)
    const publicCustomerRes = await owner.query<{ id: string }>(`insert into customers
      (tenant_id, name, industry, region, size, owner_user_id)
      values ($1, '公海无主企业', '软件服务', '华北', '21-100', null) returning id`, [tenantId]);
    const publicCustomerId = publicCustomerRes.rows[0].id;

    // 管理员拉取全部客户，确保公海客户不会因 INNER JOIN 丢失
    const adminCustomers = await customerService.listCustomersService(adminCtx, { status: "all" });
    expect(adminCustomers.items.some((c) => c.id === publicCustomerId)).toBe(true);

    // 管理员获取公海客户详情，确保正常返回无报错
    const adminCustomerDetail = await customerService.getCustomerDetailService(adminCtx, publicCustomerId);
    expect(adminCustomerDetail.customer.id).toBe(publicCustomerId);
    expect(adminCustomerDetail.customer.ownerName).toBe("公海/待分配");
  });

  it("2. 流转与分配链路测试：公海认领/指派 → 状态跃迁 → 电话跟进 → 确立合格 → 转客户与商机 → 推进赢单", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };

    // 1. 创建未分配线索
    const newLead = await leadsService.createLeadService(adminCtx, {
      contactName: "闭环流转测试人",
      contactPhone: "13788889999",
      contactEmail: "flow@enterprise.com",
      companyName: "闭环流转企业",
      title: "信息化负责人",
      note: "急需 CRM 系统解决销售飞单问题",
    });
    const leadId = newLead.leadId!;
    expect(leadId).toBeDefined();

    // 2. 销售主管将线索指派给 销售1
    await leadsService.assignLeadService(adminCtx, leadId, sales1Id);
    const assignedLead = await leadsService.getLeadDetailService(adminCtx, leadId);
    expect(assignedLead.lead.ownerUserId).toBe(sales1Id);
    expect(assignedLead.lead.status).toBe("NEW");

    // 3. 销售1 进行首次电话跟进 (CALL + INTERESTED)
    const activity = await followupService.logActivityService(sales1Ctx, {
      leadId,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "电话沟通 30 分钟，客户确认下周安排方案选型汇报",
    });
    expect(activity.activityId).toBeDefined();

    // 验证状态自动更新为 CONTACTED
    const contactedLead = await leadsService.getLeadDetailService(sales1Ctx, leadId);
    expect(contactedLead.lead.status).toBe("CONTACTED");

    // 4. 销售1 确认为合格线索 (QUALIFIED)
    await leadsService.qualifyLeadService(sales1Ctx, leadId, "需求真实，预算明确");
    const qualifiedLead = await leadsService.getLeadDetailService(sales1Ctx, leadId);
    expect(qualifiedLead.lead.status).toBe("QUALIFIED");

    // 5. 转为客户、联系人并创建首期商机 (Atomic Conversion)
    const converted = await customerService.convertLeadToCustomerService(sales1Ctx, {
      leadId,
      customerName: "闭环流转企业",
      customerType: "ENTERPRISE",
      industry: "企业服务",
      region: "华东",
      size: "101-500",
      contactName: "闭环流转测试人",
      contactPhone: "13788889999",
      contactEmail: "flow@enterprise.com",
      contactTitle: "信息化负责人",
      opportunityName: "2026 CRM 系统整体采购项目",
      expectedAmount: 360000,
      expectedCloseAt: new Date(Date.now() + 15 * 24 * 3600 * 1000),
      demandNote: "防飞单与销售协同需求",
    });

    expect(converted.customerId).toBeDefined();
    expect(converted.opportunityId).toBeDefined();

    // 验证线索已变为 CONVERTED
    const convLeadDetail = await leadsService.getLeadDetailService(adminCtx, leadId);
    expect(convLeadDetail.lead.status).toBe("CONVERTED");

    // 验证已转化线索能在 converted 筛选视图中查到
    const convertedView = await leadsService.listLeadsService(adminCtx, { filter: "converted" });
    expect(convertedView.items.some((i) => i.id === leadId)).toBe(true);

    // 6. 推进商机阶段：DISCOVERY → PROPOSAL → NEGOTIATION → WON
    const oppId = converted.opportunityId!;

    await opportunityService.advanceStageService(sales1Ctx, {
      opportunityId: oppId,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      note: "完成方案演示与报价提交",
    });

    await opportunityService.advanceStageService(sales1Ctx, {
      opportunityId: oppId,
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
      note: "进入商务合同与法务条款谈判",
    });

    // 最终赢单
    await opportunityService.winOpportunityService(sales1Ctx, {
      opportunityId: oppId,
      actualAmount: 350000,
      actualCloseAt: new Date(),
      note: "合同正式签署盖章回传",
    });

    const oppDetail = await opportunityService.getOpportunityDetailService(adminCtx, oppId);
    expect(oppDetail.opportunity.stage).toBe("WON");
    expect(Number(oppDetail.opportunity.actualAmount)).toBe(350000);

    // 7. 验证自动生成赢单复盘草稿
    const winReview = await winReviewService.getWinReviewService(adminCtx, oppId);
    expect(winReview).toBeDefined();
    expect(winReview?.status).toBe("DRAFT");
  });

  it("3. 线索放弃流转到公海及跨销售专员打捞重新激活", async () => {
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const sales2Ctx = { tenantId, userId: sales2Id, role: "SALES" as const };

    // 销售1 名下的线索
    const lead = await leadsService.createLeadService(sales1Ctx, {
      contactName: "流失边缘客户",
      contactPhone: "13566667777",
      companyName: "沉睡商贸有限公司",
    });
    const leadId = lead.leadId!;

    // 销售1 放弃线索流转至公海
    await leadsService.discardLeadService(sales1Ctx, {
      leadId,
      reason: "NO_NEED",
      note: "多次拨打未接听，退回公海池",
    });

    // 验证线索状态已变为 DISCARDED
    const discardedLead = await leadsService.getLeadDetailService(adminCtx, leadId);
    expect(discardedLead.lead.status).toBe("DISCARDED");

    // 验证销售2 可以在公海线索（待打捞）列表中看到该线索
    const unassignedView = await leadsService.listLeadsService(sales2Ctx, { filter: "unassigned" });
    expect(unassignedView.items.some((i) => i.id === leadId)).toBe(true);

    // 销售2 从公海主动打捞认领该线索
    await leadsService.assignLeadService(sales2Ctx, leadId, sales2Id);

    // 验证打捞后状态已自动恢复为 NEW，责任人变为销售2，并且生成了给销售2的跟进任务
    const reactivatedLead = await leadsService.getLeadDetailService(sales2Ctx, leadId);
    expect(reactivatedLead.lead.status).toBe("NEW");
    expect(reactivatedLead.lead.ownerUserId).toBe(sales2Id);
    expect(reactivatedLead.openTask).toBeDefined();
    expect(reactivatedLead.openTask?.assigneeUserId).toBe(sales2Id);
  });

  it("4. 客户档案直建、多联系人维护及主联系人智能切换", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };

    // 直接创建客户档案
    const created = await customerService.createCustomerDirectService(sales1Ctx, {
      name: "直接开拓集团客户",
      customerType: "ENTERPRISE",
      industry: "金融科技",
      region: "华南大区",
      size: "501-1000",
      contactName: "王总",
      contactPhone: "13699998888",
      contactTitle: "业务副总裁",
      contactEmail: "wang@fintech.com",
      contactRoleTag: "DECISION_MAKER",
    });
    const customerId = created.customerId;
    const initialContactId = created.contactId!;
    expect(customerId).toBeDefined();
    expect(initialContactId).toBeDefined();

    // 客户档案增加第 2 位联系人（采购经理）
    const addedContact = await customerService.addContactService(sales1Ctx, {
      customerId,
      name: "李采购",
      phone: "13699997777",
      title: "采购总监",
      roleTag: "PROCUREMENT",
      email: "procurement@fintech.com",
    });
    const secondContactId = addedContact.contactId;

    // 切换主联系人为李采购
    await customerService.setPrimaryContactService(sales1Ctx, customerId, secondContactId);

    // 验证主联系人已成功切换
    const detail = await customerService.getCustomerDetailService(sales1Ctx, customerId);
    expect(detail.customer.primaryContactName).toBe("李采购");
    expect(detail.customer.primaryContactPhone).toBe("13699997777");
  });

  it("5. 商机输单归因流转与风控合规校验", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };

    // 创建测试客户与商机
    const customer = await customerService.createCustomerDirectService(sales1Ctx, {
      name: "竞品对比科技",
      customerType: "ENTERPRISE",
      industry: "新能源",
      region: "华中",
      size: "101-500",
      contactName: "赵工",
      contactPhone: "13511114444",
      contactTitle: "技术选型人",
      contactRoleTag: "TECH_EVALUATOR",
    });

    const opp = await opportunityService.createOpportunityService(sales1Ctx, {
      customerId: customer.customerId,
      primaryContactId: customer.contactId!,
      name: "电池产线 MES 对接商机",
      stage: "DISCOVERY",
      expectedAmount: 180000,
      expectedCloseAt: new Date(Date.now() + 20 * 24 * 3600 * 1000),
    });
    const oppId = opp.opportunityId;

    // 推进到 PROPOSAL
    await opportunityService.advanceStageService(sales1Ctx, {
      opportunityId: oppId,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      note: "提交产线接入方案",
    });

    // 输单（选择竞品原因 COMPETITOR 并注明具体友商）
    await opportunityService.loseOpportunityService(sales1Ctx, {
      opportunityId: oppId,
      reason: "COMPETITOR",
      note: "客户最终因历史硬件兼容性选用了原有设备提供商系统",
    });

    // 验证商机状态已变为 LOST
    const oppDetail = await opportunityService.getOpportunityDetailService(sales1Ctx, oppId);
    expect(oppDetail.opportunity.stage).toBe("LOST");
    expect(oppDetail.opportunity.lostReason).toBe("COMPETITOR");
    expect(oppDetail.opportunity.lostNote).toContain("硬件兼容性");
  });

  it("6. 线索初始意向产品、预估预算与需求痛点录入、更新与转化联动", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };

    // 1. 创建带有意向产品、预算与业务痛点的初始线索
    const created = await leadsService.createLeadService(sales1Ctx, {
      contactName: "智能制造张总",
      contactPhone: "13977778888",
      companyName: "鼎盛重工制造有限公司",
      title: "首席信息官 CIO",
      intendedProduct: "企业旗舰版 (私有化部署)",
      budget: "20万-30万",
      note: "需要在 Q4 完成旧版 ERP 与新 CRM 的对接，要求支持 200 人并发",
    });
    expect(created.created).toBe(true);
    if (!created.created) return;

    // 2. 读取线索详情，核实意向产品与预算已正确持久化
    const detail = await leadsService.getLeadDetailService(sales1Ctx, created.leadId);
    expect(detail.lead.intendedProduct).toBe("企业旗舰版 (私有化部署)");
    expect(detail.lead.budget).toBe("20万-30万");
    expect(detail.lead.note).toContain("旧版 ERP 与新 CRM 的对接");

    // 3. 列表查询，验证 intendedProduct 与 budget 正确返回
    const list = await leadsService.listLeadsService(sales1Ctx, { search: "13977778888" });
    const match = list.items.find((i) => i.id === created.leadId);
    expect(match).toBeDefined();
    expect(match?.intendedProduct).toBe("企业旗舰版 (私有化部署)");
    expect(match?.budget).toBe("20万-30万");

    // 4. 销售跟进核实后更新意向产品与预算
    await leadsService.updateLeadService(sales1Ctx, created.leadId, {
      intendedProduct: "企业旗舰版 + 定制 API 套件",
      budget: "350000",
      note: "已与张总电话核实，增加定制 API 接口模块，预算上调至 35 万",
    });

    const updatedDetail = await leadsService.getLeadDetailService(sales1Ctx, created.leadId);
    expect(updatedDetail.lead.intendedProduct).toBe("企业旗舰版 + 定制 API 套件");
    expect(updatedDetail.lead.budget).toBe("350000");
    expect(updatedDetail.lead.note).toContain("预算上调至 35 万");

    // 5. 销售跟进触达（NEW ➔ CONTACTED），然后确认需求 (QUALIFY) 并转化为客户和商机
    await followupService.logActivityService(sales1Ctx, {
      leadId: created.leadId,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "电话详细沟通需求与定制接口范围，客户确认立项意向",
    });

    await leadsService.qualifyLeadService(sales1Ctx, created.leadId, "张总已核实确认功能范围与立项意向");

    const conversionRes = await customerService.convertLeadToCustomerService(sales1Ctx, {
      leadId: created.leadId,
      customerType: "ENTERPRISE",
      customerName: "鼎盛重工制造有限公司",
      contactName: updatedDetail.lead.contactName,
      contactPhone: updatedDetail.lead.contactPhone,
      contactTitle: updatedDetail.lead.title || undefined,
      contactRoleTag: "DECISION_MAKER",
      opportunityName: "鼎盛重工-企业旗舰版与API定制项目",
      expectedAmount: Number(updatedDetail.lead.budget),
      expectedCloseAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      demandNote: updatedDetail.lead.note || "客户明确采购意向与立项需求",
    });

    expect(conversionRes.customerId).toBeDefined();
    expect(conversionRes.opportunityId).toBeDefined();

    // 6. 验证商机已正确继承预算金额与业务诉求
    const oppDetail = await opportunityService.getOpportunityDetailService(sales1Ctx, conversionRes.opportunityId!);
    expect(Number(oppDetail.opportunity.expectedAmount)).toBe(350000);
    expect(oppDetail.opportunity.demandNote).toContain("预算上调至 35 万");

    // 7. 已转化线索详情不应再返回行动引导类卡片数据
    // （匹配存量客户/撞单预警/疑似重复合并——转化后这些卡要么指向自己
    //  转出的客户造成误导，要么点击必被服务端拒绝）
    const convertedDetail = await leadsService.getLeadDetailService(sales1Ctx, created.leadId);
    expect(convertedDetail.lead.status).toBe("CONVERTED");
    expect(convertedDetail.convertedCustomer?.id).toBe(conversionRes.customerId);
    expect(convertedDetail.existingCustomerMatch).toBeNull();
    expect(convertedDetail.restrictedCustomerMatch).toBe(false);
    expect(convertedDetail.possibleDuplicates).toEqual([]);
  });

  it("7. 意向产品归属校验：不可引用其他租户的产品", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };

    // 在"另一个租户"里建一个产品
    const otherTenant = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('意向产品跨租户测试') returning id",
    );
    const otherTenantId = otherTenant.rows[0].id;
    await owner.query(
      `insert into users (tenant_id, email, password_hash, name, role)
       values ($1, $2, 'hash', '外部租户管理员', 'ADMIN')`,
      [otherTenantId, `other-admin-${Date.now()}@example.com`],
    );
    const otherProduct = await owner.query<{ id: string }>(
      `insert into products (tenant_id, code, name, category, unit, unit_price, pricing_model, status)
       values ($1, 'OTHER-001', '外部租户专属产品', '外部类别', '套', 100000, 'ONE_TIME', 'ACTIVE') returning id`,
      [otherTenantId],
    );

    try {
      // 用本租户身份创建线索，但意向产品指向外部租户的产品 → 必须被拒绝
      await expect(
        leadsService.createLeadService(sales1Ctx, {
          contactName: "跨租户产品测试",
          contactPhone: "13966667777",
          intendedProductId: otherProduct.rows[0].id,
          intendedProduct: "外部租户专属产品",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      // 更新路径同样拒绝
      const mine = await leadsService.createLeadService(sales1Ctx, {
        contactName: "本租户正常线索",
        contactPhone: "13966667778",
      });
      if (mine.created) {
        await expect(
          leadsService.updateLeadService(sales1Ctx, mine.leadId, {
            intendedProductId: otherProduct.rows[0].id,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }
    } finally {
      await owner.query("delete from products where tenant_id = $1", [otherTenantId]);
      await owner.query("delete from users where tenant_id = $1", [otherTenantId]);
      await owner.query("delete from tenants where id = $1", [otherTenantId]);
    }
  });

  it("8. 商机归属转移：管理员可改派给其他销售，销售无权操作，终态商机锁定", async () => {
    const sales1Ctx = { tenantId, userId: sales1Id, role: "SALES" as const };
    const adminCtx = { tenantId, userId: adminId, role: "ADMIN" as const };

    // sales1 名下客户 + 商机
    const customer = await customerService.createCustomerDirectService(sales1Ctx, {
      name: "多产品线分派科技",
      customerType: "ENTERPRISE",
      contactName: "孙总",
      contactPhone: "13633334444",
    });
    const opp = await opportunityService.createOpportunityService(sales1Ctx, {
      customerId: customer.customerId,
      primaryContactId: customer.contactId!,
      name: "新产品线首单商机",
      stage: "DISCOVERY",
      expectedAmount: 90000,
    });

    // 1. 销售不能转移（哪怕是自己的商机）——归属调整是管理动作
    await expect(
      opportunityService.transferOpportunityService(sales1Ctx, opp.opportunityId, sales2Id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 2. 管理员转移给 sales2（带原因与交接说明）：成功，归属变更，客户归属不动
    const res = await opportunityService.transferOpportunityService(adminCtx, opp.opportunityId, sales2Id, {
      reason: "MULTI_PRODUCT_COLLAB",
      note: "转交华东产品线负责",
    });
    expect(res.opportunityId).toBe(opp.opportunityId);
    expect(res.fromOwnerUserId).toBe(sales1Id);
    expect(res.toOwnerUserId).toBe(sales2Id);

    const oppOwner = await owner.query("select owner_user_id::text from opportunities where id = $1", [opp.opportunityId]);
    expect(oppOwner.rows[0].owner_user_id).toBe(sales2Id);
    // 客户归属不随商机转移（客户还是 sales1 的）
    const custOwner = await owner.query("select owner_user_id::text from customers where id = $1", [customer.customerId]);
    expect(custOwner.rows[0].owner_user_id).toBe(sales1Id);

    // 3. 幂等：转给当前归属人 = no-op 成功
    const again = await opportunityService.transferOpportunityService(adminCtx, opp.opportunityId, sales2Id);
    expect(again.toOwnerUserId).toBe(sales2Id);

    // 4. 目标用户不存在 → 拒绝
    await expect(
      opportunityService.transferOpportunityService(adminCtx, opp.opportunityId, "00000000-0000-4000-8000-00000000dead"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // 5. 终态商机锁定：赢单后归属不可转移（业绩定案，转移=篡改业绩）
    await opportunityService.advanceStageService({ tenantId, userId: sales2Id, role: "SALES" }, {
      opportunityId: opp.opportunityId,
      fromStage: "DISCOVERY",
      toStage: "PROPOSAL",
      note: "方案已提交",
    });
    await opportunityService.advanceStageService({ tenantId, userId: sales2Id, role: "SALES" }, {
      opportunityId: opp.opportunityId,
      fromStage: "PROPOSAL",
      toStage: "NEGOTIATION",
      note: "进入商务谈判",
    });
    await opportunityService.winOpportunityService({ tenantId, userId: sales2Id, role: "SALES" }, {
      opportunityId: opp.opportunityId,
      actualAmount: 88000,
      actualCloseAt: new Date(),
    });
    await expect(
      opportunityService.transferOpportunityService(adminCtx, opp.opportunityId, sales1Id),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    // 6. 审计留痕：转移动作可追溯（包含 fromOwner, toOwner, reason, note）
    const auditRows = await owner.query(
      "select detail::text from audit_logs where tenant_id = $1 and subject_id = $2 and action = 'opportunity.transfer' order by created_at desc limit 1",
      [tenantId, opp.opportunityId],
    );
    expect(auditRows.rows.length).toBe(1);
    expect(auditRows.rows[0].detail).toContain(sales1Id);
    expect(auditRows.rows[0].detail).toContain(sales2Id);
    expect(auditRows.rows[0].detail).toContain("MULTI_PRODUCT_COLLAB");
    expect(auditRows.rows[0].detail).toContain("转交华东产品线负责");
  });
});
