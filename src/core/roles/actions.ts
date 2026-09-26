"use server";

import { requireSession } from "@/core/auth/session";
import { toResult, type Result } from "@/core/shared/result";
import { getEffectiveUserPermissionsService, requirePermission, PERMISSIONS } from "@/core/auth/permissions";
import {
  assignUserRolesService,
  createRoleService,
  deleteRoleService,
  listRolesService,
  listUserRoleAssignmentsService,
  updateRoleService,
} from "./service";
import type {
  CreateRoleInput,
  CustomRoleItem,
  UpdateRoleInput,
  UserRoleAssignmentItem,
} from "./types";

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    return toResult<T>(error);
  }
}

export async function listRolesAction(): Promise<Result<CustomRoleItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listRolesService(session);
  });
}

export async function createRoleAction(input: CreateRoleInput): Promise<Result<CustomRoleItem>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.ORGANIZATION_MANAGE);
    return createRoleService(session, input);
  });
}

export async function updateRoleAction(
  roleId: string,
  input: UpdateRoleInput,
): Promise<Result<CustomRoleItem>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.ORGANIZATION_MANAGE);
    return updateRoleService(session, roleId, input);
  });
}

export async function deleteRoleAction(
  roleId: string,
): Promise<Result<{ success: boolean; message: string }>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.ORGANIZATION_MANAGE);
    return deleteRoleService(session, roleId);
  });
}

export async function assignUserRolesAction(
  userId: string,
  roleIds: string[],
): Promise<Result<{ success: boolean; count: number }>> {
  return run(async () => {
    const session = await requireSession();
    await requirePermission(session, PERMISSIONS.ORGANIZATION_MANAGE);
    return assignUserRolesService(session, userId, roleIds);
  });
}

export async function listUserRoleAssignmentsAction(): Promise<Result<UserRoleAssignmentItem[]>> {
  return run(async () => {
    const session = await requireSession();
    return listUserRoleAssignmentsService(session);
  });
}

export async function getEffectiveUserPermissionsAction(): Promise<Result<string[]>> {
  return run(async () => {
    const session = await requireSession();
    return getEffectiveUserPermissionsService(session);
  });
}
