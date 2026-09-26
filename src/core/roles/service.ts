import { sql } from "drizzle-orm";
import type { TenantContext, TenantTransaction } from "@/core/tenant";
import { withTenant } from "@/core/tenant";
import { BusinessError } from "@/core/shared/result";

type Session = TenantContext;
import type {
  CreateRoleInput,
  CustomRoleItem,
  UpdateRoleInput,
  UserRoleAssignmentItem,
} from "./types";

export async function listRolesService(session: Session): Promise<CustomRoleItem[]> {
  return withTenant(session.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      name: string;
      code: string;
      description: string | null;
      is_system: boolean;
      permissions: string[];
      user_count: string;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        cr.id,
        cr.name,
        cr.code,
        cr.description,
        cr.is_system,
        cr.permissions,
        count(ura.id)::text as user_count,
        cr.created_at::text as created_at,
        cr.updated_at::text as updated_at
      from custom_roles cr
      left join user_role_assignments ura on ura.role_id = cr.id and ura.tenant_id = ${session.tenantId}
      where cr.tenant_id = ${session.tenantId} and cr.deleted_at is null
      group by cr.id
      order by cr.is_system desc, cr.created_at asc
    `);

    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      isSystem: Boolean(r.is_system),
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
      userCount: Number(r.user_count || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

async function audit(
  tx: TenantTransaction,
  session: Session,
  action: string,
  subjectId: string,
  detail: object = {},
) {
  await tx.execute(sql`
    insert into public.audit_logs (
      tenant_id, actor_user_id, action, subject_type, subject_id, detail, created_at
    ) values (
      ${session.tenantId}, ${session.userId}, ${action}, 'custom_roles', ${subjectId},
      ${JSON.stringify(detail)}::jsonb, now()
    )
  `);
}

export async function createRoleService(
  session: Session,
  input: CreateRoleInput,
): Promise<CustomRoleItem> {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const desc = input.description?.trim() || null;
  const permissions = Array.isArray(input.permissions) ? Array.from(new Set(input.permissions)) : [];

  if (!name || name.length > 50) {
    throw new Error("角色名称不能为空且不能超过 50 个字符");
  }
  if (!code || code.length > 50) {
    throw new Error("角色标识编码不能为空且不能超过 50 个字符");
  }

  return withTenant(session.tenantId, async (tx) => {
    // 检查重复编码
    const dup = await tx.execute(sql`
      select 1 from custom_roles
      where tenant_id = ${session.tenantId} and code = ${code} and deleted_at is null
      limit 1
    `);
    if (dup.rows.length > 0) {
      throw new Error(`角色标识编码 "${code}" 已存在，请使用唯一编码`);
    }

    const res = await tx.execute<{
      id: string;
      name: string;
      code: string;
      description: string | null;
      is_system: boolean;
      permissions: string[];
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into custom_roles (
        tenant_id, name, code, description, is_system, permissions
      ) values (
        ${session.tenantId}, ${name}, ${code}, ${desc}, false, ${JSON.stringify(permissions)}::jsonb
      ) returning
        id, name, code, description, is_system, permissions,
        created_at::text as created_at, updated_at::text as updated_at
    `);

    const r = res.rows[0];

    await audit(tx, session, "custom_roles.create", r.id, { name: r.name, code: r.code });

    return {
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      isSystem: false,
      permissions: r.permissions || [],
      userCount: 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function updateRoleService(
  session: Session,
  roleId: string,
  input: UpdateRoleInput,
): Promise<CustomRoleItem> {
  return withTenant(session.tenantId, async (tx) => {
    const existing = await tx.execute<{ is_system: boolean }>(sql`
      select is_system from custom_roles
      where tenant_id = ${session.tenantId} and id = ${roleId} and deleted_at is null
      limit 1
    `);
    if (existing.rows.length === 0) {
      throw new Error("指定角色不存在或已被删除");
    }
    if (existing.rows[0].is_system) {
      throw new Error("系统内置基础角色受保护，不支持修改权限或重命名");
    }

    const name = input.name !== undefined ? input.name.trim() : undefined;
    const desc = input.description !== undefined ? input.description.trim() || null : undefined;
    const permissions = input.permissions !== undefined ? Array.from(new Set(input.permissions)) : undefined;

    if (name !== undefined && (!name || name.length > 50)) {
      throw new Error("角色名称不能为空且不能超过 50 个字符");
    }

    const res = await tx.execute<{
      id: string;
      name: string;
      code: string;
      description: string | null;
      is_system: boolean;
      permissions: string[];
      created_at: string;
      updated_at: string;
    }>(sql`
      update custom_roles
      set
        name = coalesce(${name ?? null}, name),
        description = coalesce(${desc ?? null}, description),
        permissions = case when ${permissions !== undefined} then ${JSON.stringify(permissions || [])}::jsonb else permissions end,
        updated_at = now()
      where tenant_id = ${session.tenantId} and id = ${roleId} and deleted_at is null
      returning
        id, name, code, description, is_system, permissions,
        created_at::text as created_at, updated_at::text as updated_at
    `);

    const r = res.rows[0];

    await audit(tx, session, "custom_roles.update", r.id, { name: r.name, permissions: r.permissions });

    return {
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      isSystem: Boolean(r.is_system),
      permissions: r.permissions || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export async function deleteRoleService(
  session: Session,
  roleId: string,
): Promise<{ success: boolean; message: string }> {
  return withTenant(session.tenantId, async (tx) => {
    const existing = await tx.execute<{ is_system: boolean; name: string }>(sql`
      select is_system, name from custom_roles
      where tenant_id = ${session.tenantId} and id = ${roleId} and deleted_at is null
      limit 1
    `);
    if (existing.rows.length === 0) {
      throw new Error("指定角色不存在或已被删除");
    }
    if (existing.rows[0].is_system) {
      throw new Error(`系统内置角色 "${existing.rows[0].name}" 不允许删除`);
    }

    // 级联清理角色分配关系并软删除角色
    await tx.execute(sql`
      delete from user_role_assignments
      where tenant_id = ${session.tenantId} and role_id = ${roleId}
    `);

    await tx.execute(sql`
      update custom_roles
      set deleted_at = now()
      where tenant_id = ${session.tenantId} and id = ${roleId}
    `);

    await audit(tx, session, "custom_roles.delete", roleId, { name: existing.rows[0].name });

    return { success: true, message: `角色 "${existing.rows[0].name}" 已成功删除` };
  });
}

export async function assignUserRolesService(
  session: Session,
  userId: string,
  roleIds: string[],
): Promise<{ success: boolean; count: number }> {
  return withTenant(session.tenantId, async (tx) => {
    // 校验目标用户是否存在
    const userCheck = await tx.execute(sql`
      select 1 from users where tenant_id = ${session.tenantId} and id = ${userId} and status = 'ACTIVE'
      limit 1
    `);
    if (userCheck.rows.length === 0) {
      throw new Error("指定员工不存在或已离职");
    }

    // 清理该用户现有的角色分配
    await tx.execute(sql`
      delete from user_role_assignments
      where tenant_id = ${session.tenantId} and user_id = ${userId}
    `);

    // 重新建立分配
    const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));
    if (uniqueRoleIds.length > 0) {
      // 校验每个 roleId 属当前租户且 deleted_at is null
      const rolesCheck = await tx.execute<{ id: string }>(sql`
        select id from custom_roles
        where tenant_id = ${session.tenantId} and deleted_at is null
          and id in (${sql.join(uniqueRoleIds.map((id) => sql`${id}::uuid`), sql`, `)})
      `);
      if (rolesCheck.rows.length !== uniqueRoleIds.length) {
        throw new BusinessError("VALIDATION_ERROR", "部分角色不存在或不属于当前租户");
      }
      for (const rId of uniqueRoleIds) {
        await tx.execute(sql`
          insert into user_role_assignments (tenant_id, user_id, role_id)
          values (${session.tenantId}, ${userId}, ${rId})
          on conflict do nothing
        `);
      }
    }

    await audit(tx, session, "custom_roles.assign", userId, { assignedRoleIds: uniqueRoleIds });

    return { success: true, count: uniqueRoleIds.length };
  });
}

export async function listUserRoleAssignmentsService(
  session: Session,
): Promise<UserRoleAssignmentItem[]> {
  return withTenant(session.tenantId, async (tx) => {
    const res = await tx.execute<{
      user_id: string;
      role_id: string;
      role_name: string;
      role_code: string;
    }>(sql`
      select
        ura.user_id,
        ura.role_id,
        cr.name as role_name,
        cr.code as role_code
      from user_role_assignments ura
      join custom_roles cr on cr.id = ura.role_id and cr.deleted_at is null
      where ura.tenant_id = ${session.tenantId}
      order by ura.created_at asc
    `);

    return res.rows.map((r) => ({
      userId: r.user_id,
      roleId: r.role_id,
      roleName: r.role_name,
      roleCode: r.role_code,
    }));
  });
}
