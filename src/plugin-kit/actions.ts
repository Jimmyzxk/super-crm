"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { requireSession } from "@/core/auth/session";
import { withTenant } from "@/core/tenant";
import { recordPluginAuditLog } from "./server";

export async function togglePluginAction(input: { pluginKey: string; enabled: boolean }) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") {
      return { ok: false, message: "仅企业管理员有权启用或停用扩展插件" };
    }

    await withTenant(session.tenantId, async (tx) => {
      await tx.execute(sql`
        insert into public.plugin_registry (tenant_id, plugin_key, enabled, updated_at)
        values (${session.tenantId}::uuid, ${input.pluginKey}, ${input.enabled}, now())
        on conflict (tenant_id, plugin_key) do update
        set enabled = excluded.enabled, updated_at = now()
      `);

      await recordPluginAuditLog(
        tx,
        session,
        input.enabled ? "PLUGIN_ENABLED" : "PLUGIN_DISABLED",
        "plugin_registry",
        session.userId,
        { pluginKey: input.pluginKey, enabled: input.enabled }
      );
    });

    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { ok: true, data: { pluginKey: input.pluginKey, enabled: input.enabled } };
  } catch (error) {
    console.error("toggle plugin failed:", error);
    return { ok: false, message: error instanceof Error ? error.message : "操作失败，请重试" };
  }
}
