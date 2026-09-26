import { describe, expect, it } from "vitest";
import {
  getAdminWorkbenchService,
  getManagerWorkbenchService,
  listSalesWorkItemsService,
} from "@/core/workbench/service";

describe("销售工作台访问规则", () => {
  it("仅允许 SALES 读取自己的工作队列", async () => {
    await expect(listSalesWorkItemsService({
      tenantId: "tenant-id",
      userId: "user-id",
      role: "MANAGER",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("主管摘要仅允许 MANAGER", async () => {
    await expect(getManagerWorkbenchService({
      tenantId: "tenant-id",
      userId: "user-id",
      role: "SALES",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getManagerWorkbenchService({
      tenantId: "tenant-id",
      userId: "user-id",
      role: "ADMIN",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("治理摘要仅允许 ADMIN", async () => {
    await expect(getAdminWorkbenchService({
      tenantId: "tenant-id",
      userId: "user-id",
      role: "SALES",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getAdminWorkbenchService({
      tenantId: "tenant-id",
      userId: "user-id",
      role: "MANAGER",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
