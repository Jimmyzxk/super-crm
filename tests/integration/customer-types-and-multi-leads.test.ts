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
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesId: string;

describe("单位/个人双轨客户体系、多线索关联与决策链多联系人集成测试", () => {
  beforeAll(async () => {
    await owner.connect();
    leadsService = await import("@/core/leads/service");
    followupService = await import("@/core/followup/service");
    customerService = await import("@/core/customer/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('双轨客户体系测试租户') returning id`);
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();
    const salesRes = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, $3, '业务销售', 'SALES') returning id`, [tenantId, `sales-multi-${ts}@example.com`, pw]);
    salesId = salesRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from sales_insights where tenant_id = $1", [tenantId]);
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
      await owner.query("delete from activities where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunity_stage_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_conversions where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
      await owner.query("update leads set customer_id = null where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("1. 能够创建单位客户并指定关键决策人（DECISION_MAKER）", async () => {
    const ctx = { tenantId, userId: salesId, role: "SALES" as const };
    const leadRes = await leadsService.createLeadService(ctx, {
      contactName: "李总（董事长）",
      contactPhone: "13800001111",
      contactEmail: "ceo@corp-alpha.com",
      companyName: "阿尔法重工科技有限公司",
      title: "董事长",
    });

    await followupService.logActivityService(ctx, {
      leadId: leadRes.leadId!,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "首次电话沟通，客户意向明确",
    });
    await leadsService.qualifyLeadService(ctx, leadRes.leadId!, "需求已确认");

    const convertRes = await customerService.convertLeadToCustomerService(ctx, {
      leadId: leadRes.leadId!,
      customerType: "ENTERPRISE",
      customerName: "阿尔法重工科技有限公司",
      industry: "智能制造",
      region: "华东/上海",
      size: "101-500",
      contactName: "李总（董事长）",
      contactPhone: "13800001111",
      contactEmail: "ceo@corp-alpha.com",
      contactTitle: "董事长",
      contactRoleTag: "DECISION_MAKER",
      opportunityName: "阿尔法一期自动化改造项目",
      expectedAmount: 15000000,
      expectedCloseAt: new Date(Date.now() + 30 * 86400000),
      demandNote: "一期全自动改造采购方案",
    });

    expect(convertRes.customerId).toBeDefined();
    expect(convertRes.opportunityId).toBeDefined();

    const detail = await customerService.getCustomerDetailService(ctx, convertRes.customerId);
    expect(detail.customer.customerType).toBe("ENTERPRISE");
    expect(detail.customer.name).toBe("阿尔法重工科技有限公司");
    expect(detail.contacts.length).toBe(1);
    expect(detail.contacts[0].roleTag).toBe("DECISION_MAKER");
    expect(detail.contacts[0].isPrimary).toBe(true);
    expect(detail.sourceLeads.length).toBe(1);
    expect(detail.sourceLeads[0].name).toBe("李总（董事长）");
    expect(detail.sourceLeads[0].opportunityName).toBe("阿尔法一期自动化改造项目");
  });

  it("2. 能够创建个人客户主体（INDIVIDUAL）", async () => {
    const ctx = { tenantId, userId: salesId, role: "SALES" as const };
    const leadRes = await leadsService.createLeadService(ctx, {
      contactName: "王独立投资人",
      contactPhone: "13900002222",
      contactEmail: "wang@vip-invest.com",
      title: "独立顾问",
    });

    await followupService.logActivityService(ctx, {
      leadId: leadRes.leadId!,
      type: "MESSAGE",
      outcome: "INTERESTED",
      summary: "微信沟通，投资人需求清晰",
    });
    await leadsService.qualifyLeadService(ctx, leadRes.leadId!, "需求已确认");

    const convertRes = await customerService.convertLeadToCustomerService(ctx, {
      leadId: leadRes.leadId!,
      customerType: "INDIVIDUAL",
      customerName: "王独立投资人 (VIP客户)",
      region: "华北/北京",
      contactName: "王独立投资人",
      contactPhone: "13900002222",
      contactEmail: "wang@vip-invest.com",
      contactRoleTag: "DECISION_MAKER",
      opportunityName: "个人量化交易专属服务",
      expectedAmount: 5000000,
      expectedCloseAt: new Date(Date.now() + 30 * 86400000),
      demandNote: "个人VIP专属量化系统服务",
    });

    const detail = await customerService.getCustomerDetailService(ctx, convertRes.customerId);
    expect(detail.customer.customerType).toBe("INDIVIDUAL");
    expect(detail.customer.name).toBe("王独立投资人 (VIP客户)");
    expect(detail.contacts[0].roleTag).toBe("DECISION_MAKER");
  });

  it("3. 同一单位客户接入新线索时，支持追加技术评估人（TECH_EVALUATOR）与新商机", async () => {
    const ctx = { tenantId, userId: salesId, role: "SALES" as const };

    // 获取现有阿尔法重工客户
    const list = await customerService.listCustomersService(ctx, { search: "阿尔法重工" });
    expect(list.items.length).toBe(1);
    const alphaCustomer = list.items[0];
    expect(alphaCustomer.customerType).toBe("ENTERPRISE");

    // 来自阿尔法重工的新线索（技术负责人发起的二期线索）
    const lead2Res = await leadsService.createLeadService(ctx, {
      contactName: "张工（技术总监）",
      contactPhone: "13800003333",
      contactEmail: "tech@corp-alpha.com",
      companyName: "阿尔法重工科技有限公司",
      title: "CTO / 技术总监",
    });

    await followupService.logActivityService(ctx, {
      leadId: lead2Res.leadId!,
      type: "MEETING",
      outcome: "INTERESTED",
      summary: "技术选型研讨会顺利",
    });
    await leadsService.qualifyLeadService(ctx, lead2Res.leadId!, "需求已确认");

    // 关联到已有客户并立项二期商机
    const convert2Res = await customerService.convertLeadToCustomerService(ctx, {
      leadId: lead2Res.leadId!,
      linkToExistingCustomerId: alphaCustomer.id,
      customerName: alphaCustomer.name,
      contactName: "张工（技术总监）",
      contactPhone: "13800003333",
      contactEmail: "tech@corp-alpha.com",
      contactTitle: "CTO / 技术总监",
      contactRoleTag: "TECH_EVALUATOR",
      opportunityName: "阿尔法二期工业大脑算法研发项目",
      expectedAmount: 30000000,
      expectedCloseAt: new Date(Date.now() + 60 * 86400000),
      demandNote: "二期算法与算力平台采购",
    });

    expect(convert2Res.customerId).toBe(alphaCustomer.id);

    // 再次手动添加采购决策人（PROCUREMENT）
    const contact3Res = await customerService.addContactService(ctx, {
      customerId: alphaCustomer.id,
      name: "孙经理（商务采购部）",
      phone: "13800004444",
      email: "procurement@corp-alpha.com",
      title: "采购总监",
      roleTag: "PROCUREMENT",
    });
    expect(contact3Res.contactId).toBeDefined();

    // 验证客户360详情
    const detail = await customerService.getCustomerDetailService(ctx, alphaCustomer.id);
    expect(detail.contacts.length).toBe(3);

    const roles = detail.contacts.map((c) => ({ name: c.name, role: c.roleTag }));
    expect(roles).toContainEqual({ name: "李总（董事长）", role: "DECISION_MAKER" });
    expect(roles).toContainEqual({ name: "张工（技术总监）", role: "TECH_EVALUATOR" });
    expect(roles).toContainEqual({ name: "孙经理（商务采购部）", role: "PROCUREMENT" });

    // 验证关联线索全景历程
    expect(detail.sourceLeads.length).toBe(2);
    const sourceLeadNames = detail.sourceLeads.map((s) => s.name);
    expect(sourceLeadNames).toContain("李总（董事长）");
    expect(sourceLeadNames).toContain("张工（技术总监）");

    // 验证商机列表
    expect(detail.opportunities.length).toBe(2);
    const oppNames = detail.opportunities.map((o) => o.name);
    expect(oppNames).toContain("阿尔法一期自动化改造项目");
    expect(oppNames).toContain("阿尔法二期工业大脑算法研发项目");
  });

  it("4. 能够修改联系人决策角色与修改客户类型", async () => {
    const ctx = { tenantId, userId: salesId, role: "SALES" as const };
    const list = await customerService.listCustomersService(ctx, { search: "阿尔法重工" });
    const alphaCustomer = list.items[0];
    const detail = await customerService.getCustomerDetailService(ctx, alphaCustomer.id);

    const procurementContact = detail.contacts.find((c) => c.roleTag === "PROCUREMENT")!;
    await customerService.updateContactService(ctx, {
      contactId: procurementContact.id,
      roleTag: "FINANCE",
      title: "财务与采购总监",
    });

    const updatedDetail = await customerService.getCustomerDetailService(ctx, alphaCustomer.id);
    const updatedContact = updatedDetail.contacts.find((c) => c.id === procurementContact.id)!;
    expect(updatedContact.roleTag).toBe("FINANCE");
    expect(updatedContact.title).toBe("财务与采购总监");
  });
});
