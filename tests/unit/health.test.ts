import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/health/route";
import * as healthService from "@/core/health/service";

vi.mock("@/core/health/service", () => ({
  checkDatabaseHealthService: vi.fn(),
}));

describe("Health Check Route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return ok when db check passes", async () => {
    vi.mocked(healthService.checkDatabaseHealthService).mockResolvedValueOnce(undefined);

    const response = await GET();
    const data = await response.json() as unknown as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.db).toBe("ok");
    expect(data.ts).toBeDefined();
  });

  it("should return 503 and failed when db check fails", async () => {
    vi.mocked(healthService.checkDatabaseHealthService).mockRejectedValueOnce(new Error("DB Connection Error"));

    const response = await GET();
    const data = await response.json() as unknown as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(data.status).toBe("error");
    expect(data.db).toBe("failed");
    expect(data.ts).toBeDefined();
  });
});
