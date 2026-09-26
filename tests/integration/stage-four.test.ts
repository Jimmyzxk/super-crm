import "dotenv/config";
import pg from "pg";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toResult } from "@/core/shared/result";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("阶段 4 集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });
let tenantA: string;
let tenantB: string;
let salesA: string;
let salesB: string;
let managerA: string;
let salesTenantB: string;
const ctx = () => ({ tenantId: tenantA, userId: salesA, role: "SALES" as const });

async function user(tenantId: string, email: string, role: "SALES" | "MANAGER" = "SALES") {
  const result = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', $2, $3) returning id`, [tenantId, email, role]);
  return result.rows[0].id;
}

async function lead(status = "QUALIFIED", ownerId: string | null = salesA, phone = "13812345678") {
  const result = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, company_name, status)
    values ($1, $2, '阶段四联系人', $3, '阶段四公司', $4::lead_status) returning id`, [tenantA, ownerId, phone, status]);
  return result.rows[0].id;
}

async function customer(ownerId = salesA, name = "阶段四客户") {
  const result = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name) values ($1, $2, $3) returning id`, [tenantA, ownerId, name]);
  return result.rows[0].id;
}

async function contact(customerId: string, phone = "13912345678", primary = true) {
  const result = await owner.query<{ id: string }>(`insert into contacts (tenant_id, customer_id, name, phone, is_primary)
    values ($1, $2, '阶段四联系人', $3, $4) returning id`, [tenantA, customerId, phone, primary]);
  return result.rows[0].id;
}

beforeAll(async () => {
  await owner.connect();
  const tenants = await owner.query<{ id: string }>(`insert into tenants (name) values ('阶段四 A'), ('阶段四 B') returning id`);
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  salesA = await user(tenantA, `stage4-sales-${Date.now()}@example.com`);
  managerA = await user(tenantA, `stage4-manager-${Date.now()}@example.com`, "MANAGER");
  salesB = await user(tenantA, `stage4-sales-b-${Date.now()}@example.com`);
  salesTenantB = await user(tenantB, `stage4-other-${Date.now()}@example.com`);
  await app.connect();
}, 30000);

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await app.end();
  await owner.end();
});

describe("阶段 4 PostgreSQL 隔离与约束", () => {
  it("新业务表启用 RLS，未设上下文不可见，跨租户 ID 不可见", async () => {
    const customerId = await customer();
    const raw = await owner.query("select count(*) from customers where id = $1", [customerId]);
    expect(raw.rows[0].count).toBe("1");
    const { withTenant } = await import("@/core/tenant");
    const visible = await withTenant(tenantA, (tx) => tx.execute<{ id: string }>(sql`select id from customers where id = ${customerId}`));
    expect(visible.rows).toHaveLength(1);
    const hidden = await withTenant(tenantB, (tx) => tx.execute<{ id: string }>(sql`select id from customers where id = ${customerId}`));
    expect(hidden.rows).toHaveLength(0);
    const security = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('customers', 'contacts', 'opportunities', 'opportunity_stage_history') order by relname`);
    expect(security.rows).toHaveLength(4);
    expect(security.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const owners = await owner.query<{ relname: string; owner: string }>(`select c.relname, r.rolname as owner from pg_class c join pg_roles r on r.oid = c.relowner where c.relname in ('customers', 'contacts', 'opportunities', 'opportunity_stage_history') order by c.relname`);
    expect(owners.rows.every((row) => row.owner !== "salescrm")).toBe(true);
  });

  it("历史表拒绝 UPDATE/DELETE，contacts 拒绝物理 DELETE", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345674");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const opportunity = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "权限商机", stage: "DISCOVERY" });
    await app.query("begin");
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    await expect(app.query("update opportunity_stage_history set note = '改写' where opportunity_id = $1", [opportunity.opportunityId])).rejects.toMatchObject({ code: "42501" });
    await app.query("rollback");
    await app.query("begin");
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    await expect(app.query("delete from opportunity_stage_history where opportunity_id = $1", [opportunity.opportunityId])).rejects.toMatchObject({ code: "42501" });
    await app.query("rollback");
    await app.query("begin");
    await app.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
    await expect(app.query("delete from contacts where id = $1", [contactId])).rejects.toMatchObject({ code: "42501" });
    await app.query("rollback");
  });

  it("转化必须全事务回滚，不能留下孤立客户或联系人", async () => {
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    const leadId = await lead();
    const before = await owner.query<{ customers: string; contacts: string }>(`select (select count(*) from customers)::text customers, (select count(*) from contacts)::text contacts`);
    await expect(convertLeadToCustomerService(ctx(), {
      leadId, customerName: "应回滚客户", contactName: "联系人", contactPhone: "13812345679", opportunityName: "x".repeat(101),
      expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求",
    } as never)).rejects.toBeTruthy();
    const after = await owner.query<{ customers: string; contacts: string; status: string }>(`select (select count(*) from customers)::text customers, (select count(*) from contacts)::text contacts, (select status from leads where id = $1) status`, [leadId]);
    expect(after.rows[0].customers).toBe(before.rows[0].customers);
    expect(after.rows[0].contacts).toBe(before.rows[0].contacts);
    expect(after.rows[0].status).toBe("QUALIFIED");
  });

  it("手机号冲突映射为 DUPLICATE_PHONE，软删除不触发物理删除权限", async () => {
    const customerId = await customer();
    await contact(customerId, "13912345670");
    const { addContactService } = await import("@/core/customer/service");
    const mapped = toResult(await addContactService(ctx(), { customerId, name: "重复", phone: "13912345670" }).catch((error) => error));
    expect(mapped).toMatchObject({ ok: false, code: "DUPLICATE_PHONE" });
    const grants = await owner.query<{ delete_privilege: boolean }>(`select has_table_privilege('salescrm', 'contacts', 'DELETE') delete_privilege`);
    expect(grants.rows[0].delete_privilege).toBe(false);
  });

  it("创建商机拒绝不属于同一客户的主联系人", async () => {
    const customerA = await customer();
    const customerB = await customer();
    const contactB = await contact(customerB, "13912345671");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    await expect(createOpportunityService(ctx(), { customerId: customerA, primaryContactId: contactB, name: "错挂商机", stage: "DISCOVERY" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("阶段 4 转化、阶段机和任务", () => {
  it("转化一次写入客户、主联系人、商机、历史和阶段任务，并完成线索任务", async () => {
    const leadId = await lead();
    await owner.query(`insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FIRST_RESPONSE', now() + interval '1 day')`, [tenantA, leadId, salesA]);
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    const result = await convertLeadToCustomerService(ctx(), { leadId, customerName: "转化客户", contactName: "联系人", contactPhone: "13812345679", contactEmail: "sol.lead@example.com", opportunityName: "首个商机", expectedAmount: 1000, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "确认需求" });
    expect(result.opportunityId).toBeTruthy();
    const savedContact = await owner.query<{ email: string | null }>("select email from contacts where customer_id = $1", [result.customerId]);
    expect(savedContact.rows[0].email).toBe("sol.lead@example.com");
    const state = await owner.query<{ lead_status: string; customer_count: string; opportunity_stage: string; history_count: string; conversion_count: string; open_tasks: string; cancelled_lead_tasks: string }>(`select l.status lead_status, (select count(distinct lc.customer_id) from lead_conversions lc where lc.tenant_id = l.tenant_id and lc.lead_id = l.id)::text customer_count,
      (select stage from opportunities where id = $2) opportunity_stage, (select count(*) from opportunity_stage_history where opportunity_id = $2)::text history_count,
      (select count(*) from lead_conversions where lead_id = $1 and opportunity_id = $2)::text conversion_count,
      (select count(*) from tasks where opportunity_id = $2 and status = 'OPEN')::text open_tasks,
      (select count(*) from tasks where lead_id = $1 and status = 'CANCELLED')::text cancelled_lead_tasks from leads l where l.id = $1`, [leadId, result.opportunityId]);
    const completed = await owner.query<{ status: string; completed_at: string | null }>("select status, completed_at from tasks where lead_id = $1", [leadId]);
    expect(state.rows[0]).toMatchObject({ lead_status: "CONVERTED", customer_count: "1", opportunity_stage: "DISCOVERY", history_count: "1", conversion_count: "1", open_tasks: "1", cancelled_lead_tasks: "0" });
    expect(completed.rows[0].status).toBe("DONE");
    expect(completed.rows[0].completed_at).not.toBeNull();
  });

  it("CONTACTED 或未分配 QUALIFIED 转化失败且零写入", async () => {
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    const contacted = await lead("CONTACTED");
    const unassigned = await lead("QUALIFIED", null, "13812345680");
    const countBefore = await owner.query<{ count: string }>("select count(*)::text count from customers");
    await expect(convertLeadToCustomerService(ctx(), { leadId: contacted, customerName: "不能转", contactName: "联系人", contactPhone: "13812345681", opportunityName: "商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(convertLeadToCustomerService(ctx(), { leadId: unassigned, customerName: "不能转", contactName: "联系人", contactPhone: "13812345682", opportunityName: "商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await owner.query<{ count: string }>("select count(*)::text count from customers")).rows[0].count).toBe(countBefore.rows[0].count);
    expect((await owner.query<{ count: string }>("select count(*)::text count from lead_conversions where lead_id in ($1, $2)", [contacted, unassigned])).rows[0].count).toBe("0");
  });

  it("并发转化同一线索只有一个成功，另一个 CONFLICT 且不重复写入", async () => {
    const leadId = await lead("QUALIFIED", salesA, "13812345685");
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    const input = { leadId, customerName: "并发客户", contactName: "并发联系人", contactPhone: "13812345685", opportunityName: "并发商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "并发需求" };
    const results = await Promise.allSettled([convertLeadToCustomerService(ctx(), input), convertLeadToCustomerService(ctx(), input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" && result.reason?.code === "CONFLICT")).toHaveLength(1);
    const state = await owner.query<{ customers: string; contacts: string; opportunities: string; status: string }>(`select (select count(*) from lead_conversions where lead_id = $1)::text customers, (select count(*) from contacts c join lead_conversions lc on lc.tenant_id = c.tenant_id and lc.customer_id = c.customer_id where lc.lead_id = $1)::text contacts, (select count(*) from lead_conversions where lead_id = $1)::text opportunities, status::text from leads where id = $1`, [leadId]);
    expect(state.rows[0]).toEqual({ customers: "1", contacts: "1", opportunities: "1", status: "CONVERTED" });
  });

  it("转化后段外键失败时整笔事务回滚，不残留客户、联系人、商机或线索状态", async () => {
    const leadId = await lead("QUALIFIED", salesA, "13812345686");
    const before = await owner.query<{ customers: string; contacts: string; opportunities: string; conversions: string }>("select (select count(*) from customers)::text customers, (select count(*) from contacts)::text contacts, (select count(*) from opportunities)::text opportunities, (select count(*) from lead_conversions)::text conversions");
    const { convertLeadToCustomerService } = await import("@/core/customer/service");
    await expect(convertLeadToCustomerService({ tenantId: tenantA, userId: crypto.randomUUID(), role: "MANAGER" }, { leadId, customerName: "应回滚客户", contactName: "联系人", contactPhone: "13812345686", opportunityName: "应回滚商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求" })).rejects.toBeTruthy();
    const after = await owner.query<{ customers: string; contacts: string; opportunities: string; conversions: string; status: string }>(`select (select count(*) from customers)::text customers, (select count(*) from contacts)::text contacts, (select count(*) from opportunities)::text opportunities, (select count(*) from lead_conversions)::text conversions, status::text from leads where id = $1`, [leadId]);
    expect(after.rows[0]).toEqual({ ...before.rows[0], status: "QUALIFIED" });
  });

  it("手机号关联已有客户遵守 SALES 归属与 MANAGER 权限", async () => {
    const existingCustomer = await customer(salesB, "他人已有客户");
    await contact(existingCustomer, "13912345675");
    const salesLead = await lead("QUALIFIED", salesA, "13812345683");
    await expect((await import("@/core/customer/service")).convertLeadToCustomerService(ctx(), { leadId: salesLead, customerName: "关联", contactName: "联系人", contactPhone: "13912345675", linkToExistingCustomerId: existingCustomer, opportunityName: "关联商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const managerLead = await lead("QUALIFIED", salesA, "13812345684");
    const linked = await (await import("@/core/customer/service")).convertLeadToCustomerService({ tenantId: tenantA, userId: managerA, role: "MANAGER" }, { leadId: managerLead, customerName: "关联", contactName: "联系人", contactPhone: "13912345675", linkToExistingCustomerId: existingCustomer, opportunityName: "关联商机", expectedAmount: 1, expectedCloseAt: new Date(Date.now() + 86400000), demandNote: "需求" });
    expect(linked.customerId).toBe(existingCustomer);
  });

  it("同一对象最多一个 OPEN 任务，推进并发时一个成功、一个 CONFLICT 且不写额外历史", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345672");
    const { createOpportunityService, advanceStageService } = await import("@/core/opportunity/service");
    const created = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "并发商机", stage: "DISCOVERY" });
    const input = { opportunityId: created.opportunityId, fromStage: "DISCOVERY" as const, toStage: "PROPOSAL" as const, note: "完成方案沟通" };
    const results = await Promise.allSettled([advanceStageService(ctx(), input), advanceStageService(ctx(), input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason?.code === "CONFLICT")).toHaveLength(1);
    const counts = await owner.query<{ history: string; open_tasks: string }>(`select (select count(*) from opportunity_stage_history where opportunity_id = $1)::text history, (select count(*) from tasks where opportunity_id = $1 and status = 'OPEN')::text open_tasks`, [created.opportunityId]);
    expect(counts.rows[0]).toEqual({ history: "2", open_tasks: "1" });
  });

  it("商机初始阶段允许 PROPOSAL 和 NEGOTIATION，并创建对应阶段任务", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345687");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const proposal = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "初始方案", stage: "PROPOSAL" });
    const negotiation = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "初始谈判", stage: "NEGOTIATION" });
    const tasks = await owner.query<{ opportunity_id: string; type: string }>(`select opportunity_id, type from tasks where opportunity_id in ($1, $2) and status = 'OPEN' order by opportunity_id`, [proposal.opportunityId, negotiation.opportunityId]);
    expect(tasks.rows).toEqual([
      { opportunity_id: negotiation.opportunityId, type: "STAGE_PUSH" },
      { opportunity_id: proposal.opportunityId, type: "STAGE_PUSH" },
    ].sort((a, b) => a.opportunity_id.localeCompare(b.opportunity_id)));
    const stages = await owner.query<{ id: string; stage: string }>(`select id, stage from opportunities where id in ($1, $2) order by id`, [proposal.opportunityId, negotiation.opportunityId]);
    expect(stages.rows.map((row) => row.stage).sort()).toEqual(["NEGOTIATION", "PROPOSAL"]);
  });

  it("商机跟进按规则切换和恢复 STAGE_PUSH", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345688");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const { logActivityService } = await import("@/core/followup/service");
    const opportunity = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "商机跟进切换", stage: "DISCOVERY" });
    const followUpAt = new Date(Date.now() + 2 * 86400000);
    await logActivityService(ctx(), { opportunityId: opportunity.opportunityId, type: "NOTE", summary: "已约定下次跟进", nextFollowUpAt: followUpAt });
    const switched = await owner.query<{ type: string; status: string; completed_at: string | null }>(`select type, status, completed_at from tasks where opportunity_id = $1 order by created_at`, [opportunity.opportunityId]);
    expect(switched.rows).toHaveLength(2);
    expect(switched.rows[0]).toMatchObject({ type: "STAGE_PUSH", status: "DONE" });
    expect(switched.rows[0].completed_at).not.toBeNull();
    expect(switched.rows[1]).toMatchObject({ type: "FOLLOW_UP", status: "OPEN" });

    await logActivityService(ctx(), { opportunityId: opportunity.opportunityId, type: "NOTE", summary: "完成约定跟进" });
    const restored = await owner.query<{ type: string; status: string; due_at: string; stage_entered_at: string }>(`select t.type, t.status, t.due_at::text, o.stage_entered_at::text from tasks t join opportunities o on o.id = t.opportunity_id where t.opportunity_id = $1 order by t.created_at`, [opportunity.opportunityId]);
    expect(restored.rows[1].type).toBe("FOLLOW_UP");
    expect(restored.rows[1].status).toBe("DONE");
    expect(restored.rows[2].type).toBe("STAGE_PUSH");
    expect(restored.rows[2].status).toBe("OPEN");
    expect(new Date(restored.rows[2].due_at).getTime()).toBe(new Date(restored.rows[2].stage_entered_at).getTime() + 7 * 86400000);

    const ordinary = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "普通沟通保留阶段任务", stage: "DISCOVERY" });
    await logActivityService(ctx(), { opportunityId: ordinary.opportunityId, type: "NOTE", summary: "普通沟通未约下次" });
    const preserved = await owner.query<{ type: string; status: string }>(`select type, status from tasks where opportunity_id = $1 and status = 'OPEN'`, [ordinary.opportunityId]);
    expect(preserved.rows).toEqual([{ type: "STAGE_PUSH", status: "OPEN" }]);
  });

  it("客户多商机经营状态按 NEGOTIATION > PROPOSAL > DISCOVERY 聚合", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345676");
    const { createOpportunityService, advanceStageService } = await import("@/core/opportunity/service");
    const discovery = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "发现商机", stage: "DISCOVERY" });
    const proposal = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "方案商机", stage: "DISCOVERY" });
    await advanceStageService(ctx(), { opportunityId: proposal.opportunityId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "方案" });
    const negotiation = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "谈判商机", stage: "DISCOVERY" });
    await advanceStageService(ctx(), { opportunityId: negotiation.opportunityId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "方案" });
    await advanceStageService(ctx(), { opportunityId: negotiation.opportunityId, fromStage: "PROPOSAL", toStage: "NEGOTIATION", note: "谈判" });
    const status = await (await import("@/core/customer/service")).getCustomerOperatingStatusService(ctx(), customerId);
    expect(status.progressingStage).toBe("NEGOTIATION");
    expect(discovery.opportunityId).not.toBe(negotiation.opportunityId);
  });

  it("阶段非法跳跃零写入，NEGOTIATION 赢单和 LOST 会取消任务并写历史", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345673");
    const { createOpportunityService, advanceStageService, winOpportunityService, loseOpportunityService } = await import("@/core/opportunity/service");
    const created = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "终态商机", stage: "DISCOVERY" });
    const before = await owner.query<{ history: string }>(`select count(*)::text history from opportunity_stage_history where opportunity_id = $1`, [created.opportunityId]);
    await expect(advanceStageService(ctx(), { opportunityId: created.opportunityId, fromStage: "DISCOVERY", toStage: "NEGOTIATION", note: "跳级" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const after = await owner.query<{ history: string }>(`select count(*)::text history from opportunity_stage_history where opportunity_id = $1`, [created.opportunityId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    await advanceStageService(ctx(), { opportunityId: created.opportunityId, fromStage: "DISCOVERY", toStage: "PROPOSAL", note: "方案" });
    await advanceStageService(ctx(), { opportunityId: created.opportunityId, fromStage: "PROPOSAL", toStage: "NEGOTIATION", note: "谈判" });
    await winOpportunityService(ctx(), { opportunityId: created.opportunityId, actualAmount: 2000, actualCloseAt: new Date() });
    const won = await owner.query<{ stage: string; open_tasks: string; cancelled_completed_at: string | null; final_history: string; stage_entered_at: string }>(`select o.stage, (select count(*) from tasks where opportunity_id = o.id and status = 'OPEN')::text open_tasks, (select completed_at from tasks where opportunity_id = o.id and status = 'CANCELLED' limit 1) cancelled_completed_at, (select to_stage from opportunity_stage_history where opportunity_id = o.id order by created_at desc limit 1) final_history, o.stage_entered_at::text from opportunities o where o.id = $1`, [created.opportunityId]);
    expect(won.rows[0].stage).toBe("WON");
    expect(won.rows[0].open_tasks).toBe("0");
    expect(won.rows[0].cancelled_completed_at).toBeNull();
    expect(won.rows[0].final_history).toBe("WON");
    expect(won.rows[0].stage_entered_at).toBeTruthy();
    const { updateOpportunityService } = await import("@/core/opportunity/service");
    await expect(updateOpportunityService(ctx(), { opportunityId: created.opportunityId, name: "不应修改" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect((await import("@/core/followup/service")).logActivityService(ctx(), { opportunityId: created.opportunityId, type: "NOTE", summary: "不应跟进" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const lost = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "丢单商机", stage: "DISCOVERY" });
    await loseOpportunityService(ctx(), { opportunityId: lost.opportunityId, reason: "OTHER", note: "时机不对" });
    const lostState = await owner.query<{ stage: string; open_tasks: string; cancelled_completed_at: string | null; stage_entered_at: string }>(`select stage, (select count(*) from tasks where opportunity_id = opportunities.id and status = 'OPEN')::text open_tasks, (select completed_at from tasks where opportunity_id = opportunities.id and status = 'CANCELLED' limit 1) cancelled_completed_at, stage_entered_at::text from opportunities where id = $1`, [lost.opportunityId]);
    expect(lostState.rows[0].stage).toBe("LOST");
    expect(lostState.rows[0].open_tasks).toBe("0");
    expect(lostState.rows[0].cancelled_completed_at).toBeNull();
    expect(lostState.rows[0].stage_entered_at).toBeTruthy();
    await expect(updateOpportunityService(ctx(), { opportunityId: lost.opportunityId, name: "不应修改" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect((await import("@/core/followup/service")).logActivityService(ctx(), { opportunityId: lost.opportunityId, type: "NOTE", summary: "不应跟进" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("客户和商机任务都支持通用改约", async () => {
    const customerId = await customer();
    const contactId = await contact(customerId, "13912345677");
    await owner.query(`insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FOLLOW_UP', now() + interval '1 day')`, [tenantA, customerId, salesA]);
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const opportunity = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "改约商机", stage: "DISCOVERY" });
    const taskRows = await owner.query<{ id: string; customer_id: string | null; opportunity_id: string | null }>(`select id, customer_id, opportunity_id from tasks where customer_id = $1 or opportunity_id = $2 order by created_at`, [customerId, opportunity.opportunityId]);
    const { rescheduleTaskService } = await import("@/core/followup/service");
    for (const task of taskRows.rows) await rescheduleTaskService(ctx(), task.id, new Date(Date.now() + 3 * 86400000));
    expect(taskRows.rows).toHaveLength(2);
  });

  it("客户查询聚合商机任务、严格搜索并返回统一时间线事件", async () => {
    const customerId = await customer(salesA, "前缀客户公司");
    await contact(customerId, "13912345679");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const opportunity = await createOpportunityService(ctx(), { customerId, primaryContactId: (await owner.query<{ id: string }>("select id from contacts where customer_id = $1", [customerId])).rows[0].id, name: "查询商机", stage: "DISCOVERY" });
    await owner.query(`update tasks set due_at = now() - interval '1 hour' where opportunity_id = $1 and status = 'OPEN'`, [opportunity.opportunityId]);
    const { listCustomersService, getCustomerTimelineService } = await import("@/core/customer/service");
    const listed = await listCustomersService(ctx(), { status: "stalled", search: "前缀", sort: "recent" });
    expect(listed.items.some((item) => item.id === customerId && item.nextTaskDueAt)).toBe(true);
    const phoneSearch = await listCustomersService(ctx(), { search: "13912345679", status: "all" });
    expect(phoneSearch.items.some((item) => item.id === customerId)).toBe(true);
    const partialPhone = await listCustomersService(ctx(), { search: "139123", status: "all" });
    expect(partialPhone.items.some((item) => item.id === customerId)).toBe(false);
    await owner.query(`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail) values ($1, $2, 'opportunity.create', 'opportunity', $3, '{}'::jsonb)`, [tenantA, salesA, opportunity.opportunityId]);
    const timeline = await getCustomerTimelineService(ctx(), customerId, 20);
    expect(timeline.items.some((item) => item.type === "OPPORTUNITY_CREATED")).toBe(true);
    expect(timeline.items.some((item) => item.type === "STAGE_CHANGED")).toBe(true);
  });

  it("客户活动维护池排序摘要且不会被较早补录倒退", async () => {
    const customerId = await customer(salesA, "活动摘要客户");
    const { logActivityService } = await import("@/core/followup/service");
    const newer = new Date(Date.now() - 60_000);
    const older = new Date(Date.now() - 3_600_000);
    await logActivityService(ctx(), { customerId, type: "NOTE", summary: "较新互动", occurredAt: newer });
    await logActivityService(ctx(), { customerId, type: "NOTE", summary: "较早补录", occurredAt: older });
    let result = await owner.query<{ last_activity_at: string }>("select last_activity_at::text from customers where id = $1", [customerId]);
    expect(new Date(result.rows[0].last_activity_at).getTime()).toBe(newer.getTime());

    const contactId = await contact(customerId, "13912345669");
    const { createOpportunityService } = await import("@/core/opportunity/service");
    const opportunity = await createOpportunityService(ctx(), { customerId, primaryContactId: contactId, name: "活动摘要商机", stage: "DISCOVERY" });
    const opportunityActivity = new Date(Date.now() - 30_000);
    await logActivityService(ctx(), { opportunityId: opportunity.opportunityId, type: "NOTE", summary: "商机互动", occurredAt: opportunityActivity });
    result = await owner.query<{ last_activity_at: string }>("select last_activity_at::text from customers where id = $1", [customerId]);
    expect(new Date(result.rows[0].last_activity_at).getTime()).toBe(opportunityActivity.getTime());
  });

  it("客户池按最近活动游标分页且页间不重复", async () => {
    await owner.query(`insert into customers (tenant_id, owner_user_id, name, last_activity_at)
      select $1, $2, '游标客户-' || series, now() - series * interval '1 second'
      from generate_series(1, 52) series`, [tenantA, salesA]);
    const { listCustomersService } = await import("@/core/customer/service");
    const first = await listCustomersService(ctx(), { search: "游标客户-", status: "all", sort: "recent" });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await listCustomersService(ctx(), { search: "游标客户-", status: "all", sort: "recent", cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.every((item) => !firstIds.has(item.id))).toBe(true);
  });

  it("客户池和商机池拒绝可解码但日期非法的游标", async () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const validId = "550e8400-e29b-41d4-a716-446655440000";
    const { listCustomersService } = await import("@/core/customer/service");
    const { listOpportunitiesService } = await import("@/core/opportunity/service");

    await expect(listCustomersService(ctx(), {
      cursor: encode({ sort: "recent", value: "not-a-date", id: validId }),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(listOpportunitiesService(ctx(), {
      filter: "active",
      cursor: encode({ sort: "active", value: JSON.stringify({ priority: 0, close: "not-a-date", updated: "2026-08-17T00:00:00.000Z" }), id: validId }),
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("回填完成前仍从旧来源字段显示客户来源和转化时间线", async () => {
    const legacyLead = await lead("CONVERTED", salesA, "13812345689");
    const legacyCustomer = await customer(salesA, "迁移期旧客户");
    await owner.query("update leads set customer_id = $1 where id = $2", [legacyCustomer, legacyLead]);
    await owner.query("update customers set from_lead_id = $1 where id = $2", [legacyLead, legacyCustomer]);
    await owner.query(`insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
      values ($1, $2, 'lead.convert', 'lead', $3, '{}'::jsonb)`, [tenantA, salesA, legacyLead]);

    const { getCustomerDetailService, getCustomerTimelineService } = await import("@/core/customer/service");
    const detail = await getCustomerDetailService(ctx(), legacyCustomer);
    expect(detail.customer.sourceLeadNames).toEqual(["阶段四联系人"]);
    const timeline = await getCustomerTimelineService(ctx(), legacyCustomer, 20);
    expect(timeline.items.some((item) => item.id === `lead-created:${legacyLead}`)).toBe(true);
    expect(timeline.items.some((item) => item.id === `converted-legacy:${legacyLead}`)).toBe(true);
  });

  it("商机池从超时和正常两个有界分支稳定游标分页", async () => {
    const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
      values ($1, $2, '商机容量客户') returning id`, [tenantB, salesTenantB]);
    const contact = await owner.query<{ id: string }>(`insert into contacts (tenant_id, customer_id, name, phone, is_primary)
      values ($1, $2, '商机容量联系人', '13988880001', true) returning id`, [tenantB, customer.rows[0].id]);
    await owner.query(`insert into opportunities
      (tenant_id, customer_id, owner_user_id, primary_contact_id, name, stage, expected_close_at, updated_at)
      select $1, $2, $3, $4, '游标商机-' || n, 'DISCOVERY', current_date + (n % 10)::int,
        now() - (n * interval '1 second')
      from generate_series(1, 55) as rows(n)`, [tenantB, customer.rows[0].id, salesTenantB, contact.rows[0].id]);
    await owner.query(`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
      select $1, o.id, $2, 'STAGE_PUSH', case when o.name = '游标商机-55' then now() - interval '1 hour' else now() + interval '2 days' end
      from opportunities o where o.tenant_id = $1 and o.customer_id = $3`, [tenantB, salesTenantB, customer.rows[0].id]);

    const context = { tenantId: tenantB, userId: salesTenantB, role: "SALES" as const };
    const { listOpportunitiesService } = await import("@/core/opportunity/service");
    const first = await listOpportunitiesService(context, { filter: "active" });
    expect(first.items).toHaveLength(50);
    expect(first.items[0]).toMatchObject({ name: "游标商机-55", isStalled: true });
    expect(first.nextCursor).toBeTruthy();
    const second = await listOpportunitiesService(context, { filter: "active", cursor: first.nextCursor! });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const firstIds = new Set(first.items.map((item) => item.id));
    expect(second.items.every((item) => !firstIds.has(item.id))).toBe(true);

    const stalled = await listOpportunitiesService(context, { filter: "stalled" });
    expect(stalled.items.map((item) => item.name)).toEqual(["游标商机-55"]);
    const indexes = await owner.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'
      and indexname in ('tasks_tenant_open_opportunity_due_idx', 'opportunities_tenant_active_close_cursor_idx', 'opportunities_tenant_owner_active_close_cursor_idx')
      order by indexname`);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "opportunities_tenant_active_close_cursor_idx",
      "opportunities_tenant_owner_active_close_cursor_idx",
      "tasks_tenant_open_opportunity_due_idx",
    ]);
  });
});
