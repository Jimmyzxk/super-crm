import { describe, it, expect } from "vitest";

/**
 * F08 AI 总开关 fail-closed
 *
 * 说明：原实现的两条用例都是 readFileSync + toContain 的源码字符串断言，外部审计已明确
 * 这类断言不能作为风险关闭证据。本文件改为调用真实实现做行为断言：
 *  - resolveProviderEndpoint 对内网/非法端点 fail-closed（同步可达，无需 DB）
 *  - callLlmGatewayService 在 isEnabled=false 时**零外发**（真 DB + fetch spy）的行为
 *    测试位于 tests/integration/wave12-llm-egress-and-connectivity.test.ts
 *    用例「AI 总开关关闭时零外发（fail-closed 行为级：断言 fetch 从未被调用）」
 *  - 连通性测试的纳管边界与审计留痕同样在该文件
 *    （W12-2 describe 块）
 */

describe("F08 AI 网关出网 fail-closed（端点配置侧）", () => {
  it("自定义端点为回环/链路本地地址时同步拒绝（零外发的前置拦截）", async () => {
    const { resolveProviderEndpoint } = await import("@/core/ai-gateway/client");
    const prev = process.env.AI_GATEWAY_ALLOW_HOSTS;
    delete process.env.AI_GATEWAY_ALLOW_HOSTS;
    try {
      expect(() => resolveProviderEndpoint("CUSTOM", "http://127.0.0.1:8080/v1")).toThrow(/禁止访问内部网络地址/);
      expect(() => resolveProviderEndpoint("CUSTOM", "http://169.254.169.254/latest")).toThrow(/禁止访问内部网络地址/);
      expect(() => resolveProviderEndpoint("CUSTOM", "http://10.1.2.3/v1")).toThrow(/禁止访问内部网络地址/);
      expect(() => resolveProviderEndpoint("CUSTOM", "file:///etc/passwd")).toThrow(/仅支持 HTTP\/HTTPS/);
      expect(() => resolveProviderEndpoint("CUSTOM", "not-a-url")).toThrow();
    } finally {
      if (prev === undefined) delete process.env.AI_GATEWAY_ALLOW_HOSTS;
      else process.env.AI_GATEWAY_ALLOW_HOSTS = prev;
    }
  });

  it("合法自定义端点被规范化为 OpenAI 兼容的 /chat/completions 路径", async () => {
    const { resolveProviderEndpoint } = await import("@/core/ai-gateway/client");
    expect(resolveProviderEndpoint("CUSTOM", "https://llm.corp.example.com/v1/")).toBe(
      "https://llm.corp.example.com/v1/chat/completions",
    );
    expect(resolveProviderEndpoint("CUSTOM", "https://llm.corp.example.com/v1/chat/completions")).toBe(
      "https://llm.corp.example.com/v1/chat/completions",
    );
  });

  it("厂商默认端点不随租户自定义端点漂移", async () => {
    const { resolveProviderEndpoint } = await import("@/core/ai-gateway/client");
    expect(resolveProviderEndpoint("DEEPSEEK")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(resolveProviderEndpoint("OPENAI")).toBe("https://api.openai.com/v1/chat/completions");
    expect(resolveProviderEndpoint("ZHIPU")).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
  });
});
