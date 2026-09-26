import { sql } from "drizzle-orm";
import type { TenantContext } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";
import {
  PERMISSIONS,
  ALL_PERMISSION_DEFINITIONS,
  PERMISSION_CATEGORY_NAMES,
  type PermissionKey,
  type PermissionItemMeta,
} from "./permission-constants";

export type Session = TenantContext;
export {
  PERMISSIONS,
  ALL_PERMISSION_DEFINITIONS,
  PERMISSION_CATEGORY_NAMES,
  type PermissionKey,
  type PermissionItemMeta,
};

/**
 * 获取当前会话用户的全部有效权限集合 (Effective Permissions Union)
 * 1. 若为超级管理员 (ADMIN)，直接返回全量权限集合
 * 2. 否则，合并其被分配的所有自定义角色所拥有的权限，并叠加基础角色默认权限
 */
export async function getEffectiveUserPermissionsService(session: Session): Promise<string[]> {
  if (session.role === "ADMIN") {
    // 超级管理员拥有所有权限
    return Object.values(PERMISSIONS);
  }

  // 基础角色默认内置权限
  const basePermissions = new Set<string>();
  basePermissions.add(PERMISSIONS.PRODUCTS_VIEW);
  basePermissions.add(PERMISSIONS.LEADS_CLAIM);

  if (session.role === "MANAGER") {
    basePermissions.add(PERMISSIONS.OPPORTUNITIES_MANAGE_ALL);
    basePermissions.add(PERMISSIONS.OPPORTUNITIES_INTERVENE);
    basePermissions.add(PERMISSIONS.OPPORTUNITIES_APPROVE_WIN_REVIEW);
    basePermissions.add(PERMISSIONS.LEADS_ASSIGN);
    basePermissions.add(PERMISSIONS.CUSTOMERS_MANAGE_ALL);
    basePermissions.add(PERMISSIONS.CUSTOMERS_MANAGE_CAPACITY);
    basePermissions.add(PERMISSIONS.ANALYTICS_VIEW_TEAM);
    basePermissions.add(PERMISSIONS.PLAYBOOKS_PUBLISH);
  }

  return withTenant(session.tenantId, async (tx) => {
    // 查询用户被分配的所有自定义角色中的权限
    const res = await tx.execute<{ permissions: string[] }>(sql`
      select cr.permissions
      from user_role_assignments ura
      join custom_roles cr on cr.id = ura.role_id and cr.deleted_at is null
      where ura.tenant_id = ${session.tenantId} and ura.user_id = ${session.userId}
    `);

    for (const row of res.rows) {
      if (Array.isArray(row.permissions)) {
        for (const p of row.permissions) {
          if (typeof p === "string") {
            basePermissions.add(p);
          }
        }
      }
    }

    return Array.from(basePermissions);
  });
}

/**
 * 校验用户是否拥有指定权限
 */
export async function hasPermission(session: Session, permissionKey: string): Promise<boolean> {
  if (session.role === "ADMIN") return true;
  const permissions = await getEffectiveUserPermissionsService(session);
  return permissions.includes(permissionKey);
}

/**
 * 服务端权限断言，无权时抛出异常
 */
export async function requirePermission(session: Session, permissionKey: string): Promise<void> {
  const allowed = await hasPermission(session, permissionKey);
  if (!allowed) {
    const meta = ALL_PERMISSION_DEFINITIONS.find((p) => p.key === permissionKey);
    const label = meta ? meta.name : permissionKey;
    throw new BusinessError("FORBIDDEN", `权限不足：您当前未被授予【${label}】操作权限，请联系管理员分配对应角色。`);
  }
}
