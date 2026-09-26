import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * CSV 线索批量导入：分块批处理与同批去重 —— 行为级集成测试（真 DB / 真 service）
 *
 * 替代原 tests/unit/efficiency-regression.test.ts 的「vi.mock 计数」伪断言（那段代码
 * 只是在测试文件里自己算 500/200 完全没有调用被测实现）与
 * tests/unit/wave7-financial-integrity.test.ts 的 F11 源码字符串断言。
 */

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const PW = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";

describe("CSV 批量导入行为（分块批处理 + 同批去重）", { timeout: 60000 }, () => {
  let tenantId: string;
  let managerId: string;
  const mgrCtx = () => ({ tenantId, userId: managerId, role: "MANAGER" as const });
  const ts = Date.now();

  beforeAll(async () => {
    await owner.connect();
    const tRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('CSV导入行为租户') returning id`);
    tenantId = tRes.rows[0].id;
    const uRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash) values ($1,$2,'导入主管','MANAGER','ACTIVE',$3) returning id`,
      [tenantId, `csvimp-${ts}@test.com`, PW],
    );
    managerId = uRes.rows[0].id;
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from tasks where tenant_id = $1", [tenantId]);
      await owner.query("delete from lead_status_history where tenant_id = $1", [tenantId]);
      await owner.query("update leads set customer_id = null where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await owner.end();
  });

  it("500 行一次性导入全部落库（跨越多个 200 行批次，计数与库内实际行数一致）", async () => {
    const { importLeadsService } = await import("@/core/leads/service");
    const rows = Array.from({ length: 500 }, (_, i) => ({
      contactName: `批量线索${i}`,
      contactPhone: `139${String(10000000 + i)}`,
    }));
    const result = await importLeadsService(mgrCtx(), rows, true);
    expect(result).toMatchObject({ created: 500, skipped: 0, failed: 0 });

    const count = await owner.query<{ count: string }>(`select count(*)::text as count from leads where tenant_id = $1`, [tenantId]);
    expect(count.rows[0].count).toBe("500");
  });

  it("同批重复手机号：首行创建，后续同批重复计 skipped（不产生第二条线索）", async () => {
    const { importLeadsService } = await import("@/core/leads/service");
    const before = await owner.query<{ count: string }>(`select count(*)::text as count from leads where tenant_id = $1`, [tenantId]);
    const beforeCount = Number(before.rows[0].count);

    const dupPhone = `137${String(20000000 + (ts % 100000))}`;
    const result = await importLeadsService(
      mgrCtx(),
      [
        { contactName: "同批首行", contactPhone: dupPhone },
        { contactName: "同批重复行", contactPhone: dupPhone },
        { contactName: "同批第三行", contactPhone: `137${String(30000000 + (ts % 100000))}` },
      ],
      true,
    );
    expect(result).toMatchObject({ created: 2, skipped: 1, failed: 0 });

    const dupCount = await owner.query<{ count: string }>(
      `select count(*)::text as count from leads where tenant_id = $1 and contact_phone = $2`,
      [tenantId, dupPhone],
    );
    expect(dupCount.rows[0].count).toBe("1");

    const after = await owner.query<{ count: string }>(`select count(*)::text as count from leads where tenant_id = $1`, [tenantId]);
    expect(Number(after.rows[0].count)).toBe(beforeCount + 2);
  });

  it("库内已存在的手机号在 skipDuplicates=true 时计 skipped（跨批去重）", async () => {
    const { importLeadsService } = await import("@/core/leads/service");
    const existing = await owner.query<{ contact_phone: string }>(
      `select contact_phone from leads where tenant_id = $1 order by created_at limit 1`,
      [tenantId],
    );
    const phone = existing.rows[0].contact_phone;
    const result = await importLeadsService(mgrCtx(), [{ contactName: "跨批重复", contactPhone: phone }], true);
    expect(result).toMatchObject({ created: 0, skipped: 1, failed: 0 });
  });

  it("SALES 角色无权执行批量导入", async () => {
    const { importLeadsService } = await import("@/core/leads/service");
    const salesRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, name, role, status, password_hash) values ($1,$2,'导入销售','SALES','ACTIVE',$3) returning id`,
      [tenantId, `csvsales-${ts}@test.com`, PW],
    );
    const salesCtx = { tenantId, userId: salesRes.rows[0].id, role: "SALES" as const };
    await expect(
      importLeadsService(salesCtx, [{ contactName: "越权", contactPhone: "13612341234" }], true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("单次超过 1000 行被拒（保护上限真实生效）", async () => {
    const { importLeadsService } = await import("@/core/leads/service");
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      contactName: `超限${i}`,
      contactPhone: `135${String(10000000 + i)}`,
    }));
    await expect(importLeadsService(mgrCtx(), rows, true)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
