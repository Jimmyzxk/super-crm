import "dotenv/config";
import pg from "pg";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dns from "node:dns";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * W12-1 / W12-2 LLM 出网与连通性测试纳管 —— 行为级集成测试（真 DB + 真实本地 http 服务）
 *
 * 覆盖：
 * - W12-1 callLlmGatewayService 的出网确实走 SSRF 安全连接器：
 *   正常白名单端点能拿到模型内容；DNS rebinding 端点一条请求都发不出去
 * - W12-2 连通性测试：AI 总开关关闭时，非白名单地址零外发；白名单地址成功且写审计
 *   （action = ai.connectivity_test），"AI 已关闭却发生外呼"可追溯
 */

const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
if (!migrationUrl || !appUrl) throw new Error("测试需要 TEST_MIGRATION_DATABASE_URL 和 TEST_DATABASE_URL");
if (new URL(migrationUrl).pathname === new URL(process.env.MIGRATION_DATABASE_URL ?? "postgres://localhost/invalid").pathname) {
  throw new Error("测试不得使用开发数据库");
}

process.env.MIGRATION_DATABASE_URL = migrationUrl;
process.env.DATABASE_URL = appUrl;

const owner = new pg.Client({ connectionString: migrationUrl });
const PW = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.76ebD0KZrV8d9zL8tSyzcW6rH8Vh1K";
const originalAllowHosts = process.env.AI_GATEWAY_ALLOW_HOSTS;

interface LocalServer { port: number; hits: Array<{ url: string; auth: string | undefined }>; close: () => Promise<void> }

async function startServer(): Promise<LocalServer> {
  const hits: Array<{ url: string; auth: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c.toString(); });
    req.on("end", () => {
      hits.push({ url: req.url || "", auth: req.headers.authorization });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "AI_GATEWAY_ONLINE" } }], usage: { total_tokens: 7 } }));
      void body;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, hits, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalAllowHosts === undefined) delete process.env.AI_GATEWAY_ALLOW_HOSTS;
  else process.env.AI_GATEWAY_ALLOW_HOSTS = originalAllowHosts;
});

describe("Wave12 LLM 出网 SSRF 收口与连通性测试纳管", { timeout: 60000 }, () => {
  let gateway: typeof import("@/core/ai-gateway/client");
  let encrypt: typeof import("@/core/security/crypto");
  let closeDb: typeof import("@/db/client").closeDb;
  let tenantId: string;
  let adminId: string;
  const ctx = () => ({ tenantId, userId: adminId, role: "ADMIN" as const });

  beforeAll(async () => {
    await owner.connect();
    gateway = await import("@/core/ai-gateway/client");
    encrypt = await import("@/core/security/crypto");
    closeDb = (await import("@/db/client")).closeDb;
    const ts = Date.now();
    const tRes = await owner.query<{ id: string }>(`insert into tenants (name) values ('Wave12出网收口租户') returning id`);
    tenantId = tRes.rows[0].id;
    const uRes = await owner.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, name, role, status) values ($1, $2, $3, 'W12 管理员', 'ADMIN', 'ACTIVE') returning id`,
      [tenantId, `w12-admin-${ts}@example.com`, PW],
    );
    adminId = uRes.rows[0].id;
    // AI 总开关默认关闭（合规场景）
    await owner.query(
      `insert into security_compliance_configs (tenant_id, is_ai_copilot_enabled, ai_provider, ai_api_key, ai_api_endpoint, ai_model_name)
       values ($1, false, 'DEEPSEEK', $2, null, 'deepseek-chat')`,
      [tenantId, encrypt.encryptSecret("sk-w12-real-key")],
    );
  });

  afterAll(async () => {
    if (tenantId) {
      await owner.query("delete from audit_logs where tenant_id = $1", [tenantId]);
      await owner.query("delete from security_compliance_configs where tenant_id = $1", [tenantId]);
      await owner.query("delete from users where tenant_id = $1", [tenantId]);
      await owner.query("delete from tenants where id = $1", [tenantId]);
    }
    await owner.end();
    await closeDb();
  });

  async function setGatewayConfig(opts: { enabled: boolean; endpoint: string | null }) {
    await owner.query(
      `update security_compliance_configs
         set is_ai_copilot_enabled = $2, ai_provider = 'DEEPSEEK', ai_api_endpoint = $3
       where tenant_id = $1`,
      [tenantId, opts.enabled, opts.endpoint],
    );
  }

  async function auditRows() {
    const res = await owner.query<{ action: string; detail: Record<string, unknown> }>(
      `select action, detail from audit_logs where tenant_id = $1 and action = 'ai.connectivity_test' order by created_at desc`,
      [tenantId],
    );
    return res.rows;
  }

  describe("W12-1 callLlmGatewayService 出网走 SSRF 安全连接器", () => {
    it("白名单内的合法端点能取到模型内容（出网未被误伤）", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: true, endpoint: `http://127.0.0.1:${local.port}/v1` });
        process.env.AI_GATEWAY_ALLOW_HOSTS = `127.0.0.1:${local.port}`;

        const res = await gateway.callLlmGatewayService(ctx(), {
          scene: "LEAD_OUTREACH",
          userPrompt: "生成一条线索摘要",
        });
        expect(res.isRealLlm).toBe(true);
        expect(res.rawText).toBe("AI_GATEWAY_ONLINE");
        expect(local.hits.length).toBe(1);
        expect(local.hits[0].auth).toBe("Bearer sk-w12-real-key");
        expect(local.hits[0].url).toContain("/v1/chat/completions");
      } finally {
        await local.close();
      }
    });

    it("DNS rebinding 端点（校验公网 / 实际连接 127.0.0.1）一条请求都发不出去，且降级不抛错", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: true, endpoint: "http://rebind.example.com/v1" });
        vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
        vi.spyOn(dns, "lookup").mockImplementation(((_h: string, opts: unknown, cb: unknown) => {
          const callback = (typeof opts === "function" ? opts : cb) as (e: Error | null, a?: string, f?: number) => void;
          setImmediate(() => callback(null, "127.0.0.1", 4));
          return undefined as unknown as void;
        }) as never);

        const res = await gateway.callLlmGatewayService(ctx(), {
          scene: "LEAD_OUTREACH",
          userPrompt: "生成一条线索摘要",
          fallbackContent: "本地兜底",
        });

        expect(res.isRealLlm).toBe(false);
        expect(res.rawText).toBe("本地兜底");
        expect(res.error).toBeTruthy();
        // 关键断言：API Key 与业务数据没有打进本机
        expect(local.hits).toHaveLength(0);
      } finally {
        await local.close();
      }
    });

    it("目标为内网字面量地址时同步被拒（零外发、密钥不外泄）", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: true, endpoint: `http://127.0.0.1:${local.port}/v1` });
        // 未登记白名单 → resolveProviderEndpoint 的同步字面量校验即拦截
        delete process.env.AI_GATEWAY_ALLOW_HOSTS;
        await expect(
          gateway.callLlmGatewayService(ctx(), { scene: "LEAD_OUTREACH", userPrompt: "x" }),
        ).rejects.toThrow(/禁止访问内部网络地址/);
        expect(local.hits).toHaveLength(0);
      } finally {
        await local.close();
      }
    });

    it("AI 总开关关闭时零外发（fail-closed 行为级：断言 fetch 从未被调用）", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: false, endpoint: `http://127.0.0.1:${local.port}/v1` });
        process.env.AI_GATEWAY_ALLOW_HOSTS = `127.0.0.1:${local.port}`;
        const fetchSpy = vi.spyOn(global, "fetch");

        const res = await gateway.callLlmGatewayService(ctx(), {
          scene: "LEAD_OUTREACH",
          userPrompt: "x",
          fallbackContent: "规则兜底",
        });
        expect(res.isRealLlm).toBe(false);
        expect(res.modelName).toBe("ai-disabled");
        expect(res.rawText).toBe("规则兜底");
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(local.hits).toHaveLength(0);
      } finally {
        await local.close();
      }
    });
  });

  describe("W12-2 连通性测试纳管（白名单 + 审计留痕）", () => {
    it("AI 总开关关闭时，对未登记白名单的公网形态地址断言零外发并写审计（不因私网字面量提前短路）", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: false, endpoint: null });
        process.env.AI_GATEWAY_ALLOW_HOSTS = `127.0.0.1:${local.port}`;

        const res = await gateway.testLlmConnectivityService(ctx(), {
          provider: "DEEPSEEK",
          apiKey: "sk-w12-admin-typed-key",
          // 白名单里放行另一个 host，使目标本身未命中白名单（这里用一个公网形态的域名）
          apiEndpoint: "http://not-allowlisted.example.com/v1",
          modelName: "deepseek-chat",
        });

        expect(res.success).toBe(false);
        expect(res.allowListMatched).toBe(false);
        expect(res.aiCopilotEnabled).toBe(false);
        expect(res.errorMessage).toMatch(/白名单/);
        expect(local.hits).toHaveLength(0);

        const rows = await auditRows();
        expect(rows.length).toBeGreaterThan(0);
        const latest = rows[0];
        expect(latest.detail.allowListMatched).toBe(false);
        expect(latest.detail.aiCopilotEnabled).toBe(false);
        expect(latest.detail.success).toBe(false);
        // 「AI 已关闭却发生外呼」必须可追溯：审计里带 AI 开关状态与目标主机
        expect(latest.detail.targetHost).toBe("not-allowlisted.example.com");
      } finally {
        await local.close();
      }
    });

    it("AI 总开关关闭时，白名单地址连通成功且审计记录 success=true", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: false, endpoint: null });
        process.env.AI_GATEWAY_ALLOW_HOSTS = `127.0.0.1:${local.port}`;

        const res = await gateway.testLlmConnectivityService(ctx(), {
          provider: "DEEPSEEK",
          apiKey: "sk-w12-admin-typed-key",
          apiEndpoint: `http://127.0.0.1:${local.port}/v1`,
          modelName: "deepseek-chat",
        });

        expect(res.success).toBe(true);
        expect(res.responsePreview).toBe("AI_GATEWAY_ONLINE");
        expect(res.allowListMatched).toBe(true);
        // 例外语义保留：AI 关闭时管理员仍可测试密钥，但响应里明确告知开关状态
        expect(res.aiCopilotEnabled).toBe(false);
        expect(local.hits.length).toBe(1);
        expect(local.hits[0].auth).toBe("Bearer sk-w12-admin-typed-key");

        const rows = await auditRows();
        const latest = rows[0];
        expect(latest.action).toBe("ai.connectivity_test");
        expect(latest.detail.success).toBe(true);
        expect(latest.detail.aiCopilotEnabled).toBe(false);
        expect(latest.detail.allowListMatched).toBe(true);
      } finally {
        await local.close();
      }
    });

    it("白名单域名解析到云元数据地址 169.254.169.254 仍被拒（白名单不是私网后门）", async () => {
      await setGatewayConfig({ enabled: false, endpoint: null });
      process.env.AI_GATEWAY_ALLOW_HOSTS = "rebind.example.com";
      vi.spyOn(dns.promises, "lookup").mockResolvedValue([{ address: "169.254.169.254", family: 4 }] as never);
      const fetchSpy = vi.spyOn(global, "fetch");

      const res = await gateway.testLlmConnectivityService(ctx(), {
        provider: "DEEPSEEK",
        apiKey: "sk-w12-admin-typed-key",
        apiEndpoint: "http://rebind.example.com/v1",
        modelName: "deepseek-chat",
      });

      expect(res.success).toBe(false);
      expect(res.allowListMatched).toBe(true);
      expect(res.errorMessage).toMatch(/禁止访问内部网络地址/);
      expect(fetchSpy).not.toHaveBeenCalled();

      const rows = await auditRows();
      expect(rows[0].detail.success).toBe(false);
      expect(rows[0].detail.errorMessage).toMatch(/禁止访问内部网络地址/);
    });

    it("连通性测试目标返回重定向时被拒（凭据不随 3xx 外泄）", async () => {
      const local = await startServer();
      try {
        await setGatewayConfig({ enabled: false, endpoint: null });
        process.env.AI_GATEWAY_ALLOW_HOSTS = `127.0.0.1:${local.port}`;
        vi.spyOn(global, "fetch").mockImplementation((async () =>
          new Response(null, { status: 307, headers: { location: "http://169.254.169.254/creds" } })) as never);

        const res = await gateway.testLlmConnectivityService(ctx(), {
          provider: "DEEPSEEK",
          apiKey: "sk-w12-admin-typed-key",
          apiEndpoint: `http://127.0.0.1:${local.port}/v1`,
          modelName: "deepseek-chat",
        });
        expect(res.success).toBe(false);
        expect(res.errorMessage).toMatch(/重定向/);
        expect(local.hits).toHaveLength(0);
      } finally {
        await local.close();
      }
    });
  });
});
