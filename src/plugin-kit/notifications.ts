import { createNotificationInTransaction } from "@/core/notification/service";
import type { TenantTransaction } from "@/core/tenant";
import type { NotificationType } from "@/core/notification/types";

export async function createPluginNotificationInTransaction(
  tx: TenantTransaction,
  input: {
    tenantId: string;
    userId: string;
    type?: NotificationType;
    title: string;
    body: string;
    link?: string;
    createdAt?: Date | string;
  },
): Promise<void> {
  return createNotificationInTransaction(tx, input);
}
