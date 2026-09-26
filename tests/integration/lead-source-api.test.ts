import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("Lead API 集成测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("Lead API 集成测试不得使用开发数据库");
}
process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const app = new pg.Client({ connectionString: appUrl });
let tenantId: string;
let userId: string;
let sourceKeyId: string;
const token = "sk_live_test_external_api_token";
const sourceKey = "website-form";

async function postLead(idempotencyKey: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/leads/route");
  return POST(new Request("http://localhost/api/v1/leads", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const payload = {
  externalId: "crm-1001",
  contactName: "API 联系人",
  contactPhone: "13812345001",
  contactEmail: "api@example.com",
  companyName: "API 公司",
  title: "采购负责人",
  note: "来自官网表单",
  sourceLabel: "官网咨询",
};

beforeAll(async () => {
  await owner.connect();
  await app.connect();
  await owner.query("truncate table users, tenants cascade");
  const tenant = await owner.query<{ id: string }>("insert into tenants (name) values ('lead API 测试') returning id");
  tenantId = tenant.rows[0].id;
  const user = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
    values ($1, $2, '$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K', 'API 管理员', 'ADMIN') returning id`,
  [tenantId, `lead-api-${Date.now()}@example.com`]);
  userId = user.rows[0].id;
  const source = await owner.query<{ id: string }>(`insert into lead_source_keys
    (tenant_id, name, source_key, token_hash, created_by_user_id)
    values ($1, '官网接口', $2, encode(digest($3, 'sha256'), 'hex'), $4) returning id`,
  [tenantId, sourceKey, token, userId]);
  sourceKeyId = source.rows[0].id;
});

afterAll(async () => {
  await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
  await owner.query("delete from notifications where tenant_id = $1", [tenantId]);
  await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
  await owner.query("delete from activities where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_intake_requests where tenant_id = $1", [tenantId]);
  await owner.query("delete from leads where tenant_id = $1", [tenantId]);
  await owner.query("delete from lead_source_keys where tenant_id = $1", [tenantId]);
  await owner.query("delete from users where tenant_id = $1", [tenantId]);
  await owner.query("delete from tenants where id = $1", [tenantId]);
  const { closeDb } = await import("@/db/client");
  await closeDb();
  await app.end();
  await owner.end();
});

describe("外部 API 进线", () => {
  it("创建线索、保存来源证据且不创建未分配任务", async () => {
    const response = await postLead("request-1", payload);
    expect(response.status).toBe(201);
    const result = await response.json() as { leadId: string; duplicateSuspected: boolean };
    expect(result.duplicateSuspected).toBe(false);

    const rows = await owner.query<{
      source: string; owner_user_id: string | null; external_id: string; source_label: string; received_at: string | null;
    }>(`select source, owner_user_id, external_id, source_label, received_at from leads where id = $1`, [result.leadId]);
    expect(rows.rows[0]).toMatchObject({ source: `api:${sourceKey}`, owner_user_id: null, external_id: "crm-1001", source_label: "官网咨询" });
    expect(rows.rows[0].received_at).toBeTruthy();
    expect((await owner.query("select id from tasks where lead_id = $1", [result.leadId])).rowCount).toBe(0);
    expect((await owner.query("select id from lead_intake_requests where source_key_id = $1", [sourceKeyId])).rowCount).toBe(1);
    expect((await owner.query("select id from lead_status_history where lead_id = $1 and actor_user_id = $2", [result.leadId, userId])).rowCount).toBe(1);
    const { getLeadDetailService } = await import("@/core/leads/service");
    const detail = await getLeadDetailService({ tenantId, userId, role: "ADMIN" }, result.leadId);
    expect(detail.lead).toMatchObject({
      sourceName: "官网接口",
      sourceKey,
      externalId: "crm-1001",
      sourceLabel: "官网咨询",
    });
    expect(detail.lead.receivedAt).toBeTruthy();
    await expect(getLeadDetailService({ tenantId, userId, role: "SALES" }, result.leadId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("仅 ADMIN 可以管理本租户来源密钥，MANAGER/SALES 被拒绝", async () => {
    const { createLeadSourceKeyService, listLeadSourceKeysService, revokeLeadSourceKeyService } = await import("@/core/leads/service");
    const admin = { tenantId, userId, role: "ADMIN" as const };
    const manager = { tenantId, userId, role: "MANAGER" as const };
    const created = await createLeadSourceKeyService(admin, { name: "营销落地页", sourceKey: "campaign-form" });
    expect(created.token).toMatch(/^sk_live_/);
    expect((await listLeadSourceKeysService(admin)).find((item) => item.id === created.sourceKeyId)).toMatchObject({
      name: "营销落地页",
      sourceKey: "campaign-form",
      revokedAt: null,
    });
    await expect(createLeadSourceKeyService(admin, { name: "重复来源", sourceKey: "campaign-form" }))
      .rejects.toMatchObject({ code: "CONFLICT", field: "sourceKey" });
    await expect(revokeLeadSourceKeyService(admin, created.sourceKeyId)).resolves.toMatchObject({ sourceKeyId: created.sourceKeyId });
    expect((await listLeadSourceKeysService({ tenantId, userId, role: "ADMIN" })).find((item) => item.id === created.sourceKeyId)?.revokedAt).toBeTruthy();
    await expect(listLeadSourceKeysService(manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createLeadSourceKeyService(manager, { name: "无权", sourceKey: "manager-key" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeLeadSourceKeyService(manager, sourceKeyId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const sales = { tenantId, userId, role: "SALES" as const };
    await expect(listLeadSourceKeysService(sales)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createLeadSourceKeyService(sales, { name: "无权", sourceKey: "blocked-key" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(revokeLeadSourceKeyService(sales, sourceKeyId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("W10-6 来源密钥创建与撤销写入审计", async () => {
    const { createLeadSourceKeyService, revokeLeadSourceKeyService } = await import("@/core/leads/service");
    const admin = { tenantId, userId, role: "ADMIN" as const };
    const created = await createLeadSourceKeyService(admin, {
      name: "W10-6 审计 Key",
      sourceKey: `w10_audit_${Date.now()}`,
    });
    await revokeLeadSourceKeyService(admin, created.sourceKeyId);
    const auditRows = await owner.query<{ action: string; actor_user_id: string; subject_id: string }>(
      `select action, actor_user_id, subject_id
       from audit_logs
       where tenant_id = $1 and subject_id = $2 and action in ('api_key.create', 'api_key.revoke')
       order by created_at asc`,
      [tenantId, created.sourceKeyId],
    );
    expect(auditRows.rows.map((row) => row.action)).toEqual(["api_key.create", "api_key.revoke"]);
    expect(auditRows.rows.every((row) => row.actor_user_id === userId && row.subject_id === created.sourceKeyId)).toBe(true);
  });

  it("相同幂等键重放，载荷变化冲突，并发只创建一条", async () => {
    const first = await postLead("request-1", payload);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { leadId: string };

    const changed = await postLead("request-1", { ...payload, note: "修改后的载荷" });
    expect(changed.status).toBe(409);
    await expect(changed.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const concurrentPayload = { ...payload, externalId: "crm-concurrent" };
    const responses = await Promise.all([
      postLead("request-concurrent", concurrentPayload),
      postLead("request-concurrent", concurrentPayload),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ leadId: string }>));
    expect(bodies[0].leadId).toBe(bodies[1].leadId);
    expect(firstBody.leadId).not.toBe(bodies[0].leadId);
    expect((await owner.query("select id from lead_intake_requests where idempotency_key = 'request-concurrent'", [])).rowCount).toBe(1);
  });

  it("拒绝无效凭证、非法字段和非法手机号", async () => {
    const missing = await (await import("@/app/api/v1/leads/route")).POST(new Request("http://localhost/api/v1/leads", { method: "POST" }));
    expect(missing.status).toBe(401);
    const invalid = await postLead("request-invalid", { ...payload, contactPhone: "123" });
    expect(invalid.status).toBe(400);
    const forbiddenField = await postLead("request-field", { ...payload, ownerUserId: userId });
    expect(forbiddenField.status).toBe(400);
  });

  it("撤销来源密钥后立即返回 401，超过 60 次返回 429", async () => {
    await owner.query("update lead_source_keys set rate_window_started_at = now(), rate_window_count = 60 where id = $1", [sourceKeyId]);
    const limited = await postLead("request-rate-limit", { ...payload, externalId: "rate-limit" });
    expect(limited.status).toBe(429);
    await owner.query("update lead_source_keys set revoked_at = now(), rate_window_count = 0 where id = $1", [sourceKeyId]);
    const revoked = await postLead("request-revoked", { ...payload, externalId: "revoked" });
    expect(revoked.status).toBe(401);
  });

  it("W10-5 外部进线读取自定义限流并校验 IP 白名单", async () => {
    const { POST } = await import("@/app/api/v1/leads/route");
    const postWithKey = async (token: string, idempotencyKey: string, body: Record<string, unknown>, ip: string) => POST(new Request("http://localhost/api/v1/leads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idempotencyKey,
        "Content-Type": "application/json",
        "X-Real-IP": ip,
      },
      body: JSON.stringify(body),
    }));

    const rateToken = `sk_live_w10_rate_${Date.now()}`;
    await owner.query(
      `insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id, rate_limit_per_minute)
       values ($1, 'W10-5 限流 Key', 'w10_rate_key', encode(digest($2, 'sha256'), 'hex'), $3, 1)`,
      [tenantId, rateToken, userId],
    );
    const first = await postWithKey(rateToken, "w10-rate-1", { ...payload, externalId: "w10-rate-1", contactPhone: "13812345010" }, "10.0.0.1");
    expect(first.status).toBe(201);
    const second = await postWithKey(rateToken, "w10-rate-2", { ...payload, externalId: "w10-rate-2", contactPhone: "13812345011" }, "10.0.0.1");
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });

    const ipToken = `sk_live_w10_ip_${Date.now()}`;
    await owner.query(
      `insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id, allowed_ip_ranges)
       values ($1, 'W10-5 IP Key', 'w10_ip_key', encode(digest($2, 'sha256'), 'hex'), $3, '203.0.113.0/24')`,
      [tenantId, ipToken, userId],
    );
    const denied = await postWithKey(ipToken, "w10-ip-denied", { ...payload, externalId: "w10-ip-denied", contactPhone: "13812345012" }, "198.51.100.10");
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    const allowed = await postWithKey(ipToken, "w10-ip-allowed", { ...payload, externalId: "w10-ip-allowed", contactPhone: "13812345013" }, "203.0.113.10");
    expect(allowed.status).toBe(201);
  });

  it("token 仅保存 hash，来源表和幂等表启用并强制 RLS", async () => {
    const stored = await owner.query<{ token_hash: string }>(
      "select token_hash from lead_source_keys where id = $1", [sourceKeyId],
    );
    expect(stored.rows[0].token_hash).not.toBe(token);
    expect(stored.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    const security = await owner.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relname in ('lead_source_keys', 'lead_intake_requests') order by relname`,
    );
    expect(security.rows).toEqual([
      { relname: "lead_intake_requests", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "lead_source_keys", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const functionOwner = await owner.query<{ owner: string }>(
      `select r.rolname as owner from pg_proc p join pg_roles r on r.oid = p.proowner
       where p.proname = 'lookup_lead_source_token'`,
    );
    expect(functionOwner.rows[0].owner).toBe("salescrm_auth");
  });

  it("撞他人私海不再制造重复线索：与手工录入口径对齐", async () => {
    // 前序用例已撤销原密钥，这里建独立密钥
    const dupToken = "sk_live_dup_collision_token";
    await owner.query(
      `insert into lead_source_keys (tenant_id, name, source_key, token_hash, created_by_user_id)
       values ($1, '撞单测试接口', 'dup-source', encode(digest($2, 'sha256'), 'hex'), $3)`,
      [tenantId, dupToken, userId],
    );
    const sales = await owner.query<{ id: string }>(`insert into users (tenant_id, email, password_hash, name, role)
      values ($1, $2, 'hash', '私海销售', 'SALES') returning id`, [tenantId, `api-sales-${Date.now()}@example.com`]);
    await owner.query(
      `insert into leads (tenant_id, contact_name, contact_phone, company_name, owner_user_id, status)
       values ($1, '私海已有线索', '13812345009', '私海公司', $2, 'CONTACTED')`,
      [tenantId, sales.rows[0].id],
    );

    const { POST } = await import("@/app/api/v1/leads/route");
    const response = await POST(new Request("http://localhost/api/v1/leads", {
      method: "POST",
      headers: { Authorization: `Bearer ${dupToken}`, "Idempotency-Key": "request-dup-1", "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, externalId: "crm-dup-1", contactPhone: "13812345009" }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json() as { leadId: string | null; duplicateSuspected: boolean };
    expect(result.duplicateSuspected).toBe(true);
    expect(result.leadId).toBeNull();

    // 线索库中该手机号仍只有原来一条，未新增重复
    const count = await owner.query<{ count: string }>(
      "select count(*)::text as count from leads where tenant_id = $1 and contact_phone = '13812345009'",
      [tenantId],
    );
    expect(count.rows[0].count).toBe("1");
  });
});
