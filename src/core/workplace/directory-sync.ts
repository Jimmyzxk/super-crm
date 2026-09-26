import { sql } from "drizzle-orm";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { withTenant } from "@/core/tenant";
import type { TenantContext } from "@/core/tenant";
import { encryptSecret, decryptSecret } from "@/core/security/crypto";
import type { WorkplacePlatform } from "./types";

/**
 * 解析并解密通讯录 Secret
 * 对历史存量明文优雅兼容；若解密失败则提示警告并回退原值
 */
export function resolveDirectorySecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith("enc:v1:")) {
    // 历史存量明文
    return stored;
  }
  const decrypted = decryptSecret(stored);
  if (decrypted !== null) {
    return decrypted;
  }
  console.warn("通讯录Secret凭证解密失败，回退使用原始明文/密文并提示重存，请尽快重新保存该配置");
  return stored;
}

export function formatMaskedSecret(stored: string | null | undefined): string {
  const plain = resolveDirectorySecret(stored);
  if (!plain) return "";
  return plain.length > 8 ? `${plain.slice(0, 4)}****${plain.slice(-4)}` : "******";
}

export type WorkplaceDirectoryConfigItem = {
  id: string;
  platform: WorkplacePlatform;
  corpId: string;
  secret: string;
  syncMode: "FULL" | "INCREMENTAL";
  defaultRole: "SALES" | "MANAGER" | "ADMIN";
  lastSyncedAt: string | null;
  lastSyncResult: Record<string, unknown> | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertDirectoryConfigInput = {
  platform: WorkplacePlatform;
  corpId: string;
  secret: string;
  syncMode?: "FULL" | "INCREMENTAL";
  defaultRole?: "SALES" | "MANAGER" | "ADMIN";
  isEnabled?: boolean;
};

export type RemoteDepartment = {
  id: string;
  name: string;
  parentExternalId?: string | null;
  order?: number;
};

export type RemoteUser = {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  departmentExternalId?: string | null;
  title?: string;
};

export type DirectorySyncDiffResult = {
  platform: WorkplacePlatform;
  previewAt: string;
  totalRemoteDepartments: number;
  totalRemoteUsers: number;
  departmentsToAdd: RemoteDepartment[];
  departmentsToUpdate: Array<{ id: string; name: string; oldName: string }>;
  usersToAdd: RemoteUser[];
  usersToUpdate: Array<{ id: string; name: string; oldName: string; email: string }>;
};

export type DirectorySyncExecutionResult = {
  platform: WorkplacePlatform;
  syncedAt: string;
  createdDepartmentsCount: number;
  updatedDepartmentsCount: number;
  createdUsersCount: number;
  updatedUsersCount: number;
};

// 预设安全沙箱模拟数据适配器（供真实 API 缺省时演示与自验）
export function generateMockRemoteDirectory(platform: WorkplacePlatform): {
  departments: RemoteDepartment[];
  users: RemoteUser[];
} {
  const prefix = platform === "WECOM" ? "企微" : platform === "DINGTALK" ? "钉钉" : "飞书";
  return {
    departments: [
      { id: "dept-100", name: `${prefix}·大客户销售一部`, order: 10 },
      { id: "dept-200", name: `${prefix}·创新业务拓客组`, order: 20 },
      { id: "dept-300", name: `${prefix}·售前技术支持部`, order: 30 },
    ],
    users: [
      {
        id: "user-1001",
        name: "李大伟",
        mobile: "13910010001",
        email: "li.dawei@company-sync.com",
        departmentExternalId: "dept-100",
        title: "资深KA销售经理",
      },
      {
        id: "user-1002",
        name: "王晓丽",
        mobile: "13910010002",
        email: "wang.xiaoli@company-sync.com",
        departmentExternalId: "dept-200",
        title: "SDR拓客主管",
      },
      {
        id: "user-1003",
        name: "张工",
        mobile: "13910010003",
        email: "zhang.gong@company-sync.com",
        departmentExternalId: "dept-300",
        title: "高级售前顾问",
      },
    ],
  };
}

export async function listDirectoryConfigsService(
  tenant: TenantContext,
): Promise<WorkplaceDirectoryConfigItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      corp_id: string;
      secret: string;
      sync_mode: "FULL" | "INCREMENTAL";
      default_role: "SALES" | "MANAGER" | "ADMIN";
      last_synced_at: string | null;
      last_sync_result: Record<string, unknown> | null;
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      select
        id,
        platform,
        corp_id,
        secret,
        sync_mode,
        default_role,
        last_synced_at::text as last_synced_at,
        last_sync_result,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
      from public.workplace_directory_configs
      where tenant_id = ${tenant.tenantId}
      order by platform asc
    `);

    return rows.rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      corpId: r.corp_id,
      secret: formatMaskedSecret(r.secret),
      syncMode: r.sync_mode,
      defaultRole: r.default_role,
      lastSyncedAt: r.last_synced_at,
      lastSyncResult: r.last_sync_result,
      isEnabled: r.is_enabled,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });
}

export async function upsertDirectoryConfigService(
  tenant: TenantContext,
  input: UpsertDirectoryConfigInput,
): Promise<WorkplaceDirectoryConfigItem> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅超级管理员可配置企业通讯录对接凭证");
  }

  if (!input.corpId.trim()) throw new Error("请输入企业ID或应用Key");
  if (!input.secret.trim()) throw new Error("请输入通讯录Secret凭证");

  const encryptedSecret = encryptSecret(input.secret.trim()) ?? input.secret.trim();

  return withTenant(tenant.tenantId, async (tx) => {
    const res = await tx.execute<{
      id: string;
      platform: WorkplacePlatform;
      corp_id: string;
      secret: string;
      sync_mode: "FULL" | "INCREMENTAL";
      default_role: "SALES" | "MANAGER" | "ADMIN";
      last_synced_at: string | null;
      last_sync_result: Record<string, unknown> | null;
      is_enabled: boolean;
      created_at: string;
      updated_at: string;
    }>(sql`
      insert into public.workplace_directory_configs (
        tenant_id,
        platform,
        corp_id,
        secret,
        sync_mode,
        default_role,
        is_enabled,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.platform},
        ${input.corpId.trim()},
        ${encryptedSecret},
        ${input.syncMode ?? "INCREMENTAL"},
        ${input.defaultRole ?? "SALES"},
        ${input.isEnabled ?? true},
        now(),
        now()
      )
      on conflict (tenant_id, platform) do update set
        corp_id = excluded.corp_id,
        secret = excluded.secret,
        sync_mode = excluded.sync_mode,
        default_role = excluded.default_role,
        is_enabled = excluded.is_enabled,
        updated_at = now()
      returning
        id,
        platform,
        corp_id,
        secret,
        sync_mode,
        default_role,
        last_synced_at::text as last_synced_at,
        last_sync_result,
        is_enabled,
        created_at::text as created_at,
        updated_at::text as updated_at
    `);

    const row = res.rows[0];

    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'workplace_directory.config_update',
        'workplace_directory',
        ${row.id},
        ${JSON.stringify({ platform: row.platform, syncMode: row.sync_mode })}::jsonb,
        now()
      )
    `);

    return {
      id: row.id,
      platform: row.platform,
      corpId: row.corp_id,
      secret: formatMaskedSecret(row.secret),
      syncMode: row.sync_mode,
      defaultRole: row.default_role,
      lastSyncedAt: row.last_synced_at,
      lastSyncResult: row.last_sync_result,
      isEnabled: row.is_enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function previewDirectorySyncDiffService(
  tenant: TenantContext,
  platform: WorkplacePlatform,
  customRemoteData?: { departments: RemoteDepartment[]; users: RemoteUser[] },
): Promise<DirectorySyncDiffResult> {
  const remote = customRemoteData ?? generateMockRemoteDirectory(platform);

  return withTenant(tenant.tenantId, async (tx) => {
    // 1. 查询本地现有部门
    const localDepts = await tx.execute<{ id: string; name: string }>(sql`
      select id, name
      from public.departments
      where tenant_id = ${tenant.tenantId} and deleted_at is null
    `);
    const localDeptNameMap = new Map(localDepts.rows.map((d) => [d.name, d]));

    const deptsToAdd: RemoteDepartment[] = [];
    const deptsToUpdate: Array<{ id: string; name: string; oldName: string }> = [];

    for (const rDept of remote.departments) {
      const match = localDeptNameMap.get(rDept.name);
      if (!match) {
        deptsToAdd.push(rDept);
      }
    }

    // 2. 查询本地现有员工
    const localUsers = await tx.execute<{ id: string; email: string; name: string }>(sql`
      select id, email, name
      from public.users
      where tenant_id = ${tenant.tenantId}
    `);
    const localUserEmailMap = new Map(localUsers.rows.map((u) => [u.email.toLowerCase(), u]));

    const usersToAdd: RemoteUser[] = [];
    const usersToUpdate: Array<{ id: string; name: string; oldName: string; email: string }> = [];

    for (const rUser of remote.users) {
      const email = (rUser.email || `${rUser.mobile}@workplace-sync.local`).toLowerCase();
      const match = localUserEmailMap.get(email);
      if (!match) {
        usersToAdd.push({ ...rUser, email });
      } else if (match.name !== rUser.name) {
        usersToUpdate.push({
          id: match.id,
          name: rUser.name,
          oldName: match.name,
          email,
        });
      }
    }

    return {
      platform,
      previewAt: new Date().toISOString(),
      totalRemoteDepartments: remote.departments.length,
      totalRemoteUsers: remote.users.length,
      departmentsToAdd: deptsToAdd,
      departmentsToUpdate: deptsToUpdate,
      usersToAdd,
      usersToUpdate,
    };
  });
}

export async function executeDirectorySyncService(
  tenant: TenantContext,
  platform: WorkplacePlatform,
  customRemoteData?: { departments: RemoteDepartment[]; users: RemoteUser[] },
): Promise<DirectorySyncExecutionResult> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅管理员可执行企业通讯录同步入库");
  }

  const diff = await previewDirectorySyncDiffService(tenant, platform, customRemoteData);

  return withTenant(tenant.tenantId, async (tx) => {
    // 新员工角色改用配置的 default_role（无配置回退 SALES）
    let defaultRole: "SALES" | "MANAGER" | "ADMIN" = "SALES";
    try {
      const cfg = await tx.execute<{ default_role: string }>(sql`select default_role from public.workplace_directory_configs where tenant_id = ${tenant.tenantId} and platform = ${platform} limit 1`);
      const raw = cfg.rows[0]?.default_role;
      if (raw === "MANAGER" || raw === "ADMIN" || raw === "SALES") defaultRole = raw;
    } catch {}
    let createdDepts = 0;
    let createdUsers = 0;
    let updatedUsers = 0;

    // 1. 批量创建缺失部门
    const deptIdMap = new Map<string, string>(); // remoteId -> localUuid
    for (const dept of diff.departmentsToAdd) {
      const res = await tx.execute<{ id: string }>(sql`
        insert into public.departments (
          tenant_id,
          name,
          sort_order,
          created_at,
          updated_at
        ) values (
          ${tenant.tenantId},
          ${dept.name},
          ${dept.order ?? 0},
          now(),
          now()
        )
        returning id
      `);
      deptIdMap.set(dept.id, res.rows[0].id);
      createdDepts += 1;
    }

    // 2. 批量创建/更新员工花名册
    for (const u of diff.usersToAdd) {
      const email = (u.email || `${u.mobile}@workplace-sync.local`).toLowerCase();
      const deptLocalId = u.departmentExternalId ? deptIdMap.get(u.departmentExternalId) ?? null : null;

      const existingUser = await tx.execute<{ id: string }>(sql`
        select id from public.users where tenant_id = ${tenant.tenantId} and lower(email) = ${email} limit 1
      `);
      if (existingUser.rows[0]) {
        await tx.execute(sql`
          update public.users set
            name = ${u.name},
            phone = ${u.mobile ?? null},
            job_title = ${u.title ?? '销售顾问'},
            department_id = ${deptLocalId ? sql`${deptLocalId}::uuid` : null},
            updated_at = now()
          where tenant_id = ${tenant.tenantId} and id = ${existingUser.rows[0].id}::uuid
        `);
      } else {
        // 通讯录同步用户走 SSO，本地密码必须是不可预测的随机值：
        // 若用 "SyncedUser@+租户ID前8位" 这类确定性口令，任何知道租户 ID
        // 的内部人员都能反推出密码直接登录冒充同步账号
        const syncedPwdHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
        await tx.execute(sql`
          insert into public.users (
            tenant_id,
            email,
            password_hash,
            name,
            phone,
            job_title,
            department_id,
            role,
            status,
            created_at,
            updated_at
          ) values (
            ${tenant.tenantId},
            ${email},
            ${syncedPwdHash},
            ${u.name},
            ${u.mobile},
            ${u.title ?? '销售顾问'},
            ${deptLocalId ? sql`${deptLocalId}::uuid` : null},
            ${defaultRole},
            'ACTIVE',
            now(),
            now()
          )
        `);
      }
      createdUsers += 1;
    }

    for (const u of diff.usersToUpdate) {
      await tx.execute(sql`
        update public.users
        set name = ${u.name}, updated_at = now()
        where tenant_id = ${tenant.tenantId} and id = ${u.id}::uuid
      `);
      updatedUsers += 1;
    }

    // 3. 更新同步时间与结果记录
    const syncSummary = {
      platform,
      createdDepts,
      createdUsers,
      updatedUsers,
      syncedAt: new Date().toISOString(),
    };

    await tx.execute(sql`
      update public.workplace_directory_configs
      set
        last_synced_at = now(),
        last_sync_result = ${JSON.stringify(syncSummary)}::jsonb,
        updated_at = now()
      where tenant_id = ${tenant.tenantId} and platform = ${platform}
    `);

    // 4. 记录审计日志
    await tx.execute(sql`
      insert into public.audit_logs (
        tenant_id,
        actor_user_id,
        action,
        subject_type,
        subject_id,
        detail,
        created_at
      ) values (
        ${tenant.tenantId},
        ${tenant.userId},
        'workplace_directory.sync_execute',
        'workplace_directory',
        ${tenant.tenantId},
        ${JSON.stringify(syncSummary)}::jsonb,
        now()
      )
    `);

    return {
      platform,
      syncedAt: syncSummary.syncedAt,
      createdDepartmentsCount: createdDepts,
      updatedDepartmentsCount: diff.departmentsToUpdate.length,
      createdUsersCount: createdUsers,
      updatedUsersCount: updatedUsers,
    };
  });
}
