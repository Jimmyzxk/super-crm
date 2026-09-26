import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

let customerService: typeof import("@/core/customer/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let salesAId: string;
let salesBId: string;
let ctxSalesA: TenantContext;
let ctxSalesB: TenantContext;

describe("联系人人脉库与公海/私海流转联动 (Contacts Global & Public Pool Lifecycle)", () => {
  beforeAll(async () => {
    await owner.connect();
    customerService = await import("@/core/customer/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('联系人生命周期测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const uA = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售A', 'SALES') returning id",
      [tenantId, `sales-a-${ts}@example.com`],
    );
    salesAId = uA.rows[0].id;

    const uB = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售B', 'SALES') returning id",
      [tenantId, `sales-b-${ts}@example.com`],
    );
    salesBId = uB.rows[0].id;

    const uM = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售主管', 'MANAGER') returning id",
      [tenantId, `mgr-${ts}@example.com`],
    );
    void uM.rows[0].id; // 主管账号仅占位（本用例不使用其上下文）

    ctxSalesA = { tenantId, userId: salesAId, role: "SALES" };
    ctxSalesB = { tenantId, userId: salesBId, role: "SALES" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from contacts where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("当客户在公海时，名下联系人自动属于公海联系人池，销售A私海看不到，公海池可见", async () => {
    // 1. 创建一个公海客户 (owner_user_id = null)
    const custRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '公海智能制造公司', 'ENTERPRISE', null) returning id",
      [tenantId],
    );
    const customerId = custRes.rows[0].id;

    // 2. 添加该客户的联系人（如采购总监和技术EB）
    await owner.query(
      "insert into contacts (tenant_id, customer_id, name, phone, title, role_tag, is_primary) values ($1, $2, '张采购', '13800000001', '采购总监', 'PROCUREMENT', true)",
      [tenantId, customerId],
    );
    await owner.query(
      "insert into contacts (tenant_id, customer_id, name, phone, title, role_tag, is_primary) values ($1, $2, '李CTO', '13800000002', '技术副总裁', 'DECISION_MAKER', false)",
      [tenantId, customerId],
    );

    // 3. 销售A查看私海联系人 -> 应为 0 条
    const myContactsA = await customerService.listGlobalContactsService(ctxSalesA, { scope: "MY" });
    expect(myContactsA.filter((c) => c.customerId === customerId)).toHaveLength(0);

    // 4. 销售A查看公海联系人 -> 应有 2 条，且 inPublicPool = true
    const publicContacts = await customerService.listGlobalContactsService(ctxSalesA, { scope: "PUBLIC" });
    const matchPublic = publicContacts.filter((c) => c.customerId === customerId);
    expect(matchPublic).toHaveLength(2);
    expect(matchPublic[0].inPublicPool).toBe(true);
    expect(matchPublic[0].customerOwnerUserId).toBeNull();
  });

  it("销售A从公海认领该客户后，客户名下全部联系人自动划拨至销售A的私海池", async () => {
    const custRes = await owner.query<{ id: string }>(
      "select id from customers where tenant_id = $1 and name = '公海智能制造公司'",
      [tenantId],
    );
    const customerId = custRes.rows[0].id;

    // 销售A认领客户
    const claimRes = await customerService.claimCustomerService(ctxSalesA, customerId);
    expect(claimRes.claimed).toBe(true);

    // 销售A再次查询私海联系人 -> 自动出现 2 个联系人
    const myContactsA = await customerService.listGlobalContactsService(ctxSalesA, { scope: "MY" });
    const matchA = myContactsA.filter((c) => c.customerId === customerId);
    expect(matchA).toHaveLength(2);
    expect(matchA[0].inPublicPool).toBe(false);
    expect(matchA[0].customerOwnerUserId).toBe(salesAId);

    // 销售B查看私海联系人 -> 无法看到销售A的联系人
    const myContactsB = await customerService.listGlobalContactsService(ctxSalesB, { scope: "MY" });
    expect(myContactsB.filter((c) => c.customerId === customerId)).toHaveLength(0);

    // 公海池中不再包含该客户的联系人
    const publicContacts = await customerService.listGlobalContactsService(ctxSalesA, { scope: "PUBLIC" });
    expect(publicContacts.filter((c) => c.customerId === customerId)).toHaveLength(0);
  });

  it("销售A主动将客户退回公海，名下所有联系人自动重新进入公海池", async () => {
    const custRes = await owner.query<{ id: string }>(
      "select id from customers where tenant_id = $1 and name = '公海智能制造公司'",
      [tenantId],
    );
    const customerId = custRes.rows[0].id;

    // 销售A释放客户回公海
    const relRes = await customerService.releaseCustomerToPoolService(ctxSalesA, customerId);
    expect(relRes.released).toBe(true);

    // 销售A私海已无该联系人
    const myContactsA = await customerService.listGlobalContactsService(ctxSalesA, { scope: "MY" });
    expect(myContactsA.filter((c) => c.customerId === customerId)).toHaveLength(0);

    // 公海池重新出现 2 个联系人
    const publicContacts = await customerService.listGlobalContactsService(ctxSalesB, { scope: "PUBLIC" });
    const matchPublic = publicContacts.filter((c) => c.customerId === customerId);
    expect(matchPublic).toHaveLength(2);
    expect(matchPublic[0].inPublicPool).toBe(true);
  });

  it("商机归属规则：客户名下有他人跟进中的未成交商机时不可被认领/释放", async () => {
    // 公海客户 W，销售B 名下挂着一个在途商机（模拟存量数据/协作场景）
    const wRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '在途商机客户W', 'ENTERPRISE', null) returning id",
      [tenantId],
    );
    const wId = wRes.rows[0].id;
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, 'B跟进中的项目', 'PROPOSAL', 5000000)",
      [tenantId, wId, salesBId],
    );

    // 销售A 认领被拒：有他人未成交商机
    await expect(customerService.claimCustomerService(ctxSalesA, wId)).rejects.toMatchObject({ code: "CONFLICT" });

    // 对称：销售B 把自己的私海客户（名下有他人商机）释放到公海也被拒
    const vRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '私海在途客户V', 'ENTERPRISE', $2) returning id",
      [tenantId, salesBId],
    );
    const vId = vRes.rows[0].id;
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, 'A参与协作的项目', 'DISCOVERY', 3000000)",
      [tenantId, vId, salesAId],
    );
    await expect(customerService.releaseCustomerToPoolService(ctxSalesB, vId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("商机归属规则：认领只接手客户档案，WON 业绩归属永不变化", async () => {
    // 公海客户 U：销售B 的历史赢单（客户已到期回公海，业绩仍归 B）
    const uRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '赢单客户U', 'ENTERPRISE', null) returning id",
      [tenantId],
    );
    const uId = uRes.rows[0].id;
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount, actual_amount, actual_close_at) values ($1, $2, $3, 'B的历史赢单', 'WON', 8000000, 8000000, now() - interval '30 days')",
      [tenantId, uId, salesBId],
    );

    // 销售A 认领成功
    const claimRes = await customerService.claimCustomerService(ctxSalesA, uId);
    expect(claimRes.claimed).toBe(true);

    const won = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from opportunities where customer_id = $1 and stage = 'WON'", [uId],
    );
    // WON 商机仍归销售B（业绩归属不跟着客户跑）
    expect(won.rows[0].owner_user_id).toBe(salesBId);

    // 释放时 WON 归属同样不动
    await customerService.releaseCustomerToPoolService(ctxSalesA, uId);
    const wonAfter = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from opportunities where customer_id = $1 and stage = 'WON'", [uId],
    );
    expect(wonAfter.rows[0].owner_user_id).toBe(salesBId);
  });

  it("商机归属规则：客户名下有自己的在途商机时同样不可释放进公海", async () => {
    // 销售A 的私海客户，名下有自己的在途商机
    const xRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, customer_type, owner_user_id) values ($1, '自在途客户X', 'ENTERPRISE', $2) returning id",
      [tenantId, salesAId],
    );
    const xId = xRes.rows[0].id;
    await owner.query(
      "insert into opportunities (tenant_id, customer_id, owner_user_id, name, stage, expected_amount) values ($1, $2, $3, 'A自己的在途项目', 'PROPOSAL', 6000000)",
      [tenantId, xId, salesAId],
    );

    await expect(customerService.releaseCustomerToPoolService(ctxSalesA, xId)).rejects.toMatchObject({ code: "CONFLICT" });
    // 客户仍在销售A私海（未释放）
    const cust = await owner.query<{ owner_user_id: string | null }>(
      "select owner_user_id from customers where id = $1", [xId],
    );
    expect(cust.rows[0].owner_user_id).toBe(salesAId);
  });

  it("全域联系人人脉库脱敏：按 security_compliance_configs 对非属主销售掩码手机与邮箱", async () => {
    // 开启脱敏配置
    await owner.query(
      `insert into security_compliance_configs (tenant_id, is_phone_masking_enabled, is_email_masking_enabled)
       values ($1, true, true)
       on conflict (tenant_id) do update set
         is_phone_masking_enabled = true,
         is_email_masking_enabled = true`,
      [tenantId],
    );

    // 销售A 创建一个客户与联系人
    const custRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, owner_user_id) values ($1, '脱敏测试客户', $2) returning id",
      [tenantId, salesAId],
    );
    const contactRes = await owner.query<{ id: string }>(
      `insert into contacts (tenant_id, customer_id, name, phone, email, is_primary)
       values ($1, $2, '联系人赵六', '13812345678', 'zhaoliu@example.com', true) returning id`,
      [tenantId, custRes.rows[0].id],
    );
    const contactId = contactRes.rows[0].id;

    // 属主销售A 查询 -> 手机与邮箱为明文
    const listA = await customerService.listGlobalContactsService(ctxSalesA);
    const itemA = listA.find((c) => c.id === contactId);
    expect(itemA?.phone).toBe("13812345678");
    expect(itemA?.email).toBe("zhaoliu@example.com");

    // 非属主销售B 查询 -> 手机与邮箱被脱敏掩码
    const listB = await customerService.listGlobalContactsService(ctxSalesB);
    const itemB = listB.find((c) => c.id === contactId);
    expect(itemB).toBeDefined();
    expect(itemB?.phone).toBe("138****5678");
    expect(itemB?.email).toBe("zh***u@example.com");
  });
});
