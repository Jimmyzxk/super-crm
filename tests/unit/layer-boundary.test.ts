import { describe, expect, it } from "vitest";
import { checkContent, scanLayerBoundaries } from "../../scripts/check-layer-boundary";

describe("分层门禁脚本验证", () => {
  it("临时样例：干净的 core 代码能够通过门禁检查", () => {
    const cleanCoreCode = `
      import { sql } from "drizzle-orm";
      import { withTenant } from "@/core/tenant";

      export async function getOpportunities(tenantId: string) {
        return withTenant(tenantId, async (tx) => {
          return tx.execute(sql\`select id, name, expected_amount from opportunities where tenant_id = \${tenantId}\`);
        });
      }
    `;

    const violations = checkContent("src/core/opportunity/clean-sample.ts", cleanCoreCode);
    expect(violations).toHaveLength(0);
  });

  it("临时样例：违规引用 @/plugins 会被门禁准确拦截", () => {
    const illegalImportCode = `
      import { contractsService } from "@/plugins/contracts/service";

      export function doSomething() {
        return contractsService();
      }
    `;

    const violations = checkContent("src/core/some-module/violator.ts", illegalImportCode);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.type === "FORBIDDEN_IMPORT" && v.detail.includes("@/plugins"))).toBe(true);
  });

  it("临时样例：SQL 中直接查询 plugin_* 业务插件表会被门禁准确拦截", () => {
    const illegalSqlCode = `
      import { sql } from "drizzle-orm";

      export async function queryContracts(tx: any, tenantId: string) {
        return tx.execute(sql\`select id from plugin_contracts where tenant_id = \${tenantId}\`);
      }
    `;

    const violations = checkContent("src/core/some-module/sql-violator.ts", illegalSqlCode);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.type === "FORBIDDEN_TABLE" && v.detail.includes("plugin_contracts"))).toBe(true);
  });

  it("门禁能力校验：能够准确抓取此前 core 残留的三类插件表违规字样", () => {
    const sampleLeadsResidual = "select enabled from plugin_registry where tenant_id = $1";
    const sampleAttributionResidual = "select c.title from plugin_contracts c where c.tenant_id = $1";
    const sampleCustomerResidual = "select o.total_amount from plugin_orders where tenant_id = $1";

    const v1 = checkContent("src/core/leads/service.ts", sampleLeadsResidual);
    const v2 = checkContent("src/core/ai-hub/tools/attribution.ts", sampleAttributionResidual);
    const v3 = checkContent("src/core/customer/service.ts", sampleCustomerResidual);

    expect(v1.some((v) => v.type === "FORBIDDEN_TABLE" && v.detail.includes("plugin_registry"))).toBe(true);
    expect(v2.some((v) => v.type === "FORBIDDEN_TABLE" && v.detail.includes("plugin_contracts"))).toBe(true);
    expect(v3.some((v) => v.type === "FORBIDDEN_TABLE" && v.detail.includes("plugin_orders"))).toBe(true);
  });

  it("真实代码库扫描：src/core 与 src/lib 在零豁免下 100% 零违规通过", async () => {
    const result = await scanLayerBoundaries();
    expect(result.violations).toHaveLength(0);
  });
});
