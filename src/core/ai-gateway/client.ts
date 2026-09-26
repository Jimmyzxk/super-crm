import { sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/core/tenant";
import { decryptSecret } from "@/core/security/crypto";
import type { AiPromptScene } from "@/core/ai-hub/types";

export interface LlmGatewayConfig {
  isEnabled: boolean;
  provider: "BUILTIN" | "OPENAI" | "DEEPSEEK" | "ZHIPU" | "QWEN" | "GEMINI" | "CUSTOM";
  apiKey: string | null;
  apiEndpoint: string | null;
  modelName: string;
  temperature: number;
}


export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type LlmToolChoice = "auto" | "none" | { type: "function", function: { name: string } };

export interface CallLlmParams {
  scene: AiPromptScene | "KNOWLEDGE_TACTICAL" | "KNOWLEDGE_ASK" | "AGENT_HARNESS";
  systemPrompt?: string;
  userPrompt?: string;
  messages?: LlmMessage[];
  tools?: LlmTool[];
  tool_choice?: LlmToolChoice;
  temperature?: number;
  fallbackContent?: string;
}

export interface LlmTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
}

export interface LlmResponseResult<T = unknown> {
  rawText: string;
  data: T | null;
  isRealLlm: boolean;
  provider: string;
  modelName: string;
  latencyMs?: number;
  error?: string;
  tool_calls?: LlmToolCall[];
  usage?: LlmTokenUsage;
}

/**
 * 健壮的多层 JSON 解析器，自动处理 Markdown 代码块与包裹字符
 */
export function extractJsonFromText<T = unknown>(text: string): T | null {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();

  // 1. 尝试直接解析
  try {
    return JSON.parse(trimmed);
  } catch {}

  // 2. 尝试从 Markdown ```json ... ``` 代码块中提取
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  // 3. 尝试截取首个 '{' 与末个 '}' 之间的内容
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      const jsonSub = trimmed.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonSub);
    } catch {}
  }

  return null;
}

import net from "node:net";
import dns from "node:dns";

function parseInetAton(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const parsedNumbers: number[] = [];
  for (const part of parts) {
    if (!part) return null;
    let val: number;
    if (/^0x[0-9a-f]+$/i.test(part)) {
      val = parseInt(part, 16);
    } else if (/^0[0-7]+$/.test(part)) {
      val = parseInt(part, 8);
    } else if (/^\d+$/.test(part)) {
      val = parseInt(part, 10);
    } else {
      return null;
    }
    if (isNaN(val) || val < 0) return null;
    parsedNumbers.push(val);
  }

  if (parsedNumbers.length === 1) {
    const val = parsedNumbers[0];
    if (val > 0xffffffff) return null;
    return [
      (val >>> 24) & 255,
      (val >>> 16) & 255,
      (val >>> 8) & 255,
      val & 255,
    ];
  }

  if (parsedNumbers.length === 2) {
    const [a, b] = parsedNumbers;
    if (a > 0xff || b > 0xffffff) return null;
    return [
      a,
      (b >>> 16) & 255,
      (b >>> 8) & 255,
      b & 255,
    ];
  }

  if (parsedNumbers.length === 3) {
    const [a, b, c] = parsedNumbers;
    if (a > 0xff || b > 0xff || c > 0xffff) return null;
    return [
      a,
      b,
      (c >>> 8) & 255,
      c & 255,
    ];
  }

  if (parsedNumbers.length === 4) {
    const [a, b, c, d] = parsedNumbers;
    if (a > 0xff || b > 0xff || c > 0xff || d > 0xff) return null;
    return [a, b, c, d];
  }

  return null;
}

function isPrivateIpV4Bytes(b0: number, b1: number, b2: number, b3: number): boolean {
  // 0.0.0.0/8
  if (b0 === 0) return true;
  // 127.0.0.0/8 (Loopback e.g. 127.0.0.1, 127.1, 127.2.3.4)
  if (b0 === 127) return true;
  // 10.0.0.0/8 (Private-Use)
  if (b0 === 10) return true;
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
  // 169.254.0.0/16 (Link Local)
  if (b0 === 169 && b1 === 254) return true;
  // 172.16.0.0/12 (Private-Use)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;
  // 192.168.0.0/16 (Private-Use)
  if (b0 === 192 && b1 === 168) return true;
  // 198.18.0.0/15 (Benchmarking)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (b0 >= 240) return true;
  // 255.255.255.255 (Broadcast)
  if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;
  return false;
}

function isPrivateIpV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback & Unspecified
  if (lower === "::1" || lower === "::" || lower === "0:0:0:0:0:0:0:1" || lower === "0:0:0:0:0:0:0:0") return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (lower.startsWith("::ffff:") || lower.startsWith("0:0:0:0:0:ffff:")) {
    const v4Part = lower.replace(/^.*ffff:/, "");
    const parsedV4 = parseInetAton(v4Part);
    if (parsedV4) {
      return isPrivateIpV4Bytes(parsedV4[0], parsedV4[1], parsedV4[2], parsedV4[3]);
    }
    return true;
  }
  // Unique Local Address fc00::/7 (fc00:: - fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
  // Link-Local fe80::/10 (fe80:: - febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
  return false;
}

function normalizeHostname(raw: string): string {
  let h = raw.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  // 去尾点规范化（RFC 允许的 FQDN 尾点，如 localhost. 应同样拦截）
  h = h.replace(/\.+$/, "");
  return h;
}

function isWhitelisted(parsed: URL, hostnameNormalized: string): boolean {
  const allowHostsStr = process.env.AI_GATEWAY_ALLOW_HOSTS || "";
  if (!allowHostsStr.trim()) return false;
  const allowedList = allowHostsStr
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/\.+$/, ""))
    .filter(Boolean);
  const targetHost = parsed.host.toLowerCase().replace(/\.+$/, "");
  if (allowedList.includes(targetHost) || allowedList.includes(hostnameNormalized)) {
    console.log(`[AI Gateway] SSRF whitelist matched, allowing internal host: ${targetHost}`);
    return true;
  }
  return false;
}

export function assertSafeHttpUrl(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("非法 URL 格式");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("仅支持 HTTP/HTTPS 协议");
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (isWhitelisted(parsed, hostname)) return;

  // Reject local domain names
  if (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".onion")
  ) {
    throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection)");
  }

  // Check using inet_aton normalization (covers single-integer, 2-part, 3-part, 4-part, hex, octal, and mixed)
  const atonBytes = parseInetAton(hostname);
  if (atonBytes) {
    if (isPrivateIpV4Bytes(atonBytes[0], atonBytes[1], atonBytes[2], atonBytes[3])) {
      throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection)");
    }
  }

  // Check IPv6
  if (net.isIPv6(hostname) || hostname.includes(":")) {
    if (isPrivateIpV6(hostname)) {
      throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection)");
    }
  }
}

export async function assertSafeHttpUrlWithDns(urlString: string): Promise<void> {
  // 先做同步字面量检查（含白名单与尾点）
  assertSafeHttpUrl(urlString);
  const parsed = new URL(urlString);
  const hostname = normalizeHostname(parsed.hostname);
  // 若已是 IP 字面量或已被白名单放行，无需 DNS
  if (parseInetAton(hostname)) return;
  if (net.isIP(hostname)) return;
  // 白名单已在 assertSafeHttpUrl 中处理，此处二次判断避免额外 DNS
  if (isWhitelisted(parsed, hostname)) return;
  // 对域名做 DNS 解析，逐一校验所有 A/AAAA 记录 — 失败一律拒绝（fail-closed）
  let results: dns.LookupAddress[];
  try {
    results = await dns.promises.lookup(hostname, { all: true, verbatim: true }) as dns.LookupAddress[];
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("禁止访问内部网络地址")) throw e;
    const code = (e as NodeJS.ErrnoException)?.code || "";
    throw new Error(`DNS 解析失败拒绝访问 (${code || (e instanceof Error ? e.message : String(e))})`);
  }
  for (const r of results) {
    const addr = r.address;
    if (r.family === 4) {
      const b = parseInetAton(addr);
      if (b && isPrivateIpV4Bytes(b[0], b[1], b[2], b[3])) {
        throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection - DNS)");
      }
      if (!b && net.isIPv4(addr)) {
        const parts = addr.split(".").map(Number);
        if (parts.length === 4 && isPrivateIpV4Bytes(parts[0], parts[1], parts[2], parts[3])) {
          throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection - DNS)");
        }
      }
    } else if (r.family === 6) {
      if (isPrivateIpV6(addr)) {
        throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection - DNS)");
      }
    }
  }
}

/**
 * 内部：解析并校验 DNS，返回已验证的 IP 列表。失败 fail-closed。
 * 供出网连接器绑定到实际连接时复用，避免二次解析绕过（DNS rebinding）。
 *
 * allowPrivateWhenAllowListed：仅供"必须命中 AI_GATEWAY_ALLOW_HOSTS 白名单"的运维
 * 连通性测试使用 —— 白名单只豁免普通私网段，**永远不豁免链路本地/云元数据段**
 * （169.254.0.0/16），否则把域名指向 169.254.169.254 即可借白名单绕过。
 */
async function resolveAndValidateDns(
  urlString: string,
  opts?: { allowPrivateWhenAllowListed?: boolean },
): Promise<dns.LookupAddress[] | null> {
  // 同步字面量检查已在外层做
  const parsed = new URL(urlString);
  const hostname = normalizeHostname(parsed.hostname);
  if (parseInetAton(hostname)) return null;
  if (net.isIP(hostname)) return null;
  const allowListed = isWhitelisted(parsed, hostname);
  if (allowListed && !opts?.allowPrivateWhenAllowListed) return null;
  // 复用 assert 的校验但返回地址
  let results: dns.LookupAddress[];
  try {
    results = await dns.promises.lookup(hostname, { all: true, verbatim: true }) as dns.LookupAddress[];
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("禁止访问内部网络地址")) throw e;
    const code = (e as NodeJS.ErrnoException)?.code || "";
    throw new Error(`DNS 解析失败拒绝访问 (${code || (e instanceof Error ? e.message : String(e))})`);
  }
  const allowPrivate = Boolean(allowListed && opts?.allowPrivateWhenAllowListed);
  for (const r of results) {
    const addr = r.address;
    if (r.family === 4) {
      const b = parseInetAton(addr);
      const bytes = b ?? (net.isIPv4(addr) ? addr.split(".").map(Number) : null);
      if (bytes && bytes.length === 4 && isPrivateIpV4Bytes(bytes[0], bytes[1], bytes[2], bytes[3])) {
        if (allowPrivate && !isLinkLocalOrMetadataV4(bytes[0], bytes[1])) continue;
        throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection - DNS)");
      }
    } else if (r.family === 6) {
      if (isPrivateIpV6(addr)) {
        if (allowPrivate && !isLinkLocalOrMetadataV6(addr)) continue;
        throw new Error("禁止访问内部网络地址或回环地址 (SSRF Protection - DNS)");
      }
    }
  }
  return results;
}

/** 链路本地 / 云元数据段（169.254.0.0/16、fe80::/10）：任何白名单都不得豁免 */
function isLinkLocalOrMetadataV4(b0: number, b1: number): boolean {
  return b0 === 169 && b1 === 254;
}

function isLinkLocalOrMetadataV6(addr: string): boolean {
  return /^f[89ab][0-9a-f]:/i.test(addr.toLowerCase());
}

export interface SafeFetchBytesResult {
  ok: boolean;
  status: number;
  statusText: string;
  bytes: Buffer;
  finalUrl: string;
}

type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** true：任何 3xx 都直接判失败，绝不跟随（凭据不得随跳转外泄） */
  followRedirects?: boolean;
  /** true：每一跳的目标主机都必须命中 AI_GATEWAY_ALLOW_HOSTS（运维连通性测试用） */
  requireAllowListedHost?: boolean;
  /** false：非 2xx 不读响应体直接返回（调用方只需状态码；避免为报错文案消耗带宽/时间） */
  readErrorBody?: boolean;
};

/**
 * 通用 SSRF 安全出网连接器（唯一出网实现）：
 * 同步字面量校验 → DNS 解析并逐一校验全部 A/AAAA → 把**已验证 IP** 绑定进 undici
 * dispatcher 让实际连接不再二次解析 → 重定向逐跳重新校验（LLM 场景直接不跟随）
 * → 总 deadline 覆盖到响应体读完 → 流式字节上限熔断。
 *
 * 合同 PDF 拉取（fetchSafeBufferWithSsrf）与 LLM 出网（callLlmGatewayService /
 * testLlmConnectivityService）共用本实现，避免"只有一处做了 DNS 绑定校验"的
 * 安全缺口随新调用点扩散。
 */
async function ssrfFetchBytes(
  initialUrl: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts?: SafeFetchOptions,
): Promise<SafeFetchBytesResult> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const maxBytes = opts?.maxBytes ?? 20 * 1024 * 1024;
  const maxRedirects = opts?.maxRedirects ?? 3;
  const followRedirects = opts?.followRedirects ?? true;
  const requireAllowListedHost = opts?.requireAllowListedHost ?? false;
  const readErrorBody = opts?.readErrorBody ?? true;
  let currentUrl = initialUrl;

  // 全程 deadline：覆盖解析、重定向、响应体完整读取；流结束或异常后才清理
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  let timedOut = false;
  const timeoutError = new Error(`请求超时 ${timeoutMs}ms`);
  timer = setTimeout(() => {
    timedOut = true;
    try { controller.abort(timeoutError); } catch {}
  }, timeoutMs);

  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // 同步字面量检查 + DNS 校验（fail-closed）。若为域名则同时取得已验证 IP 以便绑定连接
      assertSafeHttpUrl(currentUrl);
      if (requireAllowListedHost) assertHostAllowListed(currentUrl);
      const validated = await resolveAndValidateDns(currentUrl, { allowPrivateWhenAllowListed: requireAllowListedHost });

      // 为本跳构造仅返回已验证 IP 的 dispatcher，避免二次解析重绑定到内网
      let dispatcher: unknown = undefined;
      let agentToClose: { close: () => Promise<void> } | null = null;
      if (validated && validated.length > 0) {
        const parsedForDispatcher = new URL(currentUrl);
        const targetHost = normalizeHostname(parsedForDispatcher.hostname);
        const { Agent } = await import("undici");
        const agent = new Agent({
          connect: {
            lookup: (hostname: string, _opts: unknown, cb: (err: Error | null, address?: string, family?: number) => void) => {
              const normalized = hostname.toLowerCase().replace(/\.+$/, "");
              if (normalized === targetHost) {
                const first = validated[0] as dns.LookupAddress;
                cb(null, first.address, first.family as 4 | 6);
                return;
              }
              // 其它主机不应出现，仍走系统 DNS（不会被 SSRF 利用）
              (dns.lookup as unknown as (h: string, o: unknown, c: (e: Error | null, a?: string, f?: number) => void) => void)(hostname, _opts, cb);
            },
          },
        } as unknown as ConstructorParameters<typeof Agent>[0]);
        dispatcher = agent;
        agentToClose = agent as unknown as { close: () => Promise<void> };
      }

      let resp: Response;
      try {
        resp = await fetch(currentUrl, {
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body,
          signal: controller.signal,
          redirect: "manual",
          dispatcher,
        } as unknown as RequestInit);
      } catch (e) {
        if (agentToClose) { try { await agentToClose.close(); } catch {} }
        if (timedOut || (e instanceof Error && (e.name === "AbortError" || e.message.includes("请求超时")))) {
          throw new Error(`请求超时 ${timeoutMs}ms`);
        }
        throw e;
      }

      // 重定向需关闭本跳 agent 再进入下一跳；仍在同一 deadline 内
      if (resp.status >= 300 && resp.status < 400) {
        if (agentToClose) { try { await agentToClose.close(); } catch {} }
        const loc = resp.headers.get("location");
        if (!loc) throw new Error(`重定向响应缺少 Location 头（${resp.status}）`);
        if (!followRedirects) {
          // 不跟随：凭据（Authorization: Bearer）绝不能被 3xx 带到另一个目标
          throw new Error(`目标返回重定向(${resp.status})，出于凭据安全已拒绝跟随`);
        }
        if (hop === maxRedirects) throw new Error("重定向次数超过上限");
        try {
          currentUrl = new URL(loc, currentUrl).toString();
        } catch {
          throw new Error("重定向 Location 非法 URL");
        }
        continue;
      }

      const contentLength = resp.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxBytes) {
        if (agentToClose) { try { await agentToClose.close(); } catch {} }
        throw new Error("文件大小超过 20MB 上限");
      }

      // 调用方只关心状态码时（如 PDF 下载），非 2xx 不必读完整个错误响应体
      if (!resp.ok && !readErrorBody) {
        if (agentToClose) { try { await agentToClose.close(); } catch {} }
        return { ok: false, status: resp.status, statusText: resp.statusText, bytes: Buffer.alloc(0), finalUrl: currentUrl };
      }

      if (!resp.body) {
        try {
          const buf = Buffer.from(await resp.arrayBuffer());
          if (buf.byteLength > maxBytes) throw new Error("文件大小超过 20MB 上限");
          if (agentToClose) { try { await agentToClose.close(); } catch {} }
          return { ok: resp.ok, status: resp.status, statusText: resp.statusText, bytes: buf, finalUrl: currentUrl };
        } catch (e) {
          if (agentToClose) { try { await agentToClose.close(); } catch {} }
          if (timedOut || (e instanceof DOMException && e.name === "AbortError") || (e instanceof Error && e.message.includes("请求超时"))) {
            throw new Error(`请求超时 ${timeoutMs}ms`);
          }
          throw e;
        }
      }

      const reader = resp.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          let readRes: ReadableStreamReadResult<Uint8Array>;
          try {
            readRes = await reader.read();
          } catch (e) {
            if (timedOut || controller.signal.aborted) throw new Error(`请求超时 ${timeoutMs}ms`);
            throw e;
          }
          if (controller.signal.aborted || timedOut) {
            try { await reader.cancel(); } catch {}
            throw new Error(`请求超时 ${timeoutMs}ms`);
          }
          const { done, value } = readRes;
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              try { await reader.cancel(); } catch {}
              throw new Error("文件大小超过 20MB 上限（流式截断）");
            }
            chunks.push(value);
          }
        }
      } finally {
        if (agentToClose) { try { await agentToClose.close(); } catch {} }
      }

      if (timedOut || controller.signal.aborted) throw new Error(`请求超时 ${timeoutMs}ms`);

      const result = Buffer.allocUnsafe(total);
      let offset = 0;
      for (const c of chunks) {
        result.set(c, offset);
        offset += c.byteLength;
      }
      return { ok: resp.ok, status: resp.status, statusText: resp.statusText, bytes: result, finalUrl: currentUrl };
    }
    throw new Error("重定向处理异常：超出最大跳数");
  } finally {
    cleanup();
  }
}

export async function fetchSafeBufferWithSsrf(
  initialUrl: string,
  opts?: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number },
): Promise<Buffer> {
  const res = await ssrfFetchBytes(initialUrl, {}, {
    timeoutMs: opts?.timeoutMs,
    maxBytes: opts?.maxBytes,
    maxRedirects: opts?.maxRedirects,
    followRedirects: true,
    readErrorBody: false,
  });
  if (!res.ok) {
    throw new Error(`HTTP 状态码异常: ${res.status} ${res.statusText}`);
  }
  return res.bytes;
}

/**
 * LLM 出网专用：与合同 PDF 拉取同一套 SSRF 安全连接器（DNS 校验 + IP 绑定 +
 * 禁止跟随重定向 + 总 deadline 覆盖响应体），但**不跟随重定向**且对非 2xx
 * 不抛异常（由调用方转成降级结果）。响应体在 deadline 内读完整，避免流式响应
 * 被截断成半个 JSON。
 */
export async function safeFetchTextWithSsrf(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  opts?: SafeFetchOptions,
): Promise<{ ok: boolean; status: number; statusText: string; text: string; finalUrl: string }> {
  const res = await ssrfFetchBytes(url, init, {
    timeoutMs: opts?.timeoutMs,
    maxBytes: opts?.maxBytes,
    maxRedirects: opts?.maxRedirects,
    followRedirects: opts?.followRedirects ?? false,
    requireAllowListedHost: opts?.requireAllowListedHost,
  });
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    text: res.bytes.toString("utf8"),
    finalUrl: res.finalUrl,
  };
}

/** 目标主机（host:port）是否命中 AI_GATEWAY_ALLOW_HOSTS 白名单 */
export function hostInAllowList(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isWhitelisted(parsed, normalizeHostname(parsed.hostname));
}

/** 强制目标主机命中白名单：管理员显式连通性测试的出网前置条件 */
export function assertHostAllowListed(url: string): void {
  if (!hostInAllowList(url)) {
    const host = (() => { try { return new URL(url).host; } catch { return "unknown"; } })();
    throw new Error(`目标主机 ${host} 不在 AI_GATEWAY_ALLOW_HOSTS 白名单内，已阻断外发`);
  }
}

/**
 * 标准化各厂商的 Chat Completions API 地址
 */
export function resolveProviderEndpoint(
  provider: string,
  customEndpoint?: string | null,
): string {
  if (customEndpoint && customEndpoint.trim()) {
    const raw = customEndpoint.trim();
    assertSafeHttpUrl(raw);
    const ep = raw.replace(/\/+$/, "");
    if (ep.endsWith("/chat/completions")) return ep;
    return `${ep}/chat/completions`;
  }

  switch (provider) {
    case "DEEPSEEK":
      return "https://api.deepseek.com/v1/chat/completions";
    case "OPENAI":
      return "https://api.openai.com/v1/chat/completions";
    case "ZHIPU":
      return "https://open.bigmodel.cn/api/paas/v4/chat/completions";
    case "QWEN":
      return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    case "GEMINI":
      return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    default:
      return "https://api.deepseek.com/v1/chat/completions";
  }
}

/**
 * 获取租户大模型网关配置与自定义提示词策略 (短事务，快速读取并释放数据库连接)
 */
export async function getTenantLlmContext(
  ctx: TenantContext,
  scene?: string,
): Promise<{
  config: LlmGatewayConfig;
  customPromptTemplate?: {
    systemPrompt: string;
    userPromptTemplate: string;
  };
}> {
  return withTenant(ctx.tenantId, async (tx) => {
    // 1. 读取大模型供应商凭证与开关
    const cfgRes = await tx.execute<{
      is_ai_copilot_enabled: boolean;
      ai_provider: string;
      ai_api_key: string | null;
      ai_api_endpoint: string | null;
      ai_model_name: string;
      ai_temperature: string | number;
    }>(sql`
      select
        coalesce(is_ai_copilot_enabled, false) as is_ai_copilot_enabled,
        coalesce(ai_provider, 'BUILTIN') as ai_provider,
        ai_api_key,
        ai_api_endpoint,
        coalesce(ai_model_name, 'deepseek-chat') as ai_model_name,
        coalesce(ai_temperature, '0.30') as ai_temperature
      from security_compliance_configs
      where tenant_id = ${ctx.tenantId}::uuid
      limit 1
    `);

    const row = cfgRes.rows[0];
    const config: LlmGatewayConfig = {
      isEnabled: row?.is_ai_copilot_enabled ?? false,
      provider: (row?.ai_provider as LlmGatewayConfig["provider"]) || "BUILTIN",
      apiKey: decryptSecret(row?.ai_api_key) || null,
      apiEndpoint: row?.ai_api_endpoint || null,
      modelName: row?.ai_model_name || "deepseek-chat",
      temperature: Number(row?.ai_temperature) || 0.3,
    };

    // 2. 读取该场景在 AI 智能体中心配置的自定义提示词
    let customPromptTemplate: { systemPrompt: string; userPromptTemplate: string } | undefined;
    if (scene) {
      const promptRes = await tx.execute<{
        system_prompt: string;
        user_prompt_template: string;
      }>(sql`
        select system_prompt, user_prompt_template
        from ai_prompt_templates
        where tenant_id = ${ctx.tenantId}::uuid and scene = ${scene} and is_active = true
        limit 1
      `);
      if (promptRes.rows[0]) {
        customPromptTemplate = {
          systemPrompt: promptRes.rows[0].system_prompt,
          userPromptTemplate: promptRes.rows[0].user_prompt_template,
        };
      }
    }

    return { config, customPromptTemplate };
  });
}

/**
 * 统一大模型网络请求调用 (OpenAI Compatible API)
 * 注意：此函数在数据库事务外部执行网络 I/O，绝不阻塞数据库连接池
 */
export async function callLlmGatewayService<T = unknown>(
  ctx: TenantContext,
  params: CallLlmParams,
): Promise<LlmResponseResult<T>> {
  const { config, customPromptTemplate } = await getTenantLlmContext(ctx, params.scene);

  // F08: AI 总开关 fail-closed — isEnabled=false 时直接降级，零外部请求
  if (!config.isEnabled) {
    return {
      rawText: params.fallbackContent || "",
      data: params.fallbackContent ? extractJsonFromText<T>(params.fallbackContent) : null,
      isRealLlm: false,
      provider: config.provider || "BUILTIN",
      modelName: "ai-disabled",
    };
  }

  const isConfigured =
    config.apiKey &&
    config.apiKey.trim().length > 0 &&
    config.provider !== "BUILTIN";

  // 如果未配置 API Key，直接返回非真实模型状态供业务层兜底
  if (!isConfigured) {
    return {
      rawText: params.fallbackContent || "",
      data: params.fallbackContent ? extractJsonFromText<T>(params.fallbackContent) : null,
      isRealLlm: false,
      provider: "BUILTIN",
      modelName: "builtin-rules",
    };
  }

  const endpointUrl = resolveProviderEndpoint(config.provider, config.apiEndpoint);
  const systemPrompt =
    customPromptTemplate?.systemPrompt ||
    params.systemPrompt ||
    "你是一名专业、严谨的 B2B 销售实战教练与 CRM 顾问，请根据真实业务数据给出客观、精准、可直接落地的指导建议。必须输出标准合法的 JSON 格式。";
  // 把 user_prompt_template 真正接线进 payload（占位符替换），不再死配置
  let effectiveUserPrompt = params.userPrompt || "";
  if (customPromptTemplate?.userPromptTemplate) {
    const tpl = customPromptTemplate.userPromptTemplate;
    const placeholders = ["{{userPrompt}}", "{{user_prompt}}", "{{prompt}}", "{{input}}", "{{content}}", "{{question}}", "{userPrompt}", "{user_prompt}", "{prompt}", "{input}", "{content}", "{question}", "{{user_prompt_template}}"];
    let rendered = tpl;
    let replaced = false;
    for (const ph of placeholders) {
      if (rendered.includes(ph)) {
        rendered = rendered.split(ph).join(params.userPrompt || "");
        replaced = true;
      }
    }
    // 支持模板内 {变量} 占位符：若模板包含 {xxx} 但无上述已知占位符，视为包裹模板，直接拼接原始输入
    if (!replaced) {
      if (tpl.includes("{") && tpl.includes("}")) {
        // 将原始 userPrompt 追加到模板后，避免信息丢失
        rendered = `${tpl}\n\n${params.userPrompt || ""}`;
        replaced = true;
      } else {
        rendered = tpl;
        replaced = true;
      }
    }
    if (replaced) effectiveUserPrompt = rendered;
  }
  const temperature = params.temperature ?? config.temperature ?? 0.3;

    const startTime = Date.now();
    // 场景超时语义保留：AGENT_HARNESS 180s（多轮复杂推理），其余 60s。
    // 关键变化：出网改走 SSRF 安全连接器 —— DNS 解析+全部地址校验+已验证 IP 绑定
    // 实际连接+禁止跟随重定向，且总 deadline 覆盖到响应体读完（流式/长响应不会半截）。
    const timeoutMs = params.scene === "AGENT_HARNESS" ? 180000 : 60000;

    try {
      let messages = params.messages || [];
      if (messages.length === 0) {
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: effectiveUserPrompt },
        ];
      }
    
      const payload: Record<string, unknown> = {
        model: config.modelName || "deepseek-chat",
        temperature,
        messages,
      };
      if (params.tools && params.tools.length > 0) {
        payload.tools = params.tools;
        if (params.tool_choice) {
          payload.tool_choice = params.tool_choice;
        }
      }

      const response = await safeFetchTextWithSsrf(
        endpointUrl,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey!.trim()}`,
          },
          body: JSON.stringify(payload),
        },
        { timeoutMs, maxBytes: 20 * 1024 * 1024, followRedirects: false },
      );

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = response.text;
        console.warn(`[AI Gateway] Provider ${config.provider} returned HTTP ${response.status}: ${errorText}`);
        return {
          rawText: params.fallbackContent || "",
          data: params.fallbackContent ? extractJsonFromText<T>(params.fallbackContent) : null,
          isRealLlm: false,
          provider: config.provider,
          modelName: config.modelName,
          latencyMs,
          error: `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        };
      }

      let json: {
        choices?: Array<{ message?: { content?: string; tool_calls?: LlmToolCall[] } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      try {
        json = JSON.parse(response.text);
      } catch {
        return {
          rawText: params.fallbackContent || "",
          data: params.fallbackContent ? extractJsonFromText<T>(params.fallbackContent) : null,
          isRealLlm: false,
          provider: config.provider,
          modelName: config.modelName,
          latencyMs,
          error: "模型响应不是合法 JSON",
        };
      }
      const content = json.choices?.[0]?.message?.content || "";

    const tool_calls = json.choices?.[0]?.message?.tool_calls;
    const parsedData = content ? extractJsonFromText<T>(content) : null;

    let usage: LlmTokenUsage | undefined;
    if (json.usage && typeof json.usage === "object") {
      usage = {
        promptTokens: typeof json.usage.prompt_tokens === "number" ? json.usage.prompt_tokens : undefined,
        completionTokens: typeof json.usage.completion_tokens === "number" ? json.usage.completion_tokens : undefined,
        totalTokens: typeof json.usage.total_tokens === "number" ? json.usage.total_tokens : undefined,
        promptCacheHitTokens:
          typeof json.usage.prompt_cache_hit_tokens === "number"
            ? json.usage.prompt_cache_hit_tokens
            : typeof json.usage.prompt_tokens_details?.cached_tokens === "number"
              ? json.usage.prompt_tokens_details.cached_tokens
              : undefined,
      };
    }

    return {
      rawText: content,
      data: parsedData,
      isRealLlm: true,
      provider: config.provider,
      modelName: config.modelName,
      latencyMs,
      tool_calls,
      usage,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[AI Gateway] Error calling LLM: ${errMsg}`);
    return {
      rawText: params.fallbackContent || "",
      data: params.fallbackContent ? extractJsonFromText<T>(params.fallbackContent) : null,
      isRealLlm: false,
      provider: config.provider,
      modelName: config.modelName,
      latencyMs,
      error: errMsg || "网络请求异常",
    };
  }
}

/**
 * 实时连通性测试服务：用于在后台测试已配置的 API Key 与 Endpoint。
 *
 * 边界选择（Wave12 安全收口）：
 * 1. **走 SSRF 安全连接器**：字面量校验 → DNS 解析并校验全部 A/AAAA → 已验证 IP
 *    绑定实际连接 → 不跟随重定向（Bearer Key 不得随 3xx 外泄）→ 总 deadline 覆盖
 *    响应体。租户把 ai_api_endpoint 指向"先解析公网、后解析 169.254.169.254"的
 *    rebinding 域名无法再把 API Key 与业务数据打进内网。
 * 2. **必须命中 AI_GATEWAY_ALLOW_HOSTS 白名单**：这是运维显式测试入口，允许指向
 *    自建的私有模型网关，但只放行管理员自己登记过的 host:port；未登记则**零外发**。
 *    白名单仅豁免普通私网段，链路本地/云元数据段（169.254.0.0/16、fe80::/10）
 *    永不可豁免。
 * 3. **AI 总开关例外保留但必须留痕**：合规关闭 AI 外呼的租户，管理员仍需验证
 *    密钥有效性（否则无法判断"该开而未开"还是"密钥失效"）；但每一次尝试都写
 *    audit_logs（action = ai.connectivity_test，含 AI 开关状态与目标主机），
 *    使"AI 已关闭却发生外呼"事后可追溯。
 */
export async function testLlmConnectivityService(
  ctx: TenantContext,
  testConfig: {
    provider: string;
    apiKey: string;
    apiEndpoint?: string | null;
    modelName?: string;
  },
): Promise<{
  success: boolean;
  latencyMs: number;
  model: string;
  responsePreview: string;
  errorMessage?: string;
  /** 目标主机是否命中 AI_GATEWAY_ALLOW_HOSTS（未命中即零外发） */
  allowListMatched: boolean;
  /** 租户 AI 总开关状态：false 表示"AI 已关闭下仍发生了显式外呼"，审计据此留痕 */
  aiCopilotEnabled: boolean;
}> {
  const { config: tenantCfg } = await getTenantLlmContext(ctx);
  const aiCopilotEnabled = Boolean(tenantCfg.isEnabled);

  const audit = async (detail: Record<string, unknown>) => {
    try {
      await withTenant(ctx.tenantId, async (tx) => {
        await tx.execute(sql`
          insert into audit_logs (tenant_id, actor_user_id, action, subject_type, subject_id, detail)
          values (${ctx.tenantId}, ${ctx.userId}, 'ai.connectivity_test', 'user', ${ctx.userId}, ${JSON.stringify(detail)}::jsonb)
        `);
      });
    } catch (e: unknown) {
      console.error(`[AI Gateway] 连通性测试审计写入失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (!testConfig.apiKey || !testConfig.apiKey.trim()) {
    return {
      success: false,
      latencyMs: 0,
      model: testConfig.modelName || "unknown",
      responsePreview: "",
      errorMessage: "请输入 API Key",
      allowListMatched: false,
      aiCopilotEnabled,
    };
  }

  // 端点解析（内网/非法 URL 会在此同步拒绝）也要走结构化返回 + 审计，
  // 否则管理员会拿到未捕获异常而不是可读的阻断原因
  let endpointUrl: string;
  try {
    endpointUrl = resolveProviderEndpoint(testConfig.provider, testConfig.apiEndpoint);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : "端点地址非法";
    await audit({
      provider: testConfig.provider,
      model: testConfig.modelName || null,
      targetHost: "invalid-endpoint",
      allowListMatched: false,
      aiCopilotEnabled,
      success: false,
      errorMessage: errMsg,
      latencyMs: 0,
    });
    return {
      success: false,
      latencyMs: 0,
      model: testConfig.modelName || "unknown",
      responsePreview: "",
      errorMessage: errMsg,
      allowListMatched: false,
      aiCopilotEnabled,
    };
  }

  const targetHost = (() => { try { return new URL(endpointUrl).host; } catch { return "unknown"; } })();
  const allowListMatched = hostInAllowList(endpointUrl);
  const startTime = Date.now();

  if (!allowListMatched) {
    await audit({
      provider: testConfig.provider,
      model: testConfig.modelName || null,
      targetHost,
      allowListMatched: false,
      aiCopilotEnabled,
      success: false,
      errorMessage: "NOT_IN_ALLOW_LIST",
      latencyMs: 0,
    });
    return {
      success: false,
      latencyMs: 0,
      model: testConfig.modelName || "unknown",
      responsePreview: "",
      errorMessage: `目标主机 ${targetHost} 不在 AI_GATEWAY_ALLOW_HOSTS 白名单内，已阻断外发（白名单登记后才可测试）`,
      allowListMatched: false,
      aiCopilotEnabled,
    };
  }

  try {
    const response = await safeFetchTextWithSsrf(
      endpointUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testConfig.apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: testConfig.modelName || "deepseek-chat",
          temperature: 0.1,
          messages: [
            { role: "system", content: "You are a connectivity test assistant." },
            { role: "user", content: "Respond only with: 'AI_GATEWAY_ONLINE'" },
          ],
        }),
      },
      { timeoutMs: 12000, maxBytes: 4 * 1024 * 1024, followRedirects: false, requireAllowListedHost: true },
    );

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const errText = response.text;
      await audit({
        provider: testConfig.provider,
        model: testConfig.modelName || null,
        targetHost,
        allowListMatched: true,
        aiCopilotEnabled,
        success: false,
        errorMessage: `HTTP ${response.status}`,
        latencyMs,
      });
      return {
        success: false,
        latencyMs,
        model: testConfig.modelName || "unknown",
        responsePreview: "",
        errorMessage: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
        allowListMatched: true,
        aiCopilotEnabled,
      };
    }

    const json = JSON.parse(response.text);
    const content = json.choices?.[0]?.message?.content || "";

    await audit({
      provider: testConfig.provider,
      model: testConfig.modelName || null,
      targetHost,
      allowListMatched: true,
      aiCopilotEnabled,
      success: true,
      latencyMs,
    });

    return {
      success: true,
      latencyMs,
      model: testConfig.modelName || "unknown",
      responsePreview: content.trim(),
      allowListMatched: true,
      aiCopilotEnabled,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : "网络请求超时或连接失败";
    await audit({
      provider: testConfig.provider,
      model: testConfig.modelName || null,
      targetHost,
      allowListMatched: true,
      aiCopilotEnabled,
      success: false,
      errorMessage: errMsg,
      latencyMs,
    });
    return {
      success: false,
      latencyMs,
      model: testConfig.modelName || "unknown",
      responsePreview: "",
      errorMessage: errMsg,
      allowListMatched: true,
      aiCopilotEnabled,
    };
  }
}
