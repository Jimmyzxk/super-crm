import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { tenants } from "@/db/schema";

export type TenantContext = { tenantId: string; userId: string; role: "ADMIN" | "MANAGER" | "SALES" };
export type TenantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getTenantStatusWithoutTenant(
  tenantId: string,
): Promise<"ACTIVE" | "SUSPENDED" | null> {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const [tenant] = await db
    .select({ status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return tenant?.status ?? null;
}

export async function listActiveTenantIdsWithoutTenant(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.status, "ACTIVE"));
  return rows.map((tenant) => tenant.id);
}

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
