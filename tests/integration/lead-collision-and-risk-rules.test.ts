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
let salesAId: string;
let salesBId: string;
let managerId: string;

describe("多渠道进线风险与冲突判定规则集成测试", () => {
  beforeAll(async () => {
    await owner.connect();
    leadsService = await import("@/core/leads/service");
    followupService = await import("@/core/followup/service");
    customerService = await import("@/core/customer/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tenantRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('进线风险与冲突测试租户') returning id`);
    tenantId = tenantRes.rows[0].id;

    const pw = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
    const ts = Date.now();
    const [salesARes, salesBRes, mgrRes] = await Promise.all([
      owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
        values ($1, $2, $3, '销售专员张三', 'SALES') returning id`, [tenantId, `sales-a-${ts}@example.com`, pw]),
      owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
        values ($1, $2, $3, '销售专员李四', 'SALES') returning id`, [tenantId, `sales-b-${ts}@example.com`, pw]),
      owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
        values ($1, $2, $3, '销售主管王总', 'MANAGER') returning id`, [tenantId, `mgr-${ts}@example.com`, pw]),
    ]);
    salesAId = salesARes.rows[0].id;
    salesBId = salesBRes.rows[0].id;
    managerId = mgrRes.rows[0].id;
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
      await owner.query("delete from lead_intake_requests where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_source_keys where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await owner.end();
    await closeDb();
  });

  it("规则 1：销售手动录入撞单检测——他人私海活跃线索应被强阻断", async () => {
    const ctxA = { tenantId, userId: salesAId, role: "SALES" as const };
    const ctxB = { tenantId, userId: salesBId, role: "SALES" as const };

    // 销售 A 录入线索
    const createdA = await leadsService.createLeadService(ctxA, {
      contactName: "陈总",
      contactPhone: "13800112233",
      companyName: "先锋科技有限公司",
    });
    expect(createdA.created).toBe(true);

    // 销售 B 尝试录入相同手机号 -> 强阻断抛出 CONFLICT
    await expect(
      leadsService.createLeadService(ctxB, {
        contactName: "陈总2",
        contactPhone: "13800112233",
        companyName: "先锋科技",
      }),
    ).rejects.toThrow("该线索已由销售「销售专员张三」跟进中");

    // 销售 A 自己尝试录入相同手机号 -> 提示名下已有并返回 collision
    const selfRes = await leadsService.createLeadService(ctxA, {
      contactName: "陈总自己",
      contactPhone: "13800112233",
    });
    expect(selfRes.created).toBe(false);
    expect(selfRes.collision?.collisionType).toBe("SELF_LEAD");
  });

  it("规则 2：销售手动录入公海待分配线索——提示并支持一键认领", async () => {
    const ctxSalesB = { tenantId, userId: salesBId, role: "SALES" as const };

    // 插入一条在公海待分配的线索
    const insertRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, contact_phone, company_name, source, status)
      values ($1, '公海客户林总', '13900223344', '公海制造厂', 'manual', 'NEW')
      returning id
    `, [tenantId]);
    const publicLeadId = insertRes.rows[0].id;

    // 销售 B 录入该手机号 -> 返回 PUBLIC_POOL_LEAD 碰撞与可认领标记
    const collisionRes = await leadsService.createLeadService(ctxSalesB, {
      contactName: "林总",
      contactPhone: "13900223344",
      companyName: "公海制造厂",
    });
    expect(collisionRes.created).toBe(false);
    expect(collisionRes.collision?.collisionType).toBe("PUBLIC_POOL_LEAD");
    expect(collisionRes.collision?.canClaim).toBe(true);
    expect(collisionRes.collision?.leadId).toBe(publicLeadId);

    // 销售 B 执行 claimPublicLeadId 直接认领
    const claimRes = await leadsService.createLeadService(ctxSalesB, {
      contactName: "林总",
      contactPhone: "13900223344",
      companyName: "公海制造厂",
      claimPublicLeadId: publicLeadId,
    });
    expect(claimRes.created).toBe(true);
    expect(claimRes.claimed).toBe(true);

    // 验证线索 owner 已变为 salesB，且创建了首响任务
    const checkLead = await owner.query<{ owner_user_id: string }>(`select owner_user_id from leads where id = $1`, [publicLeadId]);
    expect(checkLead.rows[0].owner_user_id).toBe(salesBId);
    const checkTask = await owner.query(`select * from tasks where lead_id = $1 and assignee_user_id = $2`, [publicLeadId, salesBId]);
    expect(checkTask.rowCount).toBe(1);
  });

  it("规则 3：销售手动录入历史放弃流失线索——提示并支持一键重新激活", async () => {
    const ctxSalesA = { tenantId, userId: salesAId, role: "SALES" as const };

    // 插入一条已放弃的线索
    const insertRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, contact_phone, company_name, source, status, discard_reason, discard_note, owner_user_id)
      values ($1, '已放弃客户赵总', '13700334455', '历史流失企业', 'manual', 'DISCARDED', 'OTHER', '无意向', null)
      returning id
    `, [tenantId]);
    const discardedLeadId = insertRes.rows[0].id;

    // 销售 A 录入该手机号 -> 返回 DISCARDED_LEAD 碰撞与可重激活标记
    const collisionRes = await leadsService.createLeadService(ctxSalesA, {
      contactName: "赵总",
      contactPhone: "13700334455",
      companyName: "历史流失企业",
    });
    expect(collisionRes.created).toBe(false);
    expect(collisionRes.collision?.collisionType).toBe("DISCARDED_LEAD");
    expect(collisionRes.collision?.canReactivate).toBe(true);

    // 销售 A 执行 reactivateLeadId 重新激活入私海
    const reactivateRes = await leadsService.createLeadService(ctxSalesA, {
      contactName: "赵总",
      contactPhone: "13700334455",
      companyName: "历史流失企业（二期）",
      reactivateLeadId: discardedLeadId,
    });
    expect(reactivateRes.created).toBe(true);
    expect(reactivateRes.reactivated).toBe(true);

    // 验证状态重置为 NEW，owner 变为 salesA，并生成了新的任务
    const checkLead = await owner.query<{ status: string; owner_user_id: string }>(`select status, owner_user_id from leads where id = $1`, [discardedLeadId]);
    expect(checkLead.rows[0].status).toBe("NEW");
    expect(checkLead.rows[0].owner_user_id).toBe(salesAId);
  });

  it("规则 4：销售手动录入已转正式客户联系人——强阻断撞客并引导至客户档案", async () => {
    const ctxSalesA = { tenantId, userId: salesAId, role: "SALES" as const };
    const ctxSalesB = { tenantId, userId: salesBId, role: "SALES" as const };

    // 销售 A 创建线索并转化为正式客户
    const leadRes = await leadsService.createLeadService(ctxSalesA, {
      contactName: "大客户孙总",
      contactPhone: "13600445566",
      companyName: "鼎盛集团",
    });
    if (!leadRes.created) throw new Error("建线索失败");
    await followupService.logActivityService(ctxSalesA, {
      leadId: leadRes.leadId,
      type: "CALL",
      outcome: "CONNECTED",
      summary: "确认意向",
    });
    await leadsService.qualifyLeadService(ctxSalesA, leadRes.leadId, "资质合格");
    const convertRes = await customerService.convertLeadToCustomerService(ctxSalesA, {
      leadId: leadRes.leadId,
      customerName: "鼎盛集团有限公司",
      customerType: "ENTERPRISE",
      opportunityName: "鼎盛集团一期采购",
      contactRoleTag: "DECISION_MAKER",
      contactName: "大客户孙总",
      contactPhone: "13600445566",
      expectedAmount: 100000,
      expectedCloseAt: new Date(Date.now() + 86400000 * 30),
      demandNote: "采购服务器",
    });
    expect(convertRes.customerId).toBeDefined();

    // 销售 B 尝试录入该客户的联系人手机号 -> 强阻断撞客
    await expect(
      leadsService.createLeadService(ctxSalesB, {
        contactName: "孙总",
        contactPhone: "13600445566",
        companyName: "鼎盛",
      }),
    ).rejects.toThrow("该联系人已归属于正式客户「鼎盛集团有限公司」");
  });

  it("规则 5：外部 API / 插件进线——命中已有线索时不丢单，安全入库并标记疑似重复", async () => {
    const ctxAdmin = { tenantId, userId: managerId, role: "ADMIN" as const };

    // 创建 API Key
    const keyRes = await leadsService.createLeadSourceKeyService(ctxAdmin, {
      name: "官网投放通道",
      sourceKey: "landing_web",
    });

    const tokenRow = await leadsService.lookupLeadSourceToken(keyRes.token);
    expect(tokenRow).not.toBeNull();

    // 1) 外部推送已转正式客户的手机号（孙总 13600445566）-> 安全拦截不产生脏数据
    const customerApiRes = await leadsService.createApiLeadService(
      tokenRow!,
      `idem-cust-${Date.now()}`,
      {
        contactName: "孙总二次进线",
        contactPhone: "13600445566",
        companyName: "鼎盛集团",
        externalId: "ext-ad-999",
      },
    );
    expect(customerApiRes.replay).toBe(false);
    expect(customerApiRes.duplicateSuspected).toBe(true);
    expect(customerApiRes.leadId).toBeNull();

    // 2) 外部推送公海已存在的手机号 -> 不丢单，安全入库并标记疑似重复
    await owner.query(`
      insert into leads (tenant_id, contact_name, contact_phone, company_name, source, status)
      values ($1, '公海老客户钱总', '13500889900', '蓝天科技', 'manual', 'NEW')
    `, [tenantId]);

    const poolApiRes = await leadsService.createApiLeadService(
      tokenRow!,
      `idem-pool-${Date.now()}`,
      {
        contactName: "钱总官网咨询",
        contactPhone: "13500889900",
        companyName: "蓝天科技",
        externalId: "ext-ad-1000",
      },
    );
    expect(poolApiRes.replay).toBe(false);
    expect(poolApiRes.duplicateSuspected).toBe(true);
    expect(poolApiRes.leadId).not.toBeNull();

    const checkLead = await owner.query<{ is_possible_duplicate: boolean }>(`select is_possible_duplicate from leads where id = $1`, [poolApiRes.leadId]);
    expect(checkLead.rows[0].is_possible_duplicate).toBe(true);
  });
});
