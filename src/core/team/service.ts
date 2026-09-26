import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { withTenant, type TenantContext, type TenantTransaction } from "@/core/tenant";
import { normalizeEmail } from "@/core/auth/types";
import { BusinessError } from "@/core/shared/result";
import { runPluginOffboardHooks } from "@/plugin-kit/server";
import type {
  BatchImportResult,
  BatchImportUserRow,
  CreateTeamMemberInput,
  DepartmentItem,
  OffboardingAssetSummary,
  OffboardingTransferInput,
  TeamMemberItem,
  UpdateTeamMemberInput,
} from "./types";

async function recordAuditLog(
  tx: TenantTransaction,
  tenantId: string,
  actorUserId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
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
      ${tenantId}::uuid,
      ${actorUserId}::uuid,
      ${action},
      ${subjectType},
      ${subjectId}::uuid,
      ${JSON.stringify(detail)}::jsonb,
      now()
    )
  `);
}

export async function listDepartmentsService(
  tenant: TenantContext,
): Promise<DepartmentItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const result = await tx.execute<{
      id: string;
      name: string;
      parent_id: string | null;
      leader_user_id: string | null;
      leader_name: string | null;
      sort_order: number;
      member_count: string;
      created_at: string;
    }>(sql`
      select 
        d.id,
        d.name,
        d.parent_id,
        d.leader_user_id,
        u.name as leader_name,
        d.sort_order,
        count(m.id)::text as member_count,
        d.created_at::text as created_at
      from public.departments d
      left join public.users u on u.id = d.leader_user_id and u.tenant_id = d.tenant_id
      left join public.users m on m.department_id = d.id and m.tenant_id = d.tenant_id and m.status = 'ACTIVE'
      where d.tenant_id = ${tenant.tenantId}
        and d.deleted_at is null
      group by d.id, d.name, d.parent_id, d.leader_user_id, u.name, d.sort_order, d.created_at
      order by d.sort_order asc, d.name asc
    `);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      leaderUserId: row.leader_user_id,
      leaderName: row.leader_name,
      sortOrder: Number(row.sort_order || 0),
      memberCount: Number(row.member_count || 0),
      createdAt: row.created_at,
    }));
  });
}

export async function createDepartmentService(
  tenant: TenantContext,
  input: {
    name: string;
    parentId?: string | null;
    leaderUserId?: string | null;
    sortOrder?: number;
  },
): Promise<DepartmentItem> {
  const trimmedName = input.name.trim();
  if (!trimmedName || trimmedName.length > 50) {
    throw new Error("部门名称长度必须在 1-50 个字符之间");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    const result = await tx.execute<{
      id: string;
      name: string;
      parent_id: string | null;
      leader_user_id: string | null;
      sort_order: number;
      created_at: string;
    }>(sql`
      insert into public.departments (
        tenant_id,
        name,
        parent_id,
        leader_user_id,
        sort_order,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${trimmedName},
        ${input.parentId || null},
        ${input.leaderUserId || null},
        ${input.sortOrder ?? 0},
        now(),
        now()
      )
      returning id, name, parent_id, leader_user_id, sort_order, created_at::text as created_at
    `);

    const row = result.rows[0];
    await recordAuditLog(
      tx,
      tenant.tenantId,
      tenant.userId,
      "DEPARTMENT_CREATE",
      "department",
      row.id,
      { name: row.name, parentId: row.parent_id },
    );

    return {
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      leaderUserId: row.leader_user_id,
      sortOrder: Number(row.sort_order),
      memberCount: 0,
      createdAt: row.created_at,
    };
  });
}

export async function updateDepartmentService(
  tenant: TenantContext,
  input: {
    id: string;
    name?: string;
    parentId?: string | null;
    leaderUserId?: string | null;
    sortOrder?: number;
  },
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    const sets = [];
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed || trimmed.length > 50) {
        throw new Error("部门名称长度必须在 1-50 个字符之间");
      }
      sets.push(sql`name = ${trimmed}`);
    }
    if (input.parentId !== undefined) {
      sets.push(sql`parent_id = ${input.parentId}`);
    }
    if (input.leaderUserId !== undefined) {
      sets.push(sql`leader_user_id = ${input.leaderUserId}`);
    }
    if (input.sortOrder !== undefined) {
      sets.push(sql`sort_order = ${input.sortOrder}`);
    }
    sets.push(sql`updated_at = now()`);

    if (sets.length > 1) {
      await tx.execute(sql`
        update public.departments
        set ${sql.join(sets, sql`, `)}
        where id = ${input.id} and tenant_id = ${tenant.tenantId} and deleted_at is null
      `);

      await recordAuditLog(
        tx,
        tenant.tenantId,
        tenant.userId,
        "DEPARTMENT_UPDATE",
        "department",
        input.id,
        { ...input },
      );
    }
  });
}

export async function deleteDepartmentService(
  tenant: TenantContext,
  departmentId: string,
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    const childCheck = await tx.execute<{ id: string }>(sql`
      select id from public.departments
      where parent_id = ${departmentId} and tenant_id = ${tenant.tenantId} and deleted_at is null
      limit 1
    `);
    if (childCheck.rows.length > 0) {
      throw new BusinessError("CONFLICT", "该部门下仍有未删除的子部门，请先删除或迁移子部门后再试");
    }
    await tx.execute(sql`
      update public.departments
      set deleted_at = now(), updated_at = now()
      where id = ${departmentId} and tenant_id = ${tenant.tenantId}
    `);

    await tx.execute(sql`
      update public.users
      set department_id = null, updated_at = now()
      where department_id = ${departmentId} and tenant_id = ${tenant.tenantId}
    `);

    await recordAuditLog(
      tx,
      tenant.tenantId,
      tenant.userId,
      "DEPARTMENT_DELETE",
      "department",
      departmentId,
    );
  });
}

export async function listTeamMembersService(
  tenant: TenantContext,
  filter?: {
    departmentId?: string;
    role?: string;
    status?: "ACTIVE" | "DISABLED";
    search?: string;
  },
): Promise<TeamMemberItem[]> {
  return withTenant(tenant.tenantId, async (tx) => {
    const conditions = [sql`u.tenant_id = ${tenant.tenantId}`];

    if (filter?.departmentId) {
      conditions.push(sql`u.department_id = ${filter.departmentId}`);
    }
    if (filter?.role) {
      conditions.push(sql`u.role = ${filter.role}`);
    }
    if (filter?.status) {
      conditions.push(sql`u.status = ${filter.status}`);
    }
    if (filter?.search) {
      const q = `%${filter.search.trim()}%`;
      conditions.push(
        sql`(u.name ilike ${q} or u.email ilike ${q} or u.phone ilike ${q} or u.employee_no ilike ${q})`,
      );
    }

    const whereClause = sql.join(conditions, sql` and `);

    const result = await tx.execute<{
      id: string;
      name: string;
      email: string;
      phone: string | null;
      employee_no: string | null;
      job_title: string | null;
      role: "ADMIN" | "MANAGER" | "SALES";
      status: "ACTIVE" | "DISABLED";
      department_id: string | null;
      department_name: string | null;
      max_lead_quota: number;
      active_leads_count: string;
      active_customers_count: string;
      active_deals_count: string;
      created_at: string;
    }>(sql`
      select 
        u.id,
        u.name,
        u.email,
        u.phone,
        u.employee_no,
        u.job_title,
        u.role,
        u.status,
        u.department_id,
        d.name as department_name,
        coalesce(u.max_lead_quota, 100) as max_lead_quota,
        (select count(*)::text from public.leads l where l.owner_user_id = u.id and l.tenant_id = u.tenant_id and l.status not in ('CONVERTED', 'DISCARDED') and l.deleted_at is null) as active_leads_count,
        (select count(*)::text from public.customers c where c.owner_user_id = u.id and c.tenant_id = u.tenant_id and c.deleted_at is null) as active_customers_count,
        (select count(*)::text from public.opportunities o where o.owner_user_id = u.id and o.tenant_id = u.tenant_id and o.stage not in ('WON', 'LOST') and o.deleted_at is null) as active_deals_count,
        u.created_at::text as created_at
      from public.users u
      left join public.departments d on d.id = u.department_id and d.tenant_id = u.tenant_id
      where ${whereClause}
      order by u.created_at desc
    `);

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      employeeNo: row.employee_no,
      jobTitle: row.job_title,
      role: row.role,
      status: row.status,
      departmentId: row.department_id,
      departmentName: row.department_name,
      maxLeadQuota: Number(row.max_lead_quota || 100),
      activeLeadsCount: Number(row.active_leads_count || 0),
      activeCustomersCount: Number(row.active_customers_count || 0),
      activeDealsCount: Number(row.active_deals_count || 0),
      createdAt: row.created_at,
    }));
  });
}

export async function createTeamMemberService(
  tenant: TenantContext,
  input: CreateTeamMemberInput,
): Promise<{ id: string; name: string; email: string }> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("请输入有效的企业邮箱地址");
  }

  const trimmedName = input.name.trim();
  if (!trimmedName || trimmedName.length > 50) {
    throw new Error("姓名长度必须在 1-50 个字符之间");
  }

  const initialPassword = input.password || "Password123456";
  const passwordHash = await bcrypt.hash(initialPassword, 10);

  return withTenant(tenant.tenantId, async (tx) => {
    // 检查邮箱唯一性
    const existing = await tx.execute(sql`
      select id from public.users where email = ${normalizedEmail}
    `);
    if (existing.rows.length > 0) {
      throw new Error(`邮箱 ${normalizedEmail} 已被注册`);
    }

    const result = await tx.execute<{ id: string; name: string; email: string }>(sql`
      insert into public.users (
        tenant_id,
        department_id,
        email,
        phone,
        employee_no,
        job_title,
        max_lead_quota,
        password_hash,
        name,
        role,
        status,
        session_version,
        created_at,
        updated_at
      ) values (
        ${tenant.tenantId},
        ${input.departmentId || null},
        ${normalizedEmail},
        ${input.phone || null},
        ${input.employeeNo || null},
        ${input.jobTitle || null},
        ${input.maxLeadQuota ?? 100},
        ${passwordHash},
        ${trimmedName},
        ${input.role || "SALES"},
        'ACTIVE',
        1,
        now(),
        now()
      )
      returning id, name, email
    `);

    const created = result.rows[0];
    await recordAuditLog(
      tx,
      tenant.tenantId,
      tenant.userId,
      "USER_CREATE",
      "user",
      created.id,
      { email: created.email, name: created.name, role: input.role },
    );

    return created;
  });
}

export async function updateTeamMemberService(
  tenant: TenantContext,
  input: UpdateTeamMemberInput,
): Promise<void> {
  return withTenant(tenant.tenantId, async (tx) => {
    if (input.userId === tenant.userId && input.status === "DISABLED") {
      throw new Error("无法禁用当前登录的账号自身");
    }

    if (input.status === "DISABLED" || (input.role !== undefined && input.role !== "ADMIN")) {
      // 锁定租户下所有活跃管理员行，保证并发下末位 ADMIN 判断原子性
      const activeAdmins = await tx.execute<{ id: string }>(sql`
        select id from public.users
        where tenant_id = ${tenant.tenantId} and role = 'ADMIN' and status = 'ACTIVE'
        for update
      `);
      const targetIsAdmin = activeAdmins.rows.some((u) => u.id === input.userId);
      if (targetIsAdmin) {
        const remainingAdminCount = activeAdmins.rows.filter((u) => u.id !== input.userId).length;
        if (remainingAdminCount === 0) {
          throw new Error("操作被拦截：系统必须保留至少一名活跃超级管理员");
        }
      }
    }

    const sets = [];
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed || trimmed.length > 50) throw new Error("姓名长度必须在 1-50 个字符之间");
      sets.push(sql`name = ${trimmed}`);
    }
    if (input.phone !== undefined) {
      sets.push(sql`phone = ${input.phone}`);
    }
    if (input.employeeNo !== undefined) {
      sets.push(sql`employee_no = ${input.employeeNo}`);
    }
    if (input.jobTitle !== undefined) {
      sets.push(sql`job_title = ${input.jobTitle}`);
    }
    if (input.role !== undefined) {
      sets.push(sql`role = ${input.role}`);
    }
    if (input.departmentId !== undefined) {
      sets.push(sql`department_id = ${input.departmentId}`);
    }
    if (input.maxLeadQuota !== undefined) {
      sets.push(sql`max_lead_quota = ${input.maxLeadQuota}`);
    }
    if (input.status !== undefined) {
      sets.push(sql`status = ${input.status}`);
      // 禁用时使其 Session 失效
      if (input.status === "DISABLED") {
        sets.push(sql`session_version = session_version + 1`);
      }
    }
    sets.push(sql`updated_at = now()`);

    if (sets.length > 1) {
      await tx.execute(sql`
        update public.users
        set ${sql.join(sets, sql`, `)}
        where id = ${input.userId} and tenant_id = ${tenant.tenantId}
      `);

      await recordAuditLog(
        tx,
        tenant.tenantId,
        tenant.userId,
        "USER_UPDATE",
        "user",
        input.userId,
        { ...input },
      );
    }
  });
}

export async function batchImportTeamMembersService(
  tenant: TenantContext,
  rows: BatchImportUserRow[],
): Promise<BatchImportResult> {
  const result: BatchImportResult = {
    total: rows.length,
    createdCount: 0,
    skippedCount: 0,
    errors: [],
  };

  if (rows.length === 0) return result;

  const defaultPasswordHash = await bcrypt.hash("Password123456", 10);

  return withTenant(tenant.tenantId, async (tx) => {
    // 1. 获取现有部门映射
    const deptRows = await tx.execute<{ id: string; name: string }>(sql`
      select id, name from public.departments where tenant_id = ${tenant.tenantId} and deleted_at is null
    `);
    const deptMap = new Map<string, string>();
    for (const d of deptRows.rows) {
      deptMap.set(d.name.trim().toLowerCase(), d.id);
    }

    // 2. 获取已有邮箱
    const userEmails = await tx.execute<{ email: string }>(sql`
      select email from public.users where tenant_id = ${tenant.tenantId}
    `);
    const existingEmails = new Set(userEmails.rows.map((u) => u.email.toLowerCase()));

    // 3. 逐行校验并导入
    let rowIndex = 1;
    for (const row of rows) {
      rowIndex++;
      const name = (row.name || "").trim();
      const email = normalizeEmail(row.email || "");

      if (!name) {
        result.errors.push({ row: rowIndex, email: row.email, reason: "姓名不能为空" });
        continue;
      }
      if (!email || !email.includes("@")) {
        result.errors.push({ row: rowIndex, email: row.email, reason: "邮箱格式不正确" });
        continue;
      }

      if (existingEmails.has(email)) {
        result.skippedCount++;
        continue;
      }

      // 角色映射
      let role: "ADMIN" | "MANAGER" | "SALES" = "SALES";
      const rawRole = (row.role || "").trim().toLowerCase();
      if (rawRole.includes("admin") || rawRole.includes("管") && rawRole.includes("理")) {
        role = "ADMIN";
      } else if (rawRole.includes("manager") || rawRole.includes("主管") || rawRole.includes("负责人")) {
        role = "MANAGER";
      }

      // 部门映射
      let deptId: string | null = null;
      if (row.departmentName && row.departmentName.trim()) {
        const dKey = row.departmentName.trim().toLowerCase();
        if (deptMap.has(dKey)) {
          deptId = deptMap.get(dKey)!;
        } else {
          // 自动新建部门
          const newDeptRes = await tx.execute<{ id: string }>(sql`
            insert into public.departments (tenant_id, name, created_at, updated_at)
            values (${tenant.tenantId}, ${row.departmentName.trim()}, now(), now())
            returning id
          `);
          deptId = newDeptRes.rows[0].id;
          deptMap.set(dKey, deptId);
        }
      }

      // 插入用户
      const insertRes = await tx.execute<{ id: string }>(sql`
        insert into public.users (
          tenant_id,
          department_id,
          email,
          phone,
          employee_no,
          max_lead_quota,
          password_hash,
          name,
          role,
          status,
          session_version,
          created_at,
          updated_at
        ) values (
          ${tenant.tenantId},
          ${deptId},
          ${email},
          ${row.phone || null},
          ${row.employeeNo || null},
          ${Number(row.maxLeadQuota) || 100},
          ${defaultPasswordHash},
          ${name},
          ${role},
          'ACTIVE',
          1,
          now(),
          now()
        )
        returning id
      `);

      existingEmails.add(email);
      result.createdCount++;

      await recordAuditLog(
        tx,
        tenant.tenantId,
        tenant.userId,
        "USER_IMPORT",
        "user",
        insertRes.rows[0].id,
        { email, name, role, departmentName: row.departmentName },
      );
    }

    return result;
  });
}

export async function getOffboardingAssetSummaryService(
  tenant: TenantContext,
  userId: string,
): Promise<OffboardingAssetSummary> {
  return withTenant(tenant.tenantId, async (tx) => {
    const userRes = await tx.execute<{ name: string }>(sql`
      select name from public.users where id = ${userId} and tenant_id = ${tenant.tenantId}
    `);
    if (userRes.rows.length === 0) throw new Error("目标员工不存在");

    const countsRes = await tx.execute<{
      leads_count: string;
      customers_count: string;
      deals_count: string;
    }>(sql`
      select
        (select count(*)::text from public.leads where owner_user_id = ${userId} and tenant_id = ${tenant.tenantId} and status not in ('CONVERTED', 'DISCARDED') and deleted_at is null) as leads_count,
        (select count(*)::text from public.customers where owner_user_id = ${userId} and tenant_id = ${tenant.tenantId} and deleted_at is null) as customers_count,
        (select count(*)::text from public.opportunities where owner_user_id = ${userId} and tenant_id = ${tenant.tenantId} and stage not in ('WON', 'LOST') and deleted_at is null) as deals_count
    `);

    const counts = countsRes.rows[0];
    return {
      userId,
      userName: userRes.rows[0].name,
      leadsCount: Number(counts.leads_count || 0),
      customersCount: Number(counts.customers_count || 0),
      dealsCount: Number(counts.deals_count || 0),
    };
  });
}

export async function offboardMemberAndTransferAssetsService(
  tenant: TenantContext,
  input: OffboardingTransferInput,
): Promise<{ transferredLeads: number; transferredCustomers: number; transferredDeals: number }> {
  if (tenant.role !== "ADMIN") {
    throw new Error("权限不足：仅超级管理员可执行成员离职与资产交接");
  }

  if (input.offboardUserId === tenant.userId) {
    throw new Error("无法将当前登录账号执行离职流程");
  }

  return withTenant(tenant.tenantId, async (tx) => {
    // 锁定并校验末位 ADMIN 保护，防止并发将所有管理员停用
    const activeAdmins = await tx.execute<{ id: string }>(sql`
      select id from public.users
      where tenant_id = ${tenant.tenantId} and role = 'ADMIN' and status = 'ACTIVE'
      for update
    `);
    const targetIsAdmin = activeAdmins.rows.some((u) => u.id === input.offboardUserId);
    if (targetIsAdmin) {
      const remainingAdmins = activeAdmins.rows.filter((u) => u.id !== input.offboardUserId).length;
      if (remainingAdmins === 0) {
        throw new Error("操作被拦截：系统必须保留至少一名活跃超级管理员");
      }
    }

    // 1. 禁用离职人员账号并使其会话失效
    await tx.execute(sql`
      update public.users
      set status = 'DISABLED', session_version = session_version + 1, updated_at = now()
      where id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId}
    `);

    let transferredLeads = 0;
    let transferredCustomers = 0;
    let transferredDeals = 0;

    if (input.action === "TRANSFER" && input.transferToUserId) {
      // 验证接替人员是否存在且处于激活状态
      const targetUser = await tx.execute(sql`
        select id, name from public.users where id = ${input.transferToUserId} and tenant_id = ${tenant.tenantId} and status = 'ACTIVE'
      `);
      if (targetUser.rows.length === 0) {
        throw new Error("指定的接替人不存在或账号已被禁用");
      }

      // 转移未转化的活跃线索
      const leadsRes = await tx.execute(sql`
        update public.leads
        set owner_user_id = ${input.transferToUserId}, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and status not in ('CONVERTED', 'DISCARDED') and deleted_at is null
      `);
      transferredLeads = leadsRes.rowCount ?? 0;

      // 转移名下客户档案
      const custRes = await tx.execute(sql`
        update public.customers
        set owner_user_id = ${input.transferToUserId}, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and deleted_at is null
      `);
      transferredCustomers = custRes.rowCount ?? 0;

      // 转移在进商机
      const oppRes = await tx.execute(sql`
        update public.opportunities
        set owner_user_id = ${input.transferToUserId}, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and stage not in ('WON', 'LOST') and deleted_at is null
      `);
      transferredDeals = oppRes.rowCount ?? 0;
    } else {
      // 退回公海池模式：商机必须有归属销售（owner_user_id NOT NULL），
      // 不存在"商机公海"。名下仍有推进中商机时必须在事务前拦截并引导
      // 管理员先转移/处理商机，否则 NOT NULL 约束会让整个离职交接崩掉。
      const activeOppCount = await tx.execute<{ count: number }>(sql`
        select count(*)::integer as count from public.opportunities
        where owner_user_id = ${input.offboardUserId}
          and tenant_id = ${tenant.tenantId}
          and stage not in ('WON', 'LOST')
          and deleted_at is null
      `);
      if ((activeOppCount.rows[0]?.count ?? 0) > 0) {
        throw new Error(
          `该成员名下仍有 ${activeOppCount.rows[0].count} 个推进中商机，商机不支持退回公海，请先为商机指定接手人（选择接手人转移模式）或先处理完商机再离职`,
        );
      }

      // 退回公海池模式
      const leadsRes = await tx.execute(sql`
        update public.leads
        set owner_user_id = null, status = 'NEW', claimed_at = null, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and status not in ('CONVERTED', 'DISCARDED') and deleted_at is null
      `);
      transferredLeads = leadsRes.rowCount ?? 0;

      const custRes = await tx.execute(sql`
        update public.customers
        set owner_user_id = null, claimed_at = null, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and deleted_at is null
      `);
      transferredCustomers = custRes.rowCount ?? 0;

      const oppRes = await tx.execute(sql`
        update public.opportunities
        set owner_user_id = null, updated_at = now()
        where owner_user_id = ${input.offboardUserId} and tenant_id = ${tenant.tenantId} and stage not in ('WON', 'LOST') and deleted_at is null
      `);
      transferredDeals = oppRes.rowCount ?? 0;
    }

    // 调度已注册插件的离职交接钩子 (合同、订单、项目、待审批项等)
    const effectiveTransferToUserId = input.transferToUserId || "";
    const pluginTransferResults = await runPluginOffboardHooks(
      tx,
      tenant,
      input.offboardUserId,
      effectiveTransferToUserId,
    );

    await recordAuditLog(
      tx,
      tenant.tenantId,
      tenant.userId,
      "USER_OFFBOARD_TRANSFER",
      "user",
      input.offboardUserId,
      {
        transferToUserId: input.transferToUserId,
        effectiveTransferToUserId,
        action: input.action,
        transferredLeads,
        transferredCustomers,
        transferredDeals,
        pluginTransferResults,
      },
    );

    return { transferredLeads, transferredCustomers, transferredDeals };
  });
}
