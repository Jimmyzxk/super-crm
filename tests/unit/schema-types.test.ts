import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customers, leads, opportunities } from "@/db/schema";

describe("Drizzle 阶段 4 表类型", () => {
  it("保留客户、线索、商机的完整列类型", () => {
    const customerFilter = eq(customers.name, "客户");
    const leadFilter = eq(leads.status, "NEW");
    const opportunityFilter = eq(opportunities.stage, "DISCOVERY");

    expect([customerFilter, leadFilter, opportunityFilter]).toHaveLength(3);
    expect(customers.name.name).toBe("name");
    expect(leads.status.name).toBe("status");
    expect(opportunities.stage.name).toBe("stage");
  });
});
