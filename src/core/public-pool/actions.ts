"use server";

import { requireSession } from "@/core/auth/session";
import {
  listPublicPoolRulesService,
  runPublicPoolRecycleScanService,
  upsertPublicPoolRuleService,
} from "./service";
import type {
  PublicPoolRecycleScanResult,
  PublicPoolRuleItem,
  UpdatePublicPoolRuleInput,
} from "./types";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function listPublicPoolRulesAction(): Promise<ActionResult<PublicPoolRuleItem[]>> {
  try {
    const session = await requireSession();
    const data = await listPublicPoolRulesService(session);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "获取公海规则失败" };
  }
}

export async function upsertPublicPoolRuleAction(
  input: UpdatePublicPoolRuleInput,
): Promise<ActionResult<PublicPoolRuleItem>> {
  try {
    const session = await requireSession();
    const data = await upsertPublicPoolRuleService(session, input);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "更新公海规则失败" };
  }
}

export async function runPublicPoolRecycleScanAction(options: {
  dryRun?: boolean;
} = {}): Promise<ActionResult<PublicPoolRecycleScanResult>> {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN" && session.role !== "MANAGER") {
      return { ok: false, message: "权限不足：仅管理员或主管可执行公海回收扫描" };
    }
    const data = await runPublicPoolRecycleScanService(session, options);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "执行公海回收扫描失败" };
  }
}

import {
  scanPublicPoolPreRecycleWarningsService,
  type PublicPoolPreWarningItem,
} from "./service";

export async function scanPublicPoolPreRecycleWarningsAction(): Promise<
  ActionResult<{ warningCount: number; warnings: PublicPoolPreWarningItem[] }>
> {
  try {
    const session = await requireSession();
    if (session.role === "SALES") {
      return { ok: false, message: "权限不足：仅管理员或业务主管可触发公海临期预警全局扫描" };
    }
    const data = await scanPublicPoolPreRecycleWarningsService(session);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "扫描临期预警失败" };
  }
}

