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

let PERMISSIONS: typeof import("@/core/auth/permissions").PERMISSIONS;
let getEffectiveUserPermissionsService: typeof import("@/core/auth/permissions").getEffectiveUserPermissionsService;
let hasPermission: typeof import("@/core/auth/permissions").hasPermission;
let requirePermission: typeof import("@/core/auth/permissions").requirePermission;
let createRoleService: typeof import("@/core/roles/service").createRoleService;
let updateRoleService: typeof import("@/core/roles/service").updateRoleService;
let deleteRoleService: typeof import("@/core/roles/service").deleteRoleService;
let assignUserRolesService: typeof import("@/core/roles/service").assignUserRolesService;
let createProductService: typeof import("@/core/products/service").createProductService;
let closeDb: typeof import("@/db/client").closeDb;

let tenantId: string;
let adminId: string;
let salesId: string;
let adminSession: TenantContext;
let salesSession: TenantContext;

describe("自定义角色与模块化权限授权体系 (Custom Roles & Modular Permissions)", () => {
  beforeAll(async () => {
    await owner.connect();

    PERMISSIONS = (await import("@/core/auth/permissions")).PERMISSIONS;
    getEffectiveUserPermissionsService = (await import("@/core/auth/permissions")).getEffectiveUserPermissionsService;
    hasPermission = (await import("@/core/auth/permissions")).hasPermission;
    requirePermission = (await import("@/core/auth/permissions")).requirePermission;
    createRoleService = (await import("@/core/roles/service")).createRoleService;
    updateRoleService = (await import("@/core/roles/service")).updateRoleService;
    deleteRoleService = (await import("@/core/roles/service")).deleteRoleService;
    assignUserRolesService = (await import("@/core/roles/service")).assignUserRolesService;
    createProductService = (await import("@/core/products/service")).createProductService;
    closeDb = (await import("@/db/client")).closeDb;

    const tRes = await owner.query<{ id: string }>(
      "insert into tenants (name) values ('角色权限测试租户') returning id",
    );
    tenantId = tRes.rows[0].id;

    const ts = Date.now();
    const uAdmin = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '超管', 'ADMIN') returning id",
      [tenantId, `role-admin-${ts}@example.com`],
    );
    adminId = uAdmin.rows[0].id;

    const uSales = await owner.query<{ id: string }>(
      "insert into users (tenant_id, email, password_hash, name, role) values ($1, $2, 'hash', '销售', 'SALES') returning id",
      [tenantId, `role-sales-${ts}@example.com`],
    );
    salesId = uSales.rows[0].id;

    adminSession = { tenantId, userId: adminId, role: "ADMIN" };
    salesSession = { tenantId, userId: salesId, role: "SALES" };
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from user_role_assignments where tenant_id = $1", [tenantId]);
      await owner.query("delete from custom_roles where tenant_id = $1", [tenantId]);
      await owner.query("delete from products where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await closeDb();
    await owner.end();
  });

  it("超级管理员 (ADMIN) 自动拥有全量模块权限", async () => {
    const permissions = await getEffectiveUserPermissionsService(adminSession);
    expect(permissions).toContain(PERMISSIONS.PRODUCTS_MANAGE);
    expect(permissions).toContain(PERMISSIONS.LEADS_ASSIGN);
    expect(permissions).toContain(PERMISSIONS.CUSTOMERS_EXPORT);
    expect(permissions).toContain(PERMISSIONS.ORGANIZATION_MANAGE);

    const hasProd = await hasPermission(adminSession, PERMISSIONS.PRODUCTS_MANAGE);
    expect(hasProd).toBe(true);
  });

  it("未被授权的销售专员默认不具备产品管理权限", async () => {
    const hasProd = await hasPermission(salesSession, PERMISSIONS.PRODUCTS_MANAGE);
    expect(hasProd).toBe(false);

    await expect(requirePermission(salesSession, PERMISSIONS.PRODUCTS_MANAGE)).rejects.toThrow(
      /权限不足/
    );
  });

  it("支持创建自定义角色、勾选特定权限并赋予销售专员，使其即时获得授权", async () => {
    // 1. 创建自定义角色「商业化产品专员」
    const customRole = await createRoleService(adminSession, {
      name: "商业化产品专员",
      code: `PROD_SPECIALIST_${Date.now()}`,
      description: "负责产品库维护",
      permissions: [PERMISSIONS.PRODUCTS_MANAGE, PERMISSIONS.CUSTOMERS_EXPORT],
    });

    expect(customRole.id).toBeDefined();
    expect(customRole.permissions).toContain(PERMISSIONS.PRODUCTS_MANAGE);

    // 2. 为销售专员赋予该角色
    const assignRes = await assignUserRolesService(adminSession, salesId, [customRole.id]);
    expect(assignRes.success).toBe(true);

    // 3. 销售专员即时获得该角色权限
    const salesPermissions = await getEffectiveUserPermissionsService(salesSession);
    expect(salesPermissions).toContain(PERMISSIONS.PRODUCTS_MANAGE);
    expect(salesPermissions).toContain(PERMISSIONS.CUSTOMERS_EXPORT);

    // 4. 销售专员现在有权执行产品创建
    const prod = await createProductService(salesSession, {
      code: `SKU-TEST-${Date.now()}`,
      name: "测试授权产品",
      category: "智能体应用",
      pricingModel: "ONE_TIME",
      unitPrice: 500000,
      unit: "套",
    });
    expect(prod.id).toBeDefined();
    expect(prod.name).toBe("测试授权产品");
  });

  it("支持一人赋予多个角色，最终权限自动合并为所有角色的并集 (Union)", async () => {
    // 创建角色 A: 负责产品
    const roleA = await createRoleService(adminSession, {
      name: "产品专员",
      code: `ROLE_A_${Date.now()}`,
      permissions: [PERMISSIONS.PRODUCTS_MANAGE],
    });

    // 创建角色 B: 负责财务导出与审批
    const roleB = await createRoleService(adminSession, {
      name: "财务审批专员",
      code: `ROLE_B_${Date.now()}`,
      permissions: [PERMISSIONS.CUSTOMERS_EXPORT, PERMISSIONS.OPPORTUNITIES_INTERVENE],
    });

    // 为用户同时分配角色 A 和 角色 B
    await assignUserRolesService(adminSession, salesId, [roleA.id, roleB.id]);

    const effective = await getEffectiveUserPermissionsService(salesSession);
    expect(effective).toContain(PERMISSIONS.PRODUCTS_MANAGE);
    expect(effective).toContain(PERMISSIONS.CUSTOMERS_EXPORT);
    expect(effective).toContain(PERMISSIONS.OPPORTUNITIES_INTERVENE);
  });

  it("支持动态更新角色权限或删除角色并自动解除绑定", async () => {
    const role = await createRoleService(adminSession, {
      name: "临时待删除角色",
      code: `TEMP_ROLE_${Date.now()}`,
      permissions: [PERMISSIONS.CUSTOMERS_EXPORT],
    });

    await assignUserRolesService(adminSession, salesId, [role.id]);
    let effective = await getEffectiveUserPermissionsService(salesSession);
    expect(effective).toContain(PERMISSIONS.CUSTOMERS_EXPORT);

    // 更新角色权限增加 products:manage
    await updateRoleService(adminSession, role.id, {
      permissions: [PERMISSIONS.PRODUCTS_MANAGE],
    });
    effective = await getEffectiveUserPermissionsService(salesSession);
    expect(effective).toContain(PERMISSIONS.PRODUCTS_MANAGE);
    expect(effective).not.toContain(PERMISSIONS.CUSTOMERS_EXPORT);

    // 删除角色
    const delRes = await deleteRoleService(adminSession, role.id);
    expect(delRes.success).toBe(true);

    // 删除后用户失去该角色权限
    effective = await getEffectiveUserPermissionsService(salesSession);
    expect(effective).not.toContain(PERMISSIONS.PRODUCTS_MANAGE);
  });
});
