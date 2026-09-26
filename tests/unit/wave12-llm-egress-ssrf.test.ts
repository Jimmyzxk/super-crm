import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dns from "node:dns";

/**
 * W12-1 LLM 出网 SSRF 安全连接器 —— 行为级测试
 *
 * 覆盖任务要求的四个场景（全部真起本地 http 服务、真 mock DNS、断言真实请求到达数）：
 *  ① 安全校验 DNS 返回公网、实际连接 DNS 返回 127.0.0.1 时不得连上本机
 *  ② DNS 解析失败必须拒绝、外发次数 0
 *  ③ 立即返回响应头 + 延迟发送正文时，总 deadline 到点中止读取
 *  ④ 重定向到内网地址必须被拒
 * 外加：LLM 出网不跟随重定向（凭据不外泄）、白名单也不豁免云元数据段、
 *      连接器泛化后合同 PDF 拉取行为保持不变。
 */

interface LocalServer {
  server: http.Server;
  port: number;
  hits: string[];
  close: () => Promise<void>;
}

async function startServer(handler: http.RequestListener): Promise<LocalServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url || "");
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    port,
    hits,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
  };
}

const originalAllowHosts = process.env.AI_GATEWAY_ALLOW_HOSTS;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAllowHosts === undefined) delete process.env.AI_GATEWAY_ALLOW_HOSTS;
  else process.env.AI_GATEWAY_ALLOW_HOSTS = originalAllowHosts;
});

describe("W12-1 LLM 出网复用 SSRF 安全连接器", () => {
  it("① DNS rebinding：校验解析为公网、实际连接解析为 127.0.0.1 时不得连上本机（本地服务零请求）", async () => {
    const local = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("LOCAL_SECRET_TOKEN");
    });
    try {
      const { safeFetchTextWithSsrf } = await import("@/core/ai-gateway/client");
      // 第一跳（安全校验）解析为公网 IP
      vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
      // 真实连接路径的 DNS（callback 形式）若被使用则会解析到本机
      vi.spyOn(dns, "lookup").mockImplementation(((
        _hostname: string,
        opts: unknown,
        cb: unknown,
      ) => {
        const callback = (typeof opts === "function" ? opts : cb) as (
          e: Error | null, a?: string, f?: number,
        ) => void;
        setImmediate(() => callback(null, "127.0.0.1", 4));
        return undefined as unknown as void;
      }) as never);

      let text: string | null = null;
      let error: unknown = null;
      try {
        const res = await safeFetchTextWithSsrf(
          `http://evil.example.com:${local.port}/steal-secret`,
          { method: "POST", headers: { Authorization: "Bearer sk-live-should-never-leak" }, body: "{}" },
          { timeoutMs: 900 },
        );
        text = res.text;
      } catch (e) {
        error = e;
      }

      // 关键断言：本机服务零请求到达，且 LOCAL_SECRET 绝不可能被读到
      expect(local.hits).toHaveLength(0);
      if (text !== null) expect(text).not.toContain("LOCAL_SECRET_TOKEN");
      else expect(error).toBeTruthy();
    } finally {
      await local.close();
    }
  });

  it("② DNS 解析失败必须 fail-closed 拒绝，且外发次数为 0", async () => {
    const { safeFetchTextWithSsrf } = await import("@/core/ai-gateway/client");
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(
      safeFetchTextWithSsrf("http://evil.example.com/v1/chat/completions", { method: "POST", body: "{}" }, { timeoutMs: 1500 }),
    ).rejects.toThrow(/DNS 解析失败/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("③ 立即返回响应头、正文延迟到达：总 deadline 到点中止读取（LLM 流式场景不被半截 JSON）", async () => {
    const local = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // 先发响应头，1 秒后才发正文；deadline 100ms 应在正文到达前中止
      setTimeout(() => {
        try { res.write('{"choices":[{"message":{"content":"LATE"}}]}'); res.end(); } catch {}
      }, 1000);
    });
    try {
      const { safeFetchTextWithSsrf } = await import("@/core/ai-gateway/client");
      process.env.AI_GATEWAY_ALLOW_HOSTS = "127.0.0.1";
      await expect(
        safeFetchTextWithSsrf(`http://127.0.0.1:${local.port}/v1/chat/completions`, { method: "POST", body: "{}" }, { timeoutMs: 120 }),
      ).rejects.toThrow(/请求超时/);
      expect(local.hits.length).toBeGreaterThanOrEqual(1);
    } finally {
      await local.close();
    }
  });

  it("④ 重定向到内网地址必须被拒（PDF 逐跳重验 + LLM 直接不跟随，两条路径都零请求到达内网）", async () => {
    const local = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("INTERNAL_METADATA");
    });
    try {
      const { safeFetchTextWithSsrf, fetchSafeBufferWithSsrf } = await import("@/core/ai-gateway/client");
      // 域名 evil.example.com 校验解析为公网，redirect 指向 127.0.0.1
      vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
      vi.spyOn(global, "fetch").mockImplementation((async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("http://evil.example.com")) {
          return new Response(null, {
            status: 302,
            headers: { location: `http://127.0.0.1:${local.port}/latest/meta-data/iam/security-credentials/` },
          });
        }
        return new Response("SHOULD_NOT_HAPPEN", { status: 200 });
      }) as never);

      // LLM 路径：任何 3xx 都直接判失败，绝不跟随（Bearer 凭据不得随跳转外泄）
      await expect(
        safeFetchTextWithSsrf("http://evil.example.com/v1/chat/completions", { method: "POST", body: "{}" }, { timeoutMs: 1500 }),
      ).rejects.toThrow(/重定向/);

      // PDF 路径：逐跳重验，第二跳目标为回环地址在发起请求前即被拒
      await expect(
        fetchSafeBufferWithSsrf("http://evil.example.com/contract.pdf", { timeoutMs: 1500 }),
      ).rejects.toThrow(/禁止访问内部网络地址/);

      expect(local.hits).toHaveLength(0);
    } finally {
      await local.close();
    }
  });

  it("白名单条目不豁免云元数据段：白名单域名解析到 169.254.169.254 仍被拒", async () => {
    const { safeFetchTextWithSsrf } = await import("@/core/ai-gateway/client");
    process.env.AI_GATEWAY_ALLOW_HOSTS = "rebind.example.com";
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
    const fetchSpy = vi.spyOn(global, "fetch");

    await expect(
      safeFetchTextWithSsrf(
        "http://rebind.example.com/latest/meta-data/",
        { method: "POST", body: "{}" },
        { timeoutMs: 1500, requireAllowListedHost: true },
      ),
    ).rejects.toThrow(/禁止访问内部网络地址/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("连接器泛化后合同 PDF 拉取行为不变：正常公网下载返回完整字节", async () => {
    const local = await startServer((_req, res) => {
      // 二进制内容（PDF 头），验证字节不被字符串往返破坏
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x42]));
    });
    try {
      const { fetchSafeBufferWithSsrf } = await import("@/core/ai-gateway/client");
      process.env.AI_GATEWAY_ALLOW_HOSTS = "127.0.0.1";
      const buf = await fetchSafeBufferWithSsrf(`http://127.0.0.1:${local.port}/signed.pdf`, { timeoutMs: 3000 });
      expect([...buf]).toEqual([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x42]);
    } finally {
      await local.close();
    }
  });

  it("LLM 出网同样受流式字节上限保护（超限在流中段熔断）", async () => {
    const { safeFetchTextWithSsrf } = await import("@/core/ai-gateway/client");
    vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
    vi.spyOn(global, "fetch").mockImplementation((async () => {
      let pushed = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pushed >= 3) { controller.close(); return; }
          controller.enqueue(new Uint8Array(1024 * 1024));
          pushed++;
        },
      });
      return new Response(stream, { status: 200, headers: {} });
    }) as never);

    await expect(
      safeFetchTextWithSsrf("http://evil.example.com/v1/chat/completions", { method: "POST", body: "{}" }, {
        timeoutMs: 3000,
        maxBytes: 2 * 1024 * 1024,
      }),
    ).rejects.toThrow(/超过 20MB 上限/);
  });
});
