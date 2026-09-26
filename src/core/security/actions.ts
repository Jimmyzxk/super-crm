"use server";

import { requireSession } from "@/core/auth/session";
import { BusinessError } from "@/core/shared/result";
import {
  getSecurityComplianceConfigService,
  logSensitiveDataUnmaskService,
  upsertSecurityComplianceConfigService,
} from "./service";
import type {
  SecurityComplianceConfigItem,
  UpdateSecurityConfigInput,
} from "./service";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function getSecurityComplianceConfigAction(): Promise<
  ActionResult<SecurityComplianceConfigItem>
> {
  try {
    const session = await requireSession();
    const data = await getSecurityComplianceConfigService(session);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "获取安全合规配置失败" };
  }
}

export async function upsertSecurityComplianceConfigAction(
  input: UpdateSecurityConfigInput,
): Promise<ActionResult<SecurityComplianceConfigItem>> {
  try {
    const session = await requireSession();
    const data = await upsertSecurityComplianceConfigService(session, input);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "更新安全合规配置失败" };
  }
}

export async function revealSensitiveFieldAction(
  entityType: "LEAD" | "CONTACT" | "CUSTOMER",
  entityId: string,
  fieldName: "PHONE" | "EMAIL",
  reason?: string,
): Promise<ActionResult<{ unmaskedValue: string }>> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)) {
      throw new BusinessError("VALIDATION_ERROR", "非法实体ID格式");
    }
    const session = await requireSession();
    const data = await logSensitiveDataUnmaskService(session, entityType, entityId, fieldName, reason);
    return { ok: true, data: { unmaskedValue: data.unmaskedValue } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "查看明文敏感数据失败" };
  }
}
