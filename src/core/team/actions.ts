"use server";

import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import {
  batchImportTeamMembersService,
  createDepartmentService,
  createTeamMemberService,
  deleteDepartmentService,
  getOffboardingAssetSummaryService,
  listDepartmentsService,
  listTeamMembersService,
  offboardMemberAndTransferAssetsService,
  updateDepartmentService,
  updateTeamMemberService,
} from "./service";
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

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function listDepartmentsAction(): Promise<Result<DepartmentItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listDepartmentsService(session);
  });
}

export async function createDepartmentAction(input: {
  name: string;
  parentId?: string | null;
  leaderUserId?: string | null;
  sortOrder?: number;
}): Promise<Result<DepartmentItem>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权创建部门");
    return createDepartmentService(session, input);
  });
}

export async function updateDepartmentAction(input: {
  id: string;
  name?: string;
  parentId?: string | null;
  leaderUserId?: string | null;
  sortOrder?: number;
}): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权编辑部门");
    return updateDepartmentService(session, input);
  });
}

export async function deleteDepartmentAction(departmentId: string): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权删除部门");
    return deleteDepartmentService(session, departmentId);
  });
}

export async function listTeamMembersAction(filter?: {
  departmentId?: string;
  role?: string;
  status?: "ACTIVE" | "DISABLED";
  search?: string;
}): Promise<Result<TeamMemberItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listTeamMembersService(session, filter);
  });
}

export async function createTeamMemberAction(
  input: CreateTeamMemberInput,
): Promise<Result<{ id: string; name: string; email: string }>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权添加新成员");
    return createTeamMemberService(session, input);
  });
}

export async function updateTeamMemberAction(
  input: UpdateTeamMemberInput,
): Promise<Result<void>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权修改成员信息与权限");
    return updateTeamMemberService(session, input);
  });
}

export async function batchImportTeamMembersAction(
  rows: BatchImportUserRow[],
): Promise<Result<BatchImportResult>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权批量导入成员");
    return batchImportTeamMembersService(session, rows);
  });
}

export async function getOffboardingAssetSummaryAction(
  userId: string,
): Promise<Result<OffboardingAssetSummary>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权查看离职资产交接数据");
    return getOffboardingAssetSummaryService(session, userId);
  });
}

export async function offboardMemberAndTransferAssetsAction(
  input: OffboardingTransferInput,
): Promise<Result<{ transferredLeads: number; transferredCustomers: number; transferredDeals: number }>> {
  return run(async () => {
    const session = await requireSession();
    if (session.role !== "ADMIN") throw new Error("仅超级管理员有权执行离职资产交接与账号注销");
    return offboardMemberAndTransferAssetsService(session, input);
  });
}
