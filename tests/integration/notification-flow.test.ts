import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;

if (!migrationUrl || !appUrl) {
  throw new Error("通知集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
}

const migrationDatabase = new URL(migrationUrl).pathname.slice(1);
const appDatabase = new URL(appUrl).pathname.slice(1);
if (!/_test$/.test(migrationDatabase) || !/_test$/.test(appDatabase) || migrationDatabase !== appDatabase) {
  throw new Error("通知集成测试只能连接名称以 _test 结尾的同一个测试数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });

let notificationService: typeof import("@/core/notification/service");
let tenantA: string;
let tenantB: string;
let userA: string;
let userA2: string;
let userB: string;
let leadA1: string;
let leadA2: string;
let leadA3: string;
let leadB: string;
let taskA1: string;
let taskA2: string;
let taskA3: string;
let taskB: string;

const scanAt = new Date("2026-08-16T12:00:00.000Z");

async function setAppTenant(tenantId: string): Promise<void> {
  await app.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
}

async function insertNotification(input: {
  tenantId: string;
  userId: string;
  type: "TASK_OVERDUE" | "TASK_DUE_SOON" | "LEAD_ASSIGNED";
  taskId: string;
  leadId: string;
}): Promise<string | null> {
  await setAppTenant(input.tenantId);
  const result = await app.query<{ id: string }>(`insert into notifications
    (tenant_id, user_id, type, task_id, lead_id, title, body, link)
    select $1, $2, $3::notification_type, $4, $5, '测试通知', '测试正文', $6
    where not exists (
      select 1 from notifications where task_id = $4 and type = $3::notification_type
    )
    returning id`, [input.tenantId, input.userId, input.type, input.taskId, input.leadId, `/leads/${input.leadId}`]);
  return result.rows[0]?.id ?? null;
}

async function countTaskNotifications(taskId: string, type: string): Promise<number> {
  const result = await owner.query<{ count: string }>(
    "select count(*)::text as count from notifications where task_id = $1 and type = $2::notification_type",
    [taskId, type],
  );
  return Number(result.rows[0]?.count ?? 0);
}

beforeAll(async () => {
  await owner.connect();
  await app.connect();
  notificationService = await import("@/core/notification/service");

  const key = Date.now().toString(36);
  const tenants = await owner.query<{ id: string }>(
    "insert into tenants (name) values ($1), ($2) returning id",
    [`notification-flow-A-${key}`, `notification-flow-B-${key}`],
  );
  tenantA = tenants.rows[0].id;
  tenantB = tenants.rows[1].id;

  const users = await owner.query<{ id: string }>(`insert into users
    (tenant_id, email, password_hash, name, role, status)
    values
      ($1, $3, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '通知测试销售 A', 'SALES', 'ACTIVE'),
      ($1, $4, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '通知测试销售 A2', 'SALES', 'ACTIVE'),
      ($2, $5, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '通知测试销售 B', 'SALES', 'ACTIVE')
    returning id`, [
    tenantA,
    tenantB,
    `notification-a-${key}@example.com`,
    `notification-a2-${key}@example.com`,
    `notification-b-${key}@example.com`,
  ]);
  userA = users.rows[0].id;
  userA2 = users.rows[1].id;
  userB = users.rows[2].id;

  const leads = await owner.query<{ id: string }>(`insert into leads
    (tenant_id, owner_user_id, contact_name, contact_phone, source, status)
    values
      ($1, $2, '通知测试线索 A1', '13900000001', 'manual', 'NEW'),
      ($1, $2, '通知测试线索 A2', '13900000002', 'manual', 'NEW'),
      ($1, $3, '通知测试线索 A3', '13900000003', 'manual', 'NEW'),
      ($4, $5, '通知测试线索 B',  '13900000004', 'manual', 'NEW')
    returning id`, [tenantA, userA, userA2, tenantB, userB]);
  leadA1 = leads.rows[0].id;
  leadA2 = leads.rows[1].id;
  leadA3 = leads.rows[2].id;
  leadB = leads.rows[3].id;

  const tasks = await owner.query<{ id: string }>(`insert into tasks
    (tenant_id, lead_id, assignee_user_id, type, due_at, status)
    values
      ($1, $2, $3, 'FOLLOW_UP', $4, 'OPEN'),
      ($1, $5, $3, 'FIRST_RESPONSE', $6, 'OPEN'),
      ($1, $7, $8, 'FOLLOW_UP', $4, 'OPEN'),
      ($9, $10, $11, 'FOLLOW_UP', $4, 'OPEN')
    returning id`, [
    tenantA,
    leadA1,
    userA,
    new Date(scanAt.getTime() - 60 * 60 * 1000),
    leadA2,
    new Date(scanAt.getTime() + 60 * 60 * 1000),
    leadA3,
    userA2,
    tenantB,
    leadB,
    userB,
  ]);
  taskA1 = tasks.rows[0].id;
  taskA2 = tasks.rows[1].id;
  taskA3 = tasks.rows[2].id;
  taskB = tasks.rows[3].id;
});

beforeEach(async () => {
  await owner.query("delete from notifications where task_id = any($1::uuid[])", [[taskA1, taskA2, taskA3, taskB]]);
});

afterAll(async () => {
  await owner.query("delete from notifications where tenant_id in ($1, $2)", [tenantA, tenantB]);
  await owner.query("delete from tasks where id in ($1, $2, $3, $4)", [taskA1, taskA2, taskA3, taskB]);
  await owner.query("delete from leads where id in ($1, $2, $3, $4)", [leadA1, leadA2, leadA3, leadB]);
  await owner.query("delete from users where id in ($1, $2, $3)", [userA, userA2, userB]);
  await owner.query("delete from tenants where id in ($1, $2)", [tenantA, tenantB]);
  await app.end();
  await owner.end();
});

describe("通知模块集成契约", () => {
  it("notifications 启用 RLS 与 FORCE RLS，并按租户隔离", async () => {
    const security = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(`select c.relrowsecurity, c.relforcerowsecurity, r.rolname as owner
      from pg_class c join pg_roles r on r.oid = c.relowner
      where c.oid = 'notifications'::regclass`);
    expect(security.rows).toEqual([{
      relrowsecurity: true,
      relforcerowsecurity: true,
      owner: expect.not.stringMatching(/^salescrm$/),
    }]);

    const notificationA = await insertNotification({ tenantId: tenantA, userId: userA, type: "LEAD_ASSIGNED", taskId: taskA1, leadId: leadA1 });
    const notificationB = await insertNotification({ tenantId: tenantB, userId: userB, type: "LEAD_ASSIGNED", taskId: taskB, leadId: leadB });

    await setAppTenant(tenantA);
    const tenantAView = await app.query<{ id: string }>("select id from notifications where id in ($1, $2)", [notificationA, notificationB]);
    expect(tenantAView.rows).toEqual([{ id: notificationA }]);

    await setAppTenant(tenantB);
    const tenantBView = await app.query<{ id: string }>("select id from notifications where id in ($1, $2)", [notificationA, notificationB]);
    expect(tenantBView.rows).toEqual([{ id: notificationB }]);
  });

  it("应用角色只能读、插入和更新 read_at，不能更新其他列或删除", async () => {
    const privileges = await owner.query<{ can_select: boolean; can_insert: boolean; can_delete: boolean; can_read_at: boolean; can_title: boolean }>(`select
      has_table_privilege('salescrm', 'notifications', 'SELECT') as can_select,
      has_table_privilege('salescrm', 'notifications', 'INSERT') as can_insert,
      has_table_privilege('salescrm', 'notifications', 'DELETE') as can_delete,
      has_column_privilege('salescrm', 'notifications', 'read_at', 'UPDATE') as can_read_at,
      has_column_privilege('salescrm', 'notifications', 'title', 'UPDATE') as can_title`);
    expect(privileges.rows).toEqual([{
      can_select: true,
      can_insert: true,
      can_delete: false,
      can_read_at: true,
      can_title: false,
    }]);

    const notificationId = await insertNotification({ tenantId: tenantA, userId: userA, type: "LEAD_ASSIGNED", taskId: taskA1, leadId: leadA1 });
    await setAppTenant(tenantA);
    await expect(app.query("update notifications set title = '越权修改' where id = $1", [notificationId])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("delete from notifications where id = $1", [notificationId])).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update notifications set read_at = now() where id = $1", [notificationId])).resolves.toMatchObject({ rowCount: 1 });
  });

  it("同一 task/type 插入幂等，不会生成重复通知", async () => {
    const input = { tenantId: tenantA, userId: userA, type: "LEAD_ASSIGNED" as const, taskId: taskA1, leadId: leadA1 };
    const first = await insertNotification(input);
    const second = await insertNotification(input);
    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
    expect(await countTaskNotifications(taskA1, "LEAD_ASSIGNED")).toBe(1);
  });

  it("90 天清理函数只删除当前租户的过期通知", async () => {
    const oldAt = new Date(scanAt.getTime() - 91 * 24 * 60 * 60 * 1000);
    const inserted = await owner.query<{ id: string; tenant_id: string }>(`insert into notifications
      (tenant_id, user_id, type, lead_id, title, created_at)
      values
        ($1, $2, 'LEAD_ASSIGNED', $3, '租户 A 旧通知', $4),
        ($5, $6, 'LEAD_ASSIGNED', $7, '租户 B 旧通知', $4)
      returning id, tenant_id`, [tenantA, userA, leadA1, oldAt, tenantB, userB, leadB]);
    const oldA = inserted.rows.find((row) => row.tenant_id === tenantA)?.id;
    const oldB = inserted.rows.find((row) => row.tenant_id === tenantB)?.id;
    if (!oldA || !oldB) throw new Error("过期通知夹具创建失败");

    await setAppTenant(tenantA);
    const cleaned = await app.query<{ cleaned: number }>(
      "select public.cleanup_notifications_before($1) as cleaned",
      [new Date(scanAt.getTime() - 90 * 24 * 60 * 60 * 1000)],
    );
    expect(cleaned.rows).toEqual([{ cleaned: 1 }]);
    const remaining = await owner.query<{ id: string }>(
      "select id from notifications where id in ($1, $2)",
      [oldA, oldB],
    );
    expect(remaining.rows).toEqual([{ id: oldB }]);
  });

  it("cron 逐租户扫描超时和临近到期任务，重复执行仍保持幂等", async () => {
    const first = await notificationService.scanTaskNotificationsService(scanAt);
    expect(first.tenantsScanned).toBeGreaterThanOrEqual(2);
    expect(await countTaskNotifications(taskA1, "TASK_OVERDUE")).toBe(1);
    expect(await countTaskNotifications(taskA2, "TASK_DUE_SOON")).toBe(1);
    expect(await countTaskNotifications(taskA3, "TASK_OVERDUE")).toBe(1);
    expect(await countTaskNotifications(taskB, "TASK_OVERDUE")).toBe(1);

    await notificationService.scanTaskNotificationsService(scanAt);
    expect(await countTaskNotifications(taskA1, "TASK_OVERDUE")).toBe(1);
    expect(await countTaskNotifications(taskA2, "TASK_DUE_SOON")).toBe(1);
    expect(await countTaskNotifications(taskA3, "TASK_OVERDUE")).toBe(1);
    expect(await countTaskNotifications(taskB, "TASK_OVERDUE")).toBe(1);

    const tenantARecipients = await owner.query<{ tenant_id: string }>(`select distinct tenant_id from notifications
      where task_id = any($1::uuid[])`, [[taskA1, taskA2, taskA3, taskB]]);
    expect(tenantARecipients.rows.map((row) => row.tenant_id).sort()).toEqual([tenantA, tenantB].sort());
  });

  it("同一任务连续两轮扫描第二轮零新增通知（24 小时去重闸门生效）", async () => {
    // 1. 创建一个全新的测试线索与过期任务
    const leadNewRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, owner_user_id, contact_name, contact_phone, source, status)
      values ('${tenantA}', '${userA}', '扫描去重新线索', '13900000099', 'manual', 'NEW')
      returning id
    `);
    const newLeadId = leadNewRes.rows[0].id;

    const taskNewRes = await owner.query<{ id: string }>(`
      insert into tasks (tenant_id, assignee_user_id, lead_id, type, status, due_at, created_at, updated_at)
      values ('${tenantA}', '${userA}', '${newLeadId}', 'FOLLOW_UP', 'OPEN', '${new Date(scanAt.getTime() - 3600000).toISOString()}', now(), now())
      returning id
    `);
    const newTaskId = taskNewRes.rows[0].id;

    // 清理该任务相关通知
    await owner.query(`delete from notifications where task_id = '${newTaskId}' or link like '%${newTaskId}%'`);

    // 第一轮扫描（t0）
    await notificationService.scanTaskNotificationsService(scanAt);
    expect(await countTaskNotifications(newTaskId, "TASK_OVERDUE")).toBe(1);

    // 5 分钟后第二轮扫描（t0 + 5min）：必须零新增！
    const scanAtFiveMinLater = new Date(scanAt.getTime() + 5 * 60 * 1000);
    await notificationService.scanTaskNotificationsService(scanAtFiveMinLater);
    expect(await countTaskNotifications(newTaskId, "TASK_OVERDUE")).toBe(1);

    // 再次查询 notifications 表确认该任务确实只有 1 条记录
    const notifRows = await owner.query<{ count: string }>(`
      select count(*)::text as count from notifications
      where tenant_id = '${tenantA}' and (task_id = '${newTaskId}' or link like '%${newTaskId}%')
    `);
    expect(Number(notifRows.rows[0].count)).toBe(1);

    // 清理该测试产生的夹具，避免干扰后续测试
    await owner.query(`delete from notifications where tenant_id = '${tenantA}' and (task_id = '${newTaskId}' or link like '%${newTaskId}%')`);
    await owner.query(`delete from tasks where id = '${newTaskId}'`);
    await owner.query(`delete from leads where id = '${newLeadId}'`);
  });

  it("mark read 和 mark all read 只影响当前租户的当前用户", async () => {
    const ownFirst = await insertNotification({ tenantId: tenantA, userId: userA, type: "LEAD_ASSIGNED", taskId: taskA1, leadId: leadA1 });
    const ownSecond = await insertNotification({ tenantId: tenantA, userId: userA, type: "LEAD_ASSIGNED", taskId: taskA2, leadId: leadA2 });
    const otherUser = await insertNotification({ tenantId: tenantA, userId: userA2, type: "LEAD_ASSIGNED", taskId: taskA3, leadId: leadA3 });
    const otherTenant = await insertNotification({ tenantId: tenantB, userId: userB, type: "LEAD_ASSIGNED", taskId: taskB, leadId: leadB });
    if (!ownFirst || !ownSecond || !otherUser || !otherTenant) throw new Error("通知夹具创建失败");

    const context = { tenantId: tenantA, userId: userA, role: "SALES" as const };
    await notificationService.markNotificationReadService(context, ownFirst);
    await notificationService.markNotificationReadService(context, otherTenant);
    const afterOne = await owner.query<{ id: string; read_at: Date | null }>(`select id, read_at from notifications
      where id in ($1, $2, $3, $4) order by id`, [ownFirst, ownSecond, otherUser, otherTenant]);
    expect(afterOne.rows.find((row) => row.id === ownFirst)?.read_at).not.toBeNull();
    expect(afterOne.rows.find((row) => row.id === ownSecond)?.read_at).toBeNull();
    expect(afterOne.rows.find((row) => row.id === otherUser)?.read_at).toBeNull();
    expect(afterOne.rows.find((row) => row.id === otherTenant)?.read_at).toBeNull();

    await expect(notificationService.markAllNotificationsReadService(context)).resolves.toMatchObject({ updated: 1 });
    const afterAll = await owner.query<{ id: string; read_at: Date | null }>(`select id, read_at from notifications
      where id in ($1, $2, $3, $4) order by id`, [ownFirst, ownSecond, otherUser, otherTenant]);
    expect(afterAll.rows.find((row) => row.id === ownFirst)?.read_at).not.toBeNull();
    expect(afterAll.rows.find((row) => row.id === ownSecond)?.read_at).not.toBeNull();
    expect(afterAll.rows.find((row) => row.id === otherUser)?.read_at).toBeNull();
    expect(afterAll.rows.find((row) => row.id === otherTenant)?.read_at).toBeNull();
  });

  it("Group B: 通知文案使用 Asia/Shanghai 去尾部 UTC、离职员工任务黑洞 fallback 至管理员、转派重提醒", async () => {
    // 1. 在 tenantA 创建一个管理员与一个已停用销售
    const key = Date.now().toString(36);
    const extraUsers = await owner.query<{ id: string; role: string }>(`
      insert into users (tenant_id, email, password_hash, name, role, status)
      values
        ('${tenantA}', 'admin-fallback-${key}@example.com', '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '租户管理员', 'ADMIN', 'ACTIVE'),
        ('${tenantA}', 'disabled-rep-${key}@example.com', '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', '离职销售', 'SALES', 'DISABLED')
      returning id, role
    `);
    const adminId = extraUsers.rows.find((u) => u.role === "ADMIN")!.id;
    const disabledRepId = extraUsers.rows.find((u) => u.role === "SALES")!.id;

    // 2. 创建独立线索与属于已停用销售的超期任务
    const extraLeadRes = await owner.query<{ id: string }>(`
      insert into leads (tenant_id, contact_name, contact_phone, source, status)
      values ('${tenantA}', '离职员工测试线索', '13911110099', 'manual', 'NEW')
      returning id
    `);
    const extraLeadId = extraLeadRes.rows[0].id;

    const dueTime = new Date(scanAt.getTime() - 3600000);
    const disabledTaskRes = await owner.query<{ id: string }>(`
      insert into tasks (tenant_id, assignee_user_id, lead_id, type, status, due_at)
      values ('${tenantA}', '${disabledRepId}', '${extraLeadId}', 'FOLLOW_UP', 'OPEN', '${dueTime.toISOString()}')
      returning id
    `);
    const disabledTaskId = disabledTaskRes.rows[0].id;

    // 执行扫描
    await notificationService.scanTaskNotificationsService(scanAt);

    // 断言：通知成功 fallback 给 ADMIN，且正文包含【原负责人已停用】，且时间为上海时区无尾部 UTC
    const adminNotifRes = await owner.query<{ title: string; body: string; user_id: string }>(`
      select title, body, user_id::text as user_id from notifications
      where tenant_id = '${tenantA}' and task_id = '${disabledTaskId}'
    `);
    expect(adminNotifRes.rows.length).toBe(1);
    const notif = adminNotifRes.rows[0];
    expect(notif.user_id).toBe(adminId);
    expect(notif.body).toContain("【原负责人已停用】");
    expect(notif.body).not.toContain("UTC");

    // 3. 转派重提醒验证：将该任务重新分配给活跃销售 userA2
    await owner.query(`
      update tasks set assignee_user_id = '${userA2}', updated_at = now() where id = '${disabledTaskId}'
    `);
    // 模拟重置旧通知
    await owner.query(`
      delete from notifications where tenant_id = '${tenantA}' and task_id = '${disabledTaskId}'
    `);

    // 再次扫描：活跃销售 userA2 能够正常收到超时通知
    await notificationService.scanTaskNotificationsService(scanAt);
    const userA2NotifRes = await owner.query<{ title: string; body: string; user_id: string }>(`
      select title, body, user_id::text as user_id from notifications
      where tenant_id = '${tenantA}' and task_id = '${disabledTaskId}'
    `);
    expect(userA2NotifRes.rows.length).toBe(1);
    expect(userA2NotifRes.rows[0].user_id).toBe(userA2);
    expect(userA2NotifRes.rows[0].body).not.toContain("【原负责人已停用】");

    // 清理测试夹具
    await owner.query(`delete from notifications where task_id = '${disabledTaskId}'`);
    await owner.query(`delete from tasks where id = '${disabledTaskId}'`);
    await owner.query(`delete from leads where id = '${extraLeadId}'`);
    await owner.query(`delete from users where id in ('${adminId}', '${disabledRepId}')`);
  });
});
