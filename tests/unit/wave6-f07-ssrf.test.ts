import { describe, it, expect, vi } from "vitest";
import dns from "node:dns";

/**
 * F07 SSRF 与安全下载 —— 行为级测试
 *
 * 说明：
 * - 前 5 条为原有的真实行为用例（调用真实 assertSafeHttpUrl / assertSafeHttpUrlWithDns /
 *   fetchSafeBufferWithSsrf，DNS 用受控 mock），保留。
 * - 原第 6 条「签署事务内无网络调用」是 readFileSync + toContain 源码字符串断言，外部
 *   审计已点名不可作为风险关闭证据，已删除。替代覆盖：
 *   · 下载期不得持有数据库事务（真 DB + pg_stat_activity）：见
 *     tests/integration/contract-sign-no-tx-network.test.ts
 *     用例「盖章签署期间 PDF 下载不占用数据库连接（无 idle in transaction）」
 *   · 签署成功后状态流转为 SIGNED_ACTIVE（真 DB 走完整签署闭环）：见
 *     tests/integration/contracts-orders-projects.test.ts「支持完成合同盖章签署并生效」
 *   · LLM 出网复用同一套 SSRF 连接器的四个场景（含 rebinding、deadline 覆盖正文、
 *     重定向拒内网）：见 tests/unit/wave12-llm-egress-ssrf.test.ts
 */

describe("F07 SSRF 与安全下载", () => {
  it("尾点 localhost. 被拦截", async () => {
    const { assertSafeHttpUrl } = await import("@/core/ai-gateway/client");
    expect(() => assertSafeHttpUrl("http://localhost./")).toThrow();
    expect(() => assertSafeHttpUrl("http://localhost.:3000/")).toThrow();
  });

  it("dns 解析到内网 IP 被拦截（含重定向逐跳场景前的 hostname 去尾点）", async () => {
    const { assertSafeHttpUrlWithDns } = await import("@/core/ai-gateway/client");
    const spy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "192.168.1.50", family: 4 }] as never);
    await expect(assertSafeHttpUrlWithDns("http://evil.example.com/file.pdf")).rejects.toThrow(/禁止访问内部/);
    spy.mockRestore();
  });

  it("dns 解析到 IPv6 ULA 被拦截", async () => {
    const { assertSafeHttpUrlWithDns } = await import("@/core/ai-gateway/client");
    const spy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "fd00::1", family: 6 }] as never);
    await expect(assertSafeHttpUrlWithDns("http://evil.example.com/p")).rejects.toThrow();
    spy.mockRestore();
  });

  it("公网域名放行", async () => {
    const { assertSafeHttpUrlWithDns } = await import("@/core/ai-gateway/client");
    const spy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    await expect(assertSafeHttpUrlWithDns("http://93.184.215.14/callback")).resolves.toBeUndefined();
    spy.mockRestore();
    // 域名解析为公网也放行
    const spy2 = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    await expect(assertSafeHttpUrlWithDns("https://example.com/api")).resolves.toBeUndefined();
    spy2.mockRestore();
  });

  it("流式下载超大纲在流中段熔断（不待读完）", async () => {
    const { fetchSafeBufferWithSsrf } = await import("@/core/ai-gateway/client");
    // 构造超大流：mock fetch 返回 ReadableStream 持续推送超过 20MB
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async () => {
      // 创建一个每块 1MB 的流，推送 21 块
      let pushed = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pushed >= 21) { controller.close(); return; }
          controller.enqueue(new Uint8Array(1024 * 1024));
          pushed++;
        },
      });
      return new Response(stream, { status: 200, headers: {} });
    });
    // dns 放行
    const dnsSpy = vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    await expect(fetchSafeBufferWithSsrf("http://example.com/big.pdf", { maxBytes: 20 * 1024 * 1024, timeoutMs: 5000 }))
      .rejects.toThrow(/超过 20MB/);
    dnsSpy.mockRestore();
    global.fetch = originalFetch;
  });
});
