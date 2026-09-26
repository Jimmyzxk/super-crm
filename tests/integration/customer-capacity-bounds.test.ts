import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("客户容量边界测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });
let tenantId: string;
let userId: string;

beforeAll(async () => {
  await owner.connect();
  const tenant = await owner.query<{ id: string }>("insert into tenants (name) values ('客户容量边界测试') returning id");
  tenantId = tenant.rows[0].id;
  const user = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '客户容量测试用户', 'SALES') returning id`,
  [tenantId, `customer-capacity-${Date.now()}@example.com`]);
  userId = user.rows[0].id;
  await app.connect();
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await app.end();
  await owner.end();
});

describe("客户详情和时间线容量边界", () => {
  it("0024 提供 direct legacy lead 的有界读取索引", async () => {
    const result = await owner.query<{ indexname: string }>(`select indexname
      from pg_indexes
      where schemaname = 'public' and indexname = 'leads_tenant_customer_created_cursor_idx'`);

    expect(result.rows).toEqual([{ indexname: "leads_tenant_customer_created_cursor_idx" }]);
  });

  it("0026 为详情集合游标提供关系键和稳定排序索引", async () => {
    const result = await owner.query<{ indexname: string }>(`select indexname
      from pg_indexes
      where schemaname = 'public' and indexname in (
        'contacts_tenant_customer_detail_cursor_idx',
        'opportunities_tenant_customer_created_cursor_idx',
        'tasks_tenant_customer_open_due_cursor_idx',
        'tasks_tenant_opportunity_open_due_cursor_idx'
      )
      order by indexname`);

    expect(result.rows.map((row) => row.indexname)).toEqual([
      "contacts_tenant_customer_detail_cursor_idx",
      "opportunities_tenant_customer_created_cursor_idx",
      "tasks_tenant_customer_open_due_cursor_idx",
      "tasks_tenant_opportunity_open_due_cursor_idx",
    ]);
  });

  it("详情集合按上限截断，并能以 cursor 读取稳定的后续页", async () => {
    const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
      values ($1, $2, '容量边界客户') returning id`, [tenantId, userId]);
    const customerId = customer.rows[0].id;

    await owner.query(`insert into contacts (tenant_id, customer_id, name, phone, created_at)
      select $1, $2, '联系人-' || n, '139' || lpad(n::text, 8, '0'), now() + n * interval '1 second'
      from generate_series(1, 105) as rows(n)`, [tenantId, customerId]);
    await owner.query(`insert into leads (tenant_id, owner_user_id, customer_id, contact_name, contact_phone, created_at)
      select $1, $2, $3, '来源线索-' || n, '138' || lpad(n::text, 8, '0'), now() + n * interval '1 second'
      from generate_series(1, 105) as rows(n)`, [tenantId, userId, customerId]);
    await owner.query(`insert into opportunities (tenant_id, customer_id, owner_user_id, name, created_at, updated_at)
      select $1, $2, $3, '商机-' || n, now() - n * interval '1 second', now() - n * interval '1 second'
      from generate_series(1, 105) as rows(n)`, [tenantId, customerId, userId]);
    await owner.query(`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
      select $1, numbered.id, $2, 'FOLLOW_UP', now() + numbered.n * interval '1 second'
      from (
        select o.id, row_number() over (order by o.created_at desc, o.id desc) as n
        from opportunities o
        where o.tenant_id = $1 and o.customer_id = $3
      ) numbered`, [tenantId, userId, customerId]);

    const { CUSTOMER_DETAIL_COLLECTION_LIMIT, getCustomerDetailCollectionService, getCustomerDetailService } = await import("@/core/customer/service");
    const context = { tenantId, userId, role: "SALES" as const };
    const detail = await getCustomerDetailService(context, customerId);

    expect(CUSTOMER_DETAIL_COLLECTION_LIMIT).toBe(100);
    expect(detail.customer.sourceLeadNames).toHaveLength(100);
    expect(detail.customer.sourceLeadNames[0]).toBe("来源线索-1");
    expect(detail.contacts).toHaveLength(100);
    expect(detail.contacts[0].name).toBe("联系人-1");
    expect(detail.opportunities).toHaveLength(100);
    expect(detail.opportunities[0].name).toBe("商机-1");
    expect(detail.customer.primaryOpportunityId).toBe(detail.opportunities[0].id);
    expect(detail.openTasks).toHaveLength(100);
    expect(detail.openTasks[0].dueAt < detail.openTasks.at(-1)!.dueAt).toBe(true);
    expect(detail.truncation).toEqual({
      sourceLeadNames: { limit: 100, hasMore: true, nextCursor: expect.any(String) },
      contacts: { limit: 100, hasMore: true, nextCursor: expect.any(String) },
      opportunities: { limit: 100, hasMore: true, nextCursor: expect.any(String) },
      openTasks: { limit: 100, hasMore: true, nextCursor: expect.any(String) },
    });

    const [sourceLeads, contacts, opportunities, openTasks] = await Promise.all([
      getCustomerDetailCollectionService(context, customerId, "sourceLeadNames", { cursor: detail.truncation.sourceLeadNames.nextCursor }),
      getCustomerDetailCollectionService(context, customerId, "contacts", { cursor: detail.truncation.contacts.nextCursor }),
      getCustomerDetailCollectionService(context, customerId, "opportunities", { cursor: detail.truncation.opportunities.nextCursor }),
      getCustomerDetailCollectionService(context, customerId, "openTasks", { cursor: detail.truncation.openTasks.nextCursor }),
    ]);
    expect(sourceLeads.items.map((item) => item.name)).toEqual(["来源线索-101", "来源线索-102", "来源线索-103", "来源线索-104", "来源线索-105"]);
    expect(contacts.items.map((item) => item.name)).toEqual(["联系人-101", "联系人-102", "联系人-103", "联系人-104", "联系人-105"]);
    expect(opportunities.items.map((item) => item.name)).toEqual(["商机-101", "商机-102", "商机-103", "商机-104", "商机-105"]);
    expect(openTasks.items).toHaveLength(5);
    expect(openTasks.nextCursor).toBeNull();
  });

  it("客户和商机任务合并后按全局顺序分页，并保持客户可见性隔离", async () => {
    const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
      values ($1, $2, '任务分页客户') returning id`, [tenantId, userId]);
    const customerId = customer.rows[0].id;
    const opportunities = await owner.query<{ id: string }>(`insert into opportunities (tenant_id, customer_id, owner_user_id, name)
      select $1, $2, $3, '任务分页商机-' || n from generate_series(1, 3) as rows(n) returning id`, [tenantId, customerId, userId]);
    await owner.query(`insert into tasks (tenant_id, opportunity_id, assignee_user_id, type, due_at)
      values ($1, $2, $3, 'FOLLOW_UP', '2030-01-01 09:00:00+08'),
        ($1, $4, $3, 'FOLLOW_UP', '2030-01-01 11:00:00+08'),
        ($1, $5, $3, 'FOLLOW_UP', '2030-01-01 12:00:00+08')`, [tenantId, opportunities.rows[0].id, userId, opportunities.rows[1].id, opportunities.rows[2].id]);
    await owner.query(`insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at)
      values ($1, $2, $3, 'FOLLOW_UP', '2030-01-01 10:00:00+08')`, [tenantId, customerId, userId]);

    const { getCustomerDetailCollectionService } = await import("@/core/customer/service");
    const context = { tenantId, userId, role: "SALES" as const };
    const first = await getCustomerDetailCollectionService(context, customerId, "openTasks", { limit: 2 });
    const second = await getCustomerDetailCollectionService(context, customerId, "openTasks", { cursor: first.nextCursor, limit: 2 });

    expect(first.items.map((item) => item.subjectType)).toEqual(["opportunity", "customer"]);
    expect([...first.items, ...second.items].map((item) => item.dueAt)).toEqual(
      [...first.items, ...second.items].map((item) => item.dueAt).sort(),
    );
    expect(second.items.map((item) => item.subjectType)).toEqual(["opportunity", "opportunity"]);
    expect(second.nextCursor).toBeNull();

    const otherUser = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '其他销售', 'SALES') returning id`, [tenantId, `other-sales-${Date.now()}@example.com`]);
    await expect(getCustomerDetailCollectionService({ tenantId, userId: otherUser.rows[0].id, role: "SALES" }, customerId, "contacts")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const foreignTenant = await owner.query<{ id: string }>("insert into tenants (name) values ('客户分页隔离租户') returning id");
    await expect(getCustomerDetailCollectionService({ tenantId: foreignTenant.rows[0].id, userId, role: "SALES" }, customerId, "contacts")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("时间线在多个高基数分支中仍返回全局最新记录", async () => {
    const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
      values ($1, $2, '时间线容量客户') returning id`, [tenantId, userId]);
    const customerId = customer.rows[0].id;
    const opportunities = await owner.query<{ id: string }>(`insert into opportunities (tenant_id, customer_id, owner_user_id, name)
      select $1, $2, $3, '时间线商机-' || n from generate_series(1, 40) as rows(n) returning id`, [tenantId, customerId, userId]);
    await owner.query(`insert into activities (tenant_id, customer_id, user_id, type, summary, occurred_at)
      select $1, $2, $3, 'NOTE', '客户活动-' || n, now() - (n * 2 - 1) * interval '1 second'
      from generate_series(1, 40) as rows(n)`, [tenantId, customerId, userId]);
    for (const [index, opportunity] of opportunities.rows.entries()) {
      await owner.query(`insert into activities (tenant_id, opportunity_id, user_id, type, summary, occurred_at)
        values ($1, $2, $3, 'NOTE', $4, now() - $5 * interval '1 second')`, [tenantId, opportunity.id, userId, `商机活动-${index + 1}`, (index + 1) * 2]);
      await owner.query(`insert into opportunity_stage_history (tenant_id, opportunity_id, to_stage, operator_user_id, created_at)
        values ($1, $2, 'DISCOVERY', $3, now() - $4 * interval '1 second')`, [tenantId, opportunity.id, userId, 1000 + index]);
    }

    const { getCustomerTimelineService } = await import("@/core/customer/service");
    const timeline = await getCustomerTimelineService({ tenantId, userId, role: "SALES" }, customerId, 20);

    expect(timeline.items).toHaveLength(20);
    expect(timeline.items.every((item) => item.type === "NOTE")).toBe(true);
    expect(timeline.items.slice(0, 4).map((item) => item.summary)).toEqual(["客户活动-1", "商机活动-1", "客户活动-2", "商机活动-2"]);
    expect(timeline.items.map((item) => item.occurredAt)).toEqual(
      [...timeline.items].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).map((item) => item.occurredAt),
    );
    expect(timeline.nextLimit).toBe(40);
  });

  it("四个来源入口在详情分页和时间线中保持去重后的稳定顺序", async () => {
    const customer = await owner.query<{ id: string }>(`insert into customers (tenant_id, owner_user_id, name)
      values ($1, $2, 'legacy 入口客户') returning id`, [tenantId, userId]);
    const customerId = customer.rows[0].id;
    const conversionLead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, customer_id, contact_name, contact_phone, status, created_at)
      values ($1, $2, $3, '转化线索', '13700001000', 'CONVERTED', now() - interval '4 seconds') returning id`, [tenantId, userId, customerId]);
    const conversionOpportunity = await owner.query<{ id: string }>(`insert into opportunities (tenant_id, customer_id, owner_user_id, name)
      values ($1, $2, $3, '转化来源商机') returning id`, [tenantId, customerId, userId]);
    await owner.query(`insert into lead_conversions (tenant_id, lead_id, customer_id, opportunity_id, converted_by_user_id)
      values ($1, $2, $3, $4, $5)`, [tenantId, conversionLead.rows[0].id, customerId, conversionOpportunity.rows[0].id, userId]);
    const directLead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, customer_id, contact_name, contact_phone, created_at)
      values ($1, $2, $3, '直接关联线索', '13700001001', now() - interval '3 seconds') returning id`, [tenantId, userId, customerId]);
    const customerOriginLead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, created_at)
      values ($1, $2, '客户来源线索', '13700001002', now() - interval '2 seconds') returning id`, [tenantId, userId]);
    const opportunityOriginLead = await owner.query<{ id: string }>(`insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, created_at)
      values ($1, $2, '商机来源线索', '13700001003', now() - interval '1 second') returning id`, [tenantId, userId]);
    await owner.query("update customers set from_lead_id = $1 where tenant_id = $2 and id = $3", [customerOriginLead.rows[0].id, tenantId, customerId]);
    await owner.query(`insert into opportunities (tenant_id, customer_id, owner_user_id, from_lead_id, name)
      values ($1, $2, $3, $4, 'legacy 来源商机')`, [tenantId, customerId, userId, opportunityOriginLead.rows[0].id]);

    const { getCustomerDetailCollectionService, getCustomerDetailService, getCustomerTimelineService } = await import("@/core/customer/service");
    const context = { tenantId, userId, role: "SALES" as const };
    const detail = await getCustomerDetailService(context, customerId);
    const timeline = await getCustomerTimelineService(context, customerId, 20);

    expect(detail.customer.sourceLeadNames).toEqual(["直接关联线索", "客户来源线索", "商机来源线索", "转化线索"]);
    const firstSourcePage = await getCustomerDetailCollectionService(context, customerId, "sourceLeadNames", { limit: 2 });
    const secondSourcePage = await getCustomerDetailCollectionService(context, customerId, "sourceLeadNames", { cursor: firstSourcePage.nextCursor, limit: 2 });
    expect(firstSourcePage.items.map((item) => item.name)).toEqual(["直接关联线索", "客户来源线索"]);
    expect(secondSourcePage.items.map((item) => item.name)).toEqual(["商机来源线索", "转化线索"]);
    expect(new Set([...firstSourcePage.items, ...secondSourcePage.items].map((item) => item.id)).size).toBe(4);
    expect(timeline.items.filter((item) => item.type === "LEAD_CREATED").map((item) => item.summary)).toEqual([
      "线索创建：商机来源线索",
      "线索创建：客户来源线索",
      "线索创建：直接关联线索",
      "线索创建：转化线索",
    ]);
    expect(new Set(timeline.items.map((item) => item.id)).size).toBe(timeline.items.length);
    expect(directLead.rows[0].id).toBeTruthy();
  });
});
