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

let teamService: typeof import("@/core/team/service");
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let ctx: TenantContext;

describe("企业组织架构、团队成员与离职资产交接集成测试 (Team & Organization Management)", () => {
  beforeAll(async () => {
    await owner.connect();
    teamService = await import("@/core/team/service");
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('组织管理测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const uRes = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '测试管理员', 'ADMIN') returning id",
      [tenantId, `admin-team-${ts}@example.com`],
    );
    adminId = uRes.rows[0].id;

    ctx = { tenantId, userId: adminId, role: "ADMIN" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from opportunities where tenant_id = $1", [tenantId]);
      await owner.query("delete from customers where tenant_id = $1", [tenantId]);
      await owner.query("delete from leads where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from departments where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("支持创建部门、编辑部门与列出部门树", async () => {
    const dept1 = await teamService.createDepartmentService(ctx, {
      name: "华东销售大区",
      sortOrder: 1,
    });
    expect(dept1.id).toBeDefined();
    expect(dept1.name).toBe("华东销售大区");

    const dept2 = await teamService.createDepartmentService(ctx, {
      name: "KA 大客户部",
      parentId: dept1.id,
      sortOrder: 2,
    });
    expect(dept2.parentId).toBe(dept1.id);

    await teamService.updateDepartmentService(ctx, {
      id: dept2.id,
      name: "KA 战略客户部",
    });

    const depts = await teamService.listDepartmentsService(ctx);
    expect(depts.length).toBeGreaterThanOrEqual(2);
    const kaDept = depts.find((d) => d.id === dept2.id);
    expect(kaDept?.name).toBe("KA 战略客户部");
  });

  it("支持手动创建成员并设置私海配额与所属部门", async () => {
    const depts = await teamService.listDepartmentsService(ctx);
    const targetDept = depts[0];

    const ts = Date.now();
    const created = await teamService.createTeamMemberService(ctx, {
      name: "王牌销售李雷",
      email: `lilei-${ts}@corp.com`,
      phone: "13812345678",
      employeeNo: "EMP-001",
      jobTitle: "高级客户经理",
      role: "SALES",
      departmentId: targetDept.id,
      maxLeadQuota: 150,
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe("王牌销售李雷");

    const members = await teamService.listTeamMembersService(ctx);
    const found = members.find((m) => m.id === created.id);
    expect(found).toBeDefined();
    expect(found?.departmentName).toBe(targetDept.name);
    expect(found?.maxLeadQuota).toBe(150);
    expect(found?.status).toBe("ACTIVE");
  });

  it("支持标准化批量导入 CSV 行数据并自动创建新部门与跳过重复邮箱", async () => {
    const ts = Date.now();
    const rows = [
      {
        name: "华南销售韩梅梅",
        email: `hanmeimei-${ts}@corp.com`,
        phone: "13912345678",
        role: "业务主管",
        departmentName: "华南销售二部",
        employeeNo: "EMP-002",
        maxLeadQuota: 200,
      },
      {
        name: "华南销售小张",
        email: `xiaozhang-${ts}@corp.com`,
        phone: "13912345679",
        role: "销售专员",
        departmentName: "华南销售二部",
        employeeNo: "EMP-003",
        maxLeadQuota: 80,
      },
      {
        name: "重复用户测试",
        email: `hanmeimei-${ts}@corp.com`, // 重复邮箱
        role: "销售专员",
      },
    ];

    const result = await teamService.batchImportTeamMembersService(ctx, rows);
    expect(result.total).toBe(3);
    expect(result.createdCount).toBe(2);
    expect(result.skippedCount).toBe(1);

    const depts = await teamService.listDepartmentsService(ctx);
    const huananDept = depts.find((d) => d.name === "华南销售二部");
    expect(huananDept).toBeDefined();
  });

  it("支持离职人员资产交接：原子事务转移线索、客户与商机并禁用账号", async () => {
    const ts = Date.now();
    // 1. 创建离职销售 A 与接替销售 B
    const offboardUser = await teamService.createTeamMemberService(ctx, {
      name: "即将离职员工甲",
      email: `offboard-${ts}@corp.com`,
      role: "SALES",
    });

    const successorUser = await teamService.createTeamMemberService(ctx, {
      name: "接替销售专员乙",
      email: `successor-${ts}@corp.com`,
      role: "SALES",
    });

    // 2. 为离职员工创建 1 条线索、1 家客户、1 个商机
    const lRes = await owner.query<{ id: string }>(
      "insert into leads (tenant_id, contact_name, contact_phone, owner_user_id, status) values ($1, '离职员工客户A', '13800000001', $2, 'CONTACTED') returning id",
      [tenantId, offboardUser.id],
    );
    const cRes = await owner.query<{ id: string }>(
      "insert into customers (tenant_id, name, owner_user_id) values ($1, '离职员工企业客户A', $2) returning id",
      [tenantId, offboardUser.id],
    );
    await owner.query(
      "insert into opportunities (tenant_id, name, customer_id, owner_user_id, stage) values ($1, '离职员工在进商机A', $2, $3, 'DISCOVERY')",
      [tenantId, cRes.rows[0].id, offboardUser.id],
    );

    // 3. 获取离职概览
    const summary = await teamService.getOffboardingAssetSummaryService(ctx, offboardUser.id);
    expect(summary.leadsCount).toBe(1);
    expect(summary.customersCount).toBe(1);
    expect(summary.dealsCount).toBe(1);

    // 4. 执行交接
    const transferRes = await teamService.offboardMemberAndTransferAssetsService(ctx, {
      offboardUserId: offboardUser.id,
      transferToUserId: successorUser.id,
      action: "TRANSFER",
    });

    expect(transferRes.transferredLeads).toBe(1);
    expect(transferRes.transferredCustomers).toBe(1);
    expect(transferRes.transferredDeals).toBe(1);

    // 5. 验证资产所有权已变更为接替专员
    const updatedLead = await owner.query<{ owner_user_id: string }>(
      "select owner_user_id from leads where id = $1",
      [lRes.rows[0].id],
    );
    expect(updatedLead.rows[0].owner_user_id).toBe(successorUser.id);

    const updatedCust = await owner.query<{ owner_user_id: string }>(
      "select owner_user_id from customers where id = $1",
      [cRes.rows[0].id],
    );
    expect(updatedCust.rows[0].owner_user_id).toBe(successorUser.id);

    // 6. 验证离职人员账号已被禁用
    const updatedUser = await owner.query<{ status: string }>(
      "select status from users where id = $1",
      [offboardUser.id],
    );
    expect(updatedUser.rows[0].status).toBe("DISABLED");

    // 7. 验证不可篡改审计日志已生成
    const logs = await owner.query<{ action: string }>(
      "select action from audit_logs where tenant_id = $1 and action = 'USER_OFFBOARD_TRANSFER'",
      [tenantId],
    );
    expect(logs.rows.length).toBeGreaterThan(0);
  });
});
