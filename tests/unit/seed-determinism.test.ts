import { describe, it, expect } from "vitest";
import { deterministicUuidV5 } from "../../scripts/seed/identity";

describe("Seed Determinism & UUID v5 Specification (Group C)", () => {
  it("generates deterministic and reproducible UUIDs across multiple calls with same inputs", () => {
    const id1 = deterministicUuidV5("lead", 42);
    const id2 = deterministicUuidV5("lead", 42);
    const id3 = deterministicUuidV5("lead", 43);
    const idCust = deterministicUuidV5("customer", 42);

    // 同一入参多次生成结果严格一致
    expect(id1).toBe(id2);
    // 不同序号不同
    expect(id1).not.toBe(id3);
    // 不同实体不同
    expect(id1).not.toBe(idCust);
  });

  it("conforms strictly to RFC 4122 UUID version 5 format and variant", () => {
    const id = deterministicUuidV5("opportunity", 100);

    // 标准 UUID 格式：8-4-4-4-12
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // 版本位必须为 5
    const versionNibble = id.split("-")[2][0];
    expect(versionNibble).toBe("5");

    // Variant 位必须为 8, 9, a 或 b
    const variantNibble = id.split("-")[3][0];
    expect(["8", "9", "a", "b"]).toContain(variantNibble);
  });

  it("produces distinct UUIDs across different tenant boundaries for multi-tenant isolation", () => {
    const tenantA = "00000000-0000-4000-8000-000000000001";
    const tenantB = "00000000-0000-4000-8000-000000000002";

    const idTenantA = deterministicUuidV5("lead", 1, tenantA);
    const idTenantB = deterministicUuidV5("lead", 1, tenantB);

    expect(idTenantA).not.toBe(idTenantB);
  });
});
