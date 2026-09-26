import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!migrationUrl || !appUrl || !sessionSecret) {
  throw new Error(
    "Integration tests require TEST_MIGRATION_DATABASE_URL, TEST_DATABASE_URL, and SESSION_SECRET",
  );
}
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("Integration tests must not use the development database");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });

let tenantA: string;
let tenantB: string;
let activeUserId: string;
let userBId: string;

async function createUser(input: {
  tenantId: string;
  email: string;
  password?: string;
  status?: "ACTIVE" | "DISABLED";
}): Promise<string> {
  const passwordHash = await bcrypt.hash(input.password ?? "Password123", 12);
  const result = await owner.query<{ id: string }>(
    `insert into users (tenant_id, email, password_hash, name, status)
     values ($1, $2, $3, '测试用户', $4)
     returning id`,
    [input.tenantId, input.email, passwordHash, input.status ?? "ACTIVE"],
  );
  return result.rows[0].id;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = sessionSecret;
  await owner.connect();
  await app.connect();
  await owner.query("truncate table users, tenants cascade");

  const tenants = await owner.query<{ id: string }>(
    `insert into tenants (name) values ('租户 A'), ('租户 B') returning id`,
  );
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;
  activeUserId = await createUser({ tenantId: tenantA, email: "admin@example.com" });
  userBId = await createUser({ tenantId: tenantB, email: "other@example.com" });
});

afterAll(async () => {
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await app.end();
  await owner.end();
});

describe("阶段 0 PostgreSQL 与认证契约", () => {
  it("函数属主可绕过 RLS，但应用角色不可登录为该角色", async () => {
    const roles = await owner.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolinherit: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolcanlogin, rolinherit, rolbypassrls
       from pg_roles where rolname in ('salescrm', 'salescrm_auth')
       order by rolname`,
    );

    expect(roles.rows).toEqual([
      { rolname: "salescrm", rolcanlogin: true, rolinherit: false, rolbypassrls: false },
      { rolname: "salescrm_auth", rolcanlogin: false, rolinherit: false, rolbypassrls: true },
    ]);

    const functionOwner = await owner.query<{ owner: string }>(
      `select pg_get_userbyid(proowner) as owner
       from pg_proc
       where oid = 'public.auth_lookup_user(text)'::regprocedure`,
    );
    expect(functionOwner.rows[0].owner).toBe("salescrm_auth");

    const membership = await owner.query<{ count: string }>(
      `select count(*) from pg_auth_members m
       join pg_roles parent on parent.oid = m.roleid
       join pg_roles member on member.oid = m.member
       where parent.rolname = 'salescrm_auth' and member.rolname = 'salescrm'`,
    );
    expect(membership.rows[0].count).toBe("0");
  });

  it("应用连接裸查 users 为 0 行，认证窄函数仍能定位用户", async () => {
    const raw = await app.query("select id from users");
    expect(raw.rowCount).toBe(0);

    const lookup = await app.query<{ id: string; tenant_id: string }>(
      "select id, tenant_id from public.auth_lookup_user($1)",
      [" ADMIN@EXAMPLE.COM "],
    );
    expect(lookup.rows).toEqual([{ id: activeUserId, tenant_id: tenantA }]);
  });

  it("withTenant 只能读取当前租户用户", async () => {
    const { withTenant } = await import("@/core/tenant");
    const rows = await withTenant(tenantA, async (tx) =>
      tx.execute<{ tenant_id: string }>(
        (await import("drizzle-orm")).sql`select tenant_id from public.users order by email`,
      ),
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].tenant_id).toBe(tenantA);
  });

  it("数据库拒绝未规范化邮箱和大小写重复邮箱", async () => {
    await expect(
      createUser({ tenantId: tenantA, email: " Mixed@Example.com " }),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      createUser({ tenantId: tenantB, email: "admin@example.com" }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("登录规范化邮箱、验证密码并重置失败计数", async () => {
    const { authenticate } = await import("@/core/auth/service");
    await owner.query(
      "update users set failed_login_count = 2 where id = $1",
      [activeUserId],
    );

    const result = await authenticate({
      email: " ADMIN@EXAMPLE.COM ",
      password: "Password123",
    });
    expect(result.ok).toBe(true);

    const state = await owner.query<{ failed_login_count: number; locked_until: Date | null }>(
      "select failed_login_count, locked_until from users where id = $1",
      [activeUserId],
    );
    expect(state.rows[0]).toEqual({ failed_login_count: 0, locked_until: null });
    const loginAudit = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      "select action, actor_user_id, subject_id from audit_logs where tenant_id = $1 and action = 'auth.login' order by created_at desc limit 1",
      [tenantA],
    );
    expect(loginAudit.rows[0]).toMatchObject({ action: "auth.login", actor_user_id: activeUserId, subject_id: activeUserId });
  });

  it("连续失败 5 次后锁定，第 6 次返回 RATE_LIMITED", async () => {
    const userId = await createUser({ tenantId: tenantA, email: "locked@example.com" });
    const { authenticate } = await import("@/core/auth/service");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await authenticate({
        email: "locked@example.com",
        password: "wrong-password",
      });
      expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    }

    const blocked = await authenticate({
      email: "locked@example.com",
      password: "Password123",
    });
    expect(blocked).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    const state = await owner.query<{ failed_login_count: number; locked: boolean }>(
      "select failed_login_count, locked_until > now() as locked from users where id = $1",
      [userId],
    );
    expect(state.rows[0]).toEqual({ failed_login_count: 5, locked: true });
    const lockedAudit = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      "select action, actor_user_id, subject_id from audit_logs where tenant_id = $1 and action = 'auth.login_locked' order by created_at desc limit 1",
      [tenantA],
    );
    expect(lockedAudit.rows[0]).toMatchObject({ action: "auth.login_locked", actor_user_id: userId, subject_id: userId });
  });

  it("停用租户后拒绝登录", async () => {
    const userId = await createUser({ tenantId: tenantB, email: "suspended@example.com" });
    await owner.query("update tenants set status = 'SUSPENDED' where id = $1", [tenantB]);
    const { authenticate } = await import("@/core/auth/service");
    const result = await authenticate({
      email: "suspended@example.com",
      password: "Password123",
    });
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    await owner.query("update tenants set status = 'ACTIVE' where id = $1", [tenantB]);
    expect(userId).toBeTruthy();
  });

  it("停用用户或 tenantId/userId 不匹配时拒绝旧 token", async () => {
    const { issueSession, resolveSession } = await import("@/core/auth/session");
    const validToken = await issueSession({
      userId: activeUserId,
      tenantId: tenantA,
      role: "SALES",
      sessionVersion: 1,
    });
    await expect(resolveSession(validToken)).resolves.toMatchObject({
      userId: activeUserId,
      tenantId: tenantA,
    });

    const mismatchedToken = await issueSession({
      userId: activeUserId,
      tenantId: tenantB,
      role: "ADMIN",
      sessionVersion: 1,
    });
    await expect(resolveSession(mismatchedToken)).rejects.toThrow("UNAUTHENTICATED");

    await owner.query(
      "update users set status = 'DISABLED', session_version = session_version + 1 where id = $1",
      [activeUserId],
    );
    await expect(resolveSession(validToken)).rejects.toThrow("UNAUTHENTICATED");
    await owner.query("update users set status = 'ACTIVE' where id = $1", [activeUserId]);
  });

  it("五张阶段 1 表未设置租户上下文时均不可见", async () => {
    const counts = await Promise.all([
      app.query("select count(*) from leads"),
      app.query("select count(*) from activities"),
      app.query("select count(*) from tasks"),
      app.query("select count(*) from audit_logs"),
      app.query("select count(*) from lead_status_history"),
    ]);
    expect(counts.map((result) => result.rows[0].count)).toEqual(["0", "0", "0", "0", "0"]);
  });

  it("租户 A 看不到也不能修改租户 B 的线索与审计", async () => {
    const leadB = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone)
       values ($1, $2, '租户 B 线索', '13812345678') returning id`,
      [tenantB, userBId],
    );
    await owner.query(
      `insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id)
       values ($1, $2, 'lead.create', 'lead', $3)`,
      [tenantB, userBId, leadB.rows[0].id],
    );
    await owner.query(
      `insert into activities (tenant_id, lead_id, user_id, type, outcome, summary)
       values ($1, $2, $3, 'CALL', 'CONNECTED', '租户 B 活动')`,
      [tenantB, leadB.rows[0].id, userBId],
    );
    await owner.query(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FIRST_RESPONSE', now() + interval '1 day')`,
      [tenantB, leadB.rows[0].id, userBId],
    );

    await app.query("select set_config('app.tenant_id', $1, false)", [tenantA]);
    expect((await app.query("select id from leads")).rowCount).toBe(0);
    expect((await app.query("select id from activities")).rowCount).toBe(0);
    expect((await app.query("select id from tasks")).rowCount).toBe(0);
    expect((await app.query("select id from audit_logs where tenant_id = $1", [tenantB])).rowCount).toBe(0);
    expect((await app.query("select id from lead_status_history")).rowCount).toBe(0);
    expect((await app.query("update leads set note = '越权' where id = $1", [leadB.rows[0].id])).rowCount).toBe(0);
    expect((await app.query("update tasks set status = 'CANCELLED' where lead_id = $1", [leadB.rows[0].id])).rowCount).toBe(0);
    expect((await app.query(
      "update activities set summary = '越权' where lead_id = $1",
      [leadB.rows[0].id],
    )).rowCount).toBe(0);
    await expect(app.query("insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id) values ($1, $2, 'x', 'lead', $3)", [tenantB, userBId, leadB.rows[0].id])).rejects.toMatchObject({ code: "42501" });
  });

  it("应用连接不是 owner，且五张表都启用并强制 RLS", async () => {
    const result = await owner.query<{ relname: string; relforcerowsecurity: boolean; relrowsecurity: boolean; owner: string }>(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity, r.rolname as owner
      from pg_class c join pg_roles r on r.oid = c.relowner
      where c.relname in ('leads', 'activities', 'tasks', 'audit_logs', 'lead_status_history') order by c.relname
    `);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity && row.owner !== "salescrm")).toBe(true);
  });

  it("activities 和 tasks 强制恰有一个归属对象，tasks 同对象只能有一个 OPEN", async () => {
    const lead = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone)
       values ($1, $2, '约束测试', '13912345678') returning id`,
      [tenantA, activeUserId],
    );
    const leadId = lead.rows[0].id;
    const commonActivity = [tenantA, activeUserId, "CALL", "CONNECTED", "已接通"];
    await expect(owner.query(
      `insert into activities (tenant_id, user_id, type, outcome, summary) values ($1, $2, $3, $4, $5)`, commonActivity,
    )).rejects.toMatchObject({ code: "23514" });
    await expect(owner.query(
      `insert into activities (tenant_id, lead_id, customer_id, user_id, type, outcome, summary) values ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantA, leadId, leadId, activeUserId, "CALL", "CONNECTED", "重复归属"],
    )).rejects.toMatchObject({ code: "23514" });
    await owner.query(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FIRST_RESPONSE', now() + interval '1 day')`,
      [tenantA, leadId, activeUserId],
    );
    await expect(owner.query(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at) values ($1, $2, $3, 'FOLLOW_UP', now() + interval '2 days')`,
      [tenantA, leadId, activeUserId],
    )).rejects.toMatchObject({ code: "23505" });
    await expect(owner.query(
      `insert into tasks (tenant_id, customer_id, opportunity_id, assignee_user_id, type, due_at) values ($1, $2, $3, $4, 'FOLLOW_UP', now() + interval '2 days')`,
      [tenantA, leadId, leadId, activeUserId],
    )).rejects.toMatchObject({ code: "23514" });
    const customer = await owner.query<{ id: string }>(
      `insert into customers (tenant_id, owner_user_id, name) values ($1, $2, '约束测试客户') returning id`,
      [tenantA, activeUserId],
    );
    const customerId = customer.rows[0].id;
    const customerTask = await owner.query(
      `insert into tasks (tenant_id, customer_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FOLLOW_UP', now() + interval '2 days') returning id`,
      [tenantA, customerId, activeUserId],
    );
    const customerActivity = await owner.query(
      `insert into activities (tenant_id, customer_id, user_id, type, outcome, summary)
       values ($1, $2, $3, 'CALL', 'CONNECTED', '客户跟进') returning id`,
      [tenantA, customerId, activeUserId],
    );
    expect(customerTask.rowCount).toBe(1);
    expect(customerActivity.rowCount).toBe(1);
  });

  it("audit_logs 只能插入和查询，不能更新或删除", async () => {
    await app.query("select set_config('app.tenant_id', $1, false)", [tenantA]);
    const lead = await owner.query<{ id: string }>(
      `select id from leads where tenant_id = $1 limit 1`, [tenantA],
    );
    const inserted = await app.query<{ id: string }>(
      `insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id) values ($1, $2, 'test', 'lead', $3) returning id`,
      [tenantA, activeUserId, lead.rows[0].id],
    );
    expect(inserted.rowCount).toBe(1);
    await expect(app.query("update audit_logs set action = 'changed' where id = $1", [inserted.rows[0].id])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("delete from audit_logs where id = $1", [inserted.rows[0].id])).rejects.toMatchObject({ code: "42501" });
  });

  it("数据库拒绝把业务记录关联到另一个租户的用户或线索", async () => {
    const leadA = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone)
       values ($1, $2, '租户 A 关联测试', '13712345678') returning id`,
      [tenantA, activeUserId],
    );

    await expect(owner.query(
      `update leads set owner_user_id = $1 where id = $2`,
      [userBId, leadA.rows[0].id],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(owner.query(
      `insert into activities (tenant_id, lead_id, user_id, type, outcome, summary)
       values ($1, $2, $3, 'CALL', 'CONNECTED', '跨租户')`,
      [tenantA, leadA.rows[0].id, userBId],
    )).rejects.toMatchObject({ code: "23503" });
    await expect(owner.query(
      `insert into tasks (tenant_id, lead_id, assignee_user_id, type, due_at)
       values ($1, $2, $3, 'FIRST_RESPONSE', now() + interval '1 day')`,
      [tenantA, leadA.rows[0].id, userBId],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("应用角色可以为合并线索移动活动，但不能删除活动", async () => {
    const leads = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone)
       values ($1, $2, '源线索', '13612345678'), ($1, $2, '目标线索', '13512345678')
       returning id`,
      [tenantA, activeUserId],
    );
    const activity = await owner.query<{ id: string }>(
      `insert into activities (tenant_id, lead_id, user_id, type, outcome, summary)
       values ($1, $2, $3, 'CALL', 'CONNECTED', '待合并') returning id`,
      [tenantA, leads.rows[0].id, activeUserId],
    );

    await app.query("select set_config('app.tenant_id', $1, false)", [tenantA]);
    expect((await app.query(
      "update activities set lead_id = $1 where id = $2",
      [leads.rows[1].id, activity.rows[0].id],
    )).rowCount).toBe(1);
    await expect(app.query(
      "delete from activities where id = $1",
      [activity.rows[0].id],
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("手工重复线索两阶段确认，确认前业务表零写入", async () => {
    const ctx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { createLeadService } = await import("@/core/leads/service");
    const first = await createLeadService(ctx, {
      contactName: "李明", contactPhone: "13412345678", companyName: "星海智能科技",
    });
    expect(first.created).toBe(true);

    const before = await owner.query<{ leads: string; tasks: string; audits: string }>(`
      select (select count(*) from leads where tenant_id = $1)::text as leads,
             (select count(*) from tasks where tenant_id = $1)::text as tasks,
             (select count(*) from audit_logs where tenant_id = $1)::text as audits`, [tenantA]);
    const duplicate = await createLeadService(ctx, {
      contactName: "李明第二次", contactPhone: "13412345678",
    });
    expect(duplicate).toMatchObject({ created: false, duplicateOf: { contactName: "李明" } });
    const unchanged = await owner.query<{ leads: string; tasks: string; audits: string }>(`
      select (select count(*) from leads where tenant_id = $1)::text as leads,
             (select count(*) from tasks where tenant_id = $1)::text as tasks,
             (select count(*) from audit_logs where tenant_id = $1)::text as audits`, [tenantA]);
    expect(unchanged.rows[0]).toEqual(before.rows[0]);

    const confirmed = await createLeadService(ctx, {
      contactName: "李明第二次", contactPhone: "13412345678", confirmDuplicate: true,
    });
    expect(confirmed.created).toBe(true);
    if (!confirmed.created) throw new Error("duplicate lead was not created");
    const duplicateFlag = await owner.query<{ is_possible_duplicate: boolean }>(
      "select is_possible_duplicate from leads where id = $1",
      [confirmed.leadId],
    );
    expect(duplicateFlag.rows[0].is_possible_duplicate).toBe(true);
    const count = await owner.query("select count(*) from leads where tenant_id = $1 and contact_phone = '13412345678'", [tenantA]);
    expect(count.rows[0].count).toBe("2");
  });

  it("记跟进在一个事务内推进状态、完成旧任务并创建下次任务", async () => {
    const ctx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { createLeadService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const created = await createLeadService(ctx, { contactName: "王芳", contactPhone: "13312345678" });
    if (!created.created) throw new Error("test lead was not created");
    const next = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await logActivityService(ctx, {
      leadId: created.leadId, type: "CALL", outcome: "CONNECTED", summary: "确认下周安排演示", nextFollowUpAt: next,
    });

    const state = await owner.query<{ status: string; activities: string; done: string; open: string; follow_up: string; audits: string }>(`
      select l.status::text,
        (select count(*) from activities where lead_id = l.id)::text activities,
        (select count(*) from tasks where lead_id = l.id and status = 'DONE')::text done,
        (select count(*) from tasks where lead_id = l.id and status = 'OPEN')::text open,
        (select count(*) from tasks where lead_id = l.id and type = 'FOLLOW_UP')::text follow_up,
        (select count(*) from audit_logs where subject_id = l.id and action = 'activity.create')::text audits
      from leads l where l.id = $1`, [created.leadId]);
    expect(state.rows[0]).toEqual({ status: "CONTACTED", activities: "1", done: "1", open: "1", follow_up: "1", audits: "1" });
  });

  it("跟进最后一步审计失败时前面所有副作用全部回滚", async () => {
    const ctx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { createLeadService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const created = await createLeadService(ctx, { contactName: "赵强", contactPhone: "13212345678" });
    if (!created.created) throw new Error("test lead was not created");
    await owner.query(`create or replace function fail_activity_audit() returns trigger language plpgsql as $$
      begin if new.action = 'activity.create' then raise exception 'forced audit failure'; end if; return new; end $$`);
    await owner.query(`create trigger test_fail_activity_audit before insert on audit_logs for each row execute function fail_activity_audit()`);
    try {
      await expect(logActivityService(ctx, {
        leadId: created.leadId, type: "CALL", outcome: "CONNECTED", summary: "本次必须回滚",
        nextFollowUpAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      })).rejects.toThrow("Failed query: insert into audit_logs");
    } finally {
      await owner.query("drop trigger if exists test_fail_activity_audit on audit_logs");
      await owner.query("drop function if exists fail_activity_audit()");
    }
    const state = await owner.query<{ status: string; activities: string; open_first: string; follow_up: string }>(`
      select l.status::text,
        (select count(*) from activities where lead_id = l.id)::text activities,
        (select count(*) from tasks where lead_id = l.id and status = 'OPEN' and type = 'FIRST_RESPONSE')::text open_first,
        (select count(*) from tasks where lead_id = l.id and type = 'FOLLOW_UP')::text follow_up
      from leads l where l.id = $1`, [created.leadId]);
    expect(state.rows[0]).toEqual({ status: "NEW", activities: "0", open_first: "1", follow_up: "0" });
  });

  it("导入线索保持未分配且不建任务，分配后才创建首次响应任务", async () => {
    const manager = { tenantId: tenantA, userId: activeUserId, role: "MANAGER" as const };
    const { assignLeadService, importLeadsService } = await import("@/core/leads/service");
    const result = await importLeadsService(manager, [{ contactName: "陈晨", contactPhone: "13112345678" }], true);
    expect(result).toEqual({ created: 1, skipped: 0, failed: 0 });
    const lead = await owner.query<{ id: string; owner_user_id: string | null; tasks: string }>(`
      select l.id, l.owner_user_id, (select count(*) from tasks where lead_id = l.id)::text tasks
      from leads l where tenant_id = $1 and contact_phone = '13112345678'`, [tenantA]);
    expect(lead.rows[0]).toMatchObject({ owner_user_id: null, tasks: "0" });
    await assignLeadService(manager, lead.rows[0].id, activeUserId);
    const task = await owner.query<{ owner_user_id: string; tasks: string }>(`
      select l.owner_user_id, (select count(*) from tasks where lead_id = l.id and status = 'OPEN')::text tasks
      from leads l where id = $1`, [lead.rows[0].id]);
    expect(task.rows[0]).toEqual({ owner_user_id: activeUserId, tasks: "1" });
  });

  it("SALES 只能看到自己的线索且不能调用分配，终态线索不能记跟进", async () => {
    const salesUserId = await createUser({ tenantId: tenantA, email: "sales@example.com" });
    await owner.query(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone)
       values ($1, $2, '其他销售线索', '13012345678')`,
      [tenantA, salesUserId],
    );
    const salesCtx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { assignLeadService, listLeadsService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const page = await listLeadsService(salesCtx);
    expect(page.items.every((lead) => lead.ownerUserId === activeUserId)).toBe(true);
    await expect(assignLeadService(salesCtx, page.items[0].id, salesUserId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const discarded = await owner.query<{ id: string }>(
      `insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, status, discard_reason)
       values ($1, $2, '已放弃线索', '18900001234', 'DISCARDED', 'NO_NEED') returning id`,
      [tenantA, activeUserId],
    );
    await expect(logActivityService(salesCtx, {
      leadId: discarded.rows[0].id, type: "NOTE", summary: "不应写入",
    })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("线索状态机执行合法路径并拒绝非法转换", async () => {
    const salesCtx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const managerCtx = { ...salesCtx, role: "MANAGER" as const };
    const { createLeadService, discardLeadService, qualifyLeadService, restoreLeadService, listLeadsService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const created = await createLeadService(salesCtx, { contactName: "状态机线索", contactPhone: "18700001234" });
    if (!created.created) throw new Error("test lead was not created");

    await expect(qualifyLeadService(salesCtx, created.leadId, "提前确认"))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await logActivityService(salesCtx, {
      leadId: created.leadId, type: "CALL", outcome: "INTERESTED", summary: "确认有采购需求",
    });
    await qualifyLeadService(salesCtx, created.leadId, "需要销售管理系统");
    await expect(qualifyLeadService(salesCtx, created.leadId, "重复确认"))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await discardLeadService(salesCtx, { leadId: created.leadId, reason: "NO_BUDGET" });

    // 验证：已放弃线索从活跃线索池自动隐藏，并进入 discarded 归档池
    const activePage = await listLeadsService(salesCtx, { filter: "all" });
    expect(activePage.items.some((item) => item.id === created.leadId)).toBe(false);
    const discardedPage = await listLeadsService(salesCtx, { filter: "discarded" });
    expect(discardedPage.items.some((item) => item.id === created.leadId)).toBe(true);

    await expect(restoreLeadService(salesCtx, created.leadId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await restoreLeadService(managerCtx, created.leadId);
    const restoredTask = await owner.query<{ count: string }>(
      "select count(*) from tasks where lead_id = $1 and status = 'OPEN' and type = 'FIRST_RESPONSE'",
      [created.leadId],
    );
    expect(restoredTask.rows[0].count).toBe("1");
    await expect(restoreLeadService(managerCtx, created.leadId)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    await owner.query("update leads set status = 'CONVERTED' where id = $1", [created.leadId]);
    await expect(discardLeadService(salesCtx, { leadId: created.leadId, reason: "NO_NEED" }))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("每次合法状态变化都留痕，非法转换零写入", async () => {
    const salesCtx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { createLeadService, qualifyLeadService, getLeadDetailService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const created = await createLeadService(salesCtx, {
      contactName: "状态记录测试",
      contactPhone: "18600004321",
      note: "原始备注必须保留",
    });
    if (!created.created) throw new Error("test lead was not created");

    let detail = await getLeadDetailService(salesCtx, created.leadId);
    expect(detail.statusHistory.map((item) => [item.fromStatus, item.toStatus])).toEqual([[null, "NEW"]]);

    await expect(qualifyLeadService(salesCtx, created.leadId, "非法提前确认"))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    detail = await getLeadDetailService(salesCtx, created.leadId);
    expect(detail.statusHistory).toHaveLength(1);

    await logActivityService(salesCtx, {
      leadId: created.leadId,
      type: "CALL",
      outcome: "INTERESTED",
      summary: "客户确认预算",
    });
    await qualifyLeadService(salesCtx, created.leadId, "需要 10 人销售协作");
    detail = await getLeadDetailService(salesCtx, created.leadId);

    expect(detail.lead.note).toBe("原始备注必须保留");
    expect(detail.statusHistory.map((item) => [item.fromStatus, item.toStatus])).toEqual([
      ["CONTACTED", "QUALIFIED"],
      ["NEW", "CONTACTED"],
      [null, "NEW"],
    ]);
    expect(detail.statusHistory[0].reason).toBe("需要 10 人销售协作");
    expect(detail.activities.map((activity) => activity.summary)).toEqual(["客户确认预算"]);
  });

  it("状态历史按租户隔离且详情时间线按发生时间倒序", async () => {
    const ctxA = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const ctxB = { tenantId: tenantB, userId: userBId, role: "SALES" as const };
    const { createLeadService, getLeadDetailService } = await import("@/core/leads/service");
    const { logActivityService } = await import("@/core/followup/service");
    const leadA = await createLeadService(ctxA, { contactName: "租户隔离详情", contactPhone: "18500004321" });
    const leadB = await createLeadService(ctxB, { contactName: "另一个租户", contactPhone: "18400004321" });
    if (!leadA.created || !leadB.created) throw new Error("test lead was not created");

    await logActivityService(ctxA, { leadId: leadA.leadId, type: "NOTE", summary: "较晚记录", occurredAt: new Date("2026-01-02T00:00:00Z") });
    await logActivityService(ctxA, { leadId: leadA.leadId, type: "NOTE", summary: "较早记录", occurredAt: new Date("2026-01-01T00:00:00Z") });
    const detail = await getLeadDetailService(ctxA, leadA.leadId);
    expect(detail.activities.map((activity) => activity.summary)).toEqual(["较晚记录", "较早记录"]);
    await expect(getLeadDetailService(ctxA, leadB.leadId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("编辑重复手机号零写入，并允许显式清空可选字段", async () => {
    const ctx = { tenantId: tenantA, userId: activeUserId, role: "SALES" as const };
    const { createLeadService, getLeadDetailService, updateLeadService } = await import("@/core/leads/service");
    const first = await createLeadService(ctx, { contactName: "编辑目标", contactPhone: "18300004321", companyName: "待清空公司" });
    const second = await createLeadService(ctx, { contactName: "重复目标", contactPhone: "18200004321" });
    if (!first.created || !second.created) throw new Error("test lead was not created");

    await expect(updateLeadService(ctx, first.leadId, { contactName: "不应保存", contactPhone: "18200004321" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    let detail = await getLeadDetailService(ctx, first.leadId);
    expect(detail.lead.contactName).toBe("编辑目标");
    expect(detail.lead.contactPhone).toBe("18300004321");

    await updateLeadService(ctx, first.leadId, { companyName: null });
    detail = await getLeadDetailService(ctx, first.leadId);
    expect(detail.lead.companyName).toBeNull();
  });
});
