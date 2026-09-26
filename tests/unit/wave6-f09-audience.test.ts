/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * F09 报告受众分层
 *
 * 原实现的后两条用例是 readFileSync + toContain 源码字符串断言（外部审计点名不可作为
 * 风险关闭证据）。本文件改为直接调用真实 service 做行为断言：注入可控的租户事务替身，
 * 断言「SQL 是否发出」「返回结构是否脱敏/截断/置空」等可观测行为。
 */

afterEach(() => vi.restoreAllMocks());

const SENSITIVE = "【可复制动作】\n- 每周确认下一步\n营收（万元）：120\n手机号：13812345678\n邮箱：test@example.com\n";

type FakeRow = {
  id: string;
  kind: string;
  period: string;
  content: string;
  evidence: Record<string, unknown>;
  sample_size: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  public_summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: "r1",
    kind: "CHAMPION_ANALYSIS",
    period: "2026-09",
    content: SENSITIVE,
    evidence: { revenue: 120, phone: "13812345678" },
    sample_size: 5,
    confidence: "LOW",
    public_summary: null,
    created_by: "u1",
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

async function withFakeTx(rows: FakeRow[], fn: (tx: unknown) => Promise<unknown>) {
  const tenantMod = await import("@/core/tenant");
  const execute = vi.fn(async () => ({ rows }));
  const spy = vi.spyOn(tenantMod as any, "withTenant").mockImplementation(async (_tid: any, cb: any) =>
    cb({ execute } as never),
  );
  try {
    return { result: await fn({ execute }), execute };
  } finally {
    spy.mockRestore();
  }
}

describe("F09 报告受众分层（行为级）", () => {
  it("REPORT_AUDIENCE_MATRIX：CHAMPION_ANALYSIS 对销售可见、COMPANY_PROFILE 不可见", async () => {
    const { REPORT_AUDIENCE_MATRIX } = await import("@/core/ai-hub/service");
    expect(REPORT_AUDIENCE_MATRIX.CHAMPION_ANALYSIS.salesVisible).toBe(true);
    expect(REPORT_AUDIENCE_MATRIX.COMPANY_PROFILE.salesVisible).toBe(false);
  });

  it("销售请求不可见 kind 时列表直接返回空且**完全不查库**（服务端前置拦截）", async () => {
    const { listInsightReportsService } = await import("@/core/ai-hub/service");
    const salesCtx = { tenantId: "t1", userId: "s1", role: "SALES" as const };
    const { result, execute } = await withFakeTx([makeRow({ kind: "COMPANY_PROFILE" })], () =>
      listInsightReportsService(salesCtx, "COMPANY_PROFILE" as never),
    );
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("销售详情请求不可见 kind 时返回 null（不泄露存在性）", async () => {
    const { getInsightReportByIdService } = await import("@/core/ai-hub/service");
    const salesCtx = { tenantId: "t1", userId: "s1", role: "SALES" as const };
    const { result } = await withFakeTx([makeRow({ kind: "COMPANY_PROFILE" })], () =>
      getInsightReportByIdService(salesCtx, "r1"),
    );
    expect(result).toBeNull();
  });

  it("销售可见报告：正文只返回脱敏摘要且 evidence 置空", async () => {
    const { listInsightReportsService, getInsightReportByIdService } = await import("@/core/ai-hub/service");
    const salesCtx = { tenantId: "t1", userId: "s1", role: "SALES" as const };

    const list = await withFakeTx([makeRow()], () => listInsightReportsService(salesCtx, "CHAMPION_ANALYSIS" as never));
    const listItem = (list.result as Array<{ content: string; evidence: unknown }>)[0];
    expect(listItem.evidence).toEqual({});
    expect(listItem.content).not.toContain("13812345678");
    expect(listItem.content).not.toContain("test@example.com");

    const detail = await withFakeTx([makeRow()], () => getInsightReportByIdService(salesCtx, "r1"));
    const detailItem = detail.result as { content: string; evidence: unknown };
    expect(detailItem.evidence).toEqual({});
    expect(detailItem.content).not.toContain("13812345678");
    expect(detailItem.content).not.toContain("test@example.com");
  });

  it("非销售角色：列表正文截断到 500 字符并标注已截断，详情返回原文", async () => {
    const { listInsightReportsService, getInsightReportByIdService } = await import("@/core/ai-hub/service");
    const mgrCtx = { tenantId: "t1", userId: "m1", role: "MANAGER" as const };
    const long = "A".repeat(900);

    const list = await withFakeTx([makeRow({ content: long, kind: "COMPANY_PROFILE" })], () =>
      listInsightReportsService(mgrCtx, "COMPANY_PROFILE" as never),
    );
    const listItem = (list.result as Array<{ content: string; evidence: Record<string, unknown> }>)[0];
    expect(listItem.content).toContain("已截断");
    expect(listItem.content.length).toBeLessThan(long.length);
    // 非销售仍能拿到 evidence（管理视角）
    expect(listItem.evidence).toEqual({ revenue: 120, phone: "13812345678" });

    const detail = await withFakeTx([makeRow({ content: long, kind: "COMPANY_PROFILE" })], () =>
      getInsightReportByIdService(mgrCtx, "r1"),
    );
    expect((detail.result as { content: string }).content).toBe(long);
  });
});
