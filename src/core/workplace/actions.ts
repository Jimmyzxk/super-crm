"use server";

import { requireSession } from "@/core/auth/session";
import {
  createWorkplaceIntegrationService,
  deleteWorkplaceIntegrationService,
  listWorkplaceIntegrationsService,
  testWorkplaceIntegrationService,
} from "./service";
import type {
  CreateWorkplaceIntegrationInput,
  WorkplaceIntegrationItem,
} from "./types";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function listWorkplaceIntegrationsAction(): Promise<
  ActionResult<WorkplaceIntegrationItem[]>
> {
  try {
    const session = await requireSession();
    const data = await listWorkplaceIntegrationsService(session);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "获取机器人配置失败" };
  }
}

export async function createWorkplaceIntegrationAction(
  input: CreateWorkplaceIntegrationInput,
): Promise<ActionResult<WorkplaceIntegrationItem>> {
  try {
    const session = await requireSession();
    const data = await createWorkplaceIntegrationService(session, input);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "创建机器人集成失败" };
  }
}

export async function deleteWorkplaceIntegrationAction(
  id: string,
): Promise<ActionResult<{ success: boolean }>> {
  try {
    const session = await requireSession();
    await deleteWorkplaceIntegrationService(session, id);
    return { ok: true, data: { success: true } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "删除机器人集成失败" };
  }
}

export async function testWorkplaceIntegrationAction(
  id: string,
): Promise<ActionResult<{ success: boolean; message: string }>> {
  try {
    const session = await requireSession();
    const res = await testWorkplaceIntegrationService(session, id);
    return { ok: res.success, data: res, message: res.message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "测试推送失败" };
  }
}

// -------------------------------------------------------------
// 企业通讯录自动化同步 Actions
// -------------------------------------------------------------
import {
  executeDirectorySyncService,
  listDirectoryConfigsService,
  previewDirectorySyncDiffService,
  upsertDirectoryConfigService,
} from "./directory-sync";
import type {
  DirectorySyncDiffResult,
  DirectorySyncExecutionResult,
  UpsertDirectoryConfigInput,
  WorkplaceDirectoryConfigItem,
} from "./directory-sync";
import type { WorkplacePlatform } from "./types";

export async function listDirectoryConfigsAction(): Promise<
  ActionResult<WorkplaceDirectoryConfigItem[]>
> {
  try {
    const session = await requireSession();
    const data = await listDirectoryConfigsService(session);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "获取通讯录配置失败" };
  }
}

export async function upsertDirectoryConfigAction(
  input: UpsertDirectoryConfigInput,
): Promise<ActionResult<WorkplaceDirectoryConfigItem>> {
  try {
    const session = await requireSession();
    const data = await upsertDirectoryConfigService(session, input);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "更新通讯录配置失败" };
  }
}

export async function previewDirectorySyncDiffAction(
  platform: WorkplacePlatform,
): Promise<ActionResult<DirectorySyncDiffResult>> {
  try {
    const session = await requireSession();
    const data = await previewDirectorySyncDiffService(session, platform);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "拉取通讯录比对失败" };
  }
}

export async function executeDirectorySyncAction(
  platform: WorkplacePlatform,
): Promise<ActionResult<DirectorySyncExecutionResult>> {
  try {
    const session = await requireSession();
    const data = await executeDirectorySyncService(session, platform);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "执行通讯录同步失败" };
  }
}

