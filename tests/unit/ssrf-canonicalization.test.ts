import { describe, expect, it } from "vitest";
import { assertSafeHttpUrl } from "@/core/ai-gateway/client";

/**
 * SSRF 规范化对抗性单测：攻击者绕过字符串黑名单的全部经典姿势。
 * 每一条都对应一种真实绕过手法，防止未来有人把校验"简化"回正则匹配。
 */
describe("assertSafeHttpUrl 规范化对抗 (SSRF Canonicalization)", () => {
  const mustReject = (url: string, label: string) =>
    it(`拒绝 ${label} (${url})`, () => {
      expect(() => assertSafeHttpUrl(url)).toThrow();
    });
  const mustPass = (url: string, label: string) =>
    it(`放行 ${label} (${url})`, () => {
      expect(() => assertSafeHttpUrl(url)).not.toThrow();
    });

  // —— 协议白名单 ——
  mustReject("javascript:alert(1)", "javascript 伪协议");
  mustReject("JavaScript://x/%0aalert(1)", "大小写混写伪协议");
  mustReject("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "data 伪协议");
  mustReject("file:///etc/passwd", "file 协议");
  mustReject("ftp://10.0.0.1/pub", "ftp 协议");

  // —— 回环地址变体（inet_aton 自动还原） ——
  mustReject("http://127.0.0.1:8080/admin", "标准回环 IPv4");
  mustReject("http://2130706433/", "十进制整数回环");
  mustReject("http://0x7f.0.0.1/", "十六进制回环");
  mustReject("http://0x7f000001/", "十六进制压缩回环");
  mustReject("http://0177.0.0.1/", "八进制回环");
  mustReject("http://017700000001/", "八进制压缩回环");
  mustReject("http://127.1/", "两段式短格式回环");
  mustReject("http://127.0.0.1/", "三段式等价回环");
  mustReject("http://localhost:3000/", "localhost 域名");
  mustReject("http://LOCALHOST/", "大写 localhost");
  mustReject("http://[::1]:8080/", "IPv6 回环");
  mustReject("http://[0:0:0:0:0:0:0:1]/", "IPv6 回环全写");
  mustReject("http://0.0.0.0/", "未指定地址");

  // —— 私网段 ——
  mustReject("http://10.1.2.3/", "10/8 私网");
  mustReject("http://172.16.0.1/", "172.16/12 私网");
  mustReject("http://172.31.255.255/", "172.16/12 段尾");
  mustReject("http://192.168.1.1/", "192.168/16 私网");
  mustReject("http://169.254.169.254/latest/meta-data/", "云元数据端点");
  mustReject("http://[fe80::1]/", "IPv6 链路本地");
  mustReject("http://[fd00::1]/", "IPv6 私有地址");

  // —— 内部域名 ——
  mustReject("http://db.internal/", "internal 内部域");
  mustReject("http://service.corp/", "corp 内部域");
  mustReject("http://nas.lan/", "lan 内部域");

  // —— 合法外网（防误杀） ——
  mustPass("https://hooks.example.com/webhook/abc", "标准 HTTPS webhook");
  mustPass("http://93.184.216.34/callback", "公网 IPv4 HTTP");
  mustPass("https://api.deepseek.com/v1/chat/completions", "LLM 网关");
  mustPass("https://[2001:db8::1]/api", "公网 IPv6");
});

describe("AI_GATEWAY_ALLOW_HOSTS 受控白名单机制", () => {
  const originalEnv = process.env.AI_GATEWAY_ALLOW_HOSTS;

  it("当配置 host:port 白名单时，精确放行目标内网地址", () => {
    process.env.AI_GATEWAY_ALLOW_HOSTS = "192.0.2.10:8080,ai-gateway.corp:9000";
    try {
      expect(() => assertSafeHttpUrl("http://192.0.2.10:8080/v1/chat/completions")).not.toThrow();
      expect(() => assertSafeHttpUrl("http://ai-gateway.corp:9000/v1")).not.toThrow();
    } finally {
      process.env.AI_GATEWAY_ALLOW_HOSTS = originalEnv;
    }
  });

  it("当配置 IP/host 白名单时，放行该 IP/host 的请求", () => {
    process.env.AI_GATEWAY_ALLOW_HOSTS = "192.0.2.10,llm.internal";
    try {
      expect(() => assertSafeHttpUrl("http://192.0.2.10:8080/v1")).not.toThrow();
      expect(() => assertSafeHttpUrl("http://192.0.2.10/v1")).not.toThrow();
      expect(() => assertSafeHttpUrl("http://llm.internal:8000/v1")).not.toThrow();
    } finally {
      process.env.AI_GATEWAY_ALLOW_HOSTS = originalEnv;
    }
  });

  it("未在白名单中的内网地址依然被严格拦截", () => {
    process.env.AI_GATEWAY_ALLOW_HOSTS = "192.0.2.10:8080";
    try {
      // 端口不同且未单配 IP
      expect(() => assertSafeHttpUrl("http://192.0.2.10:9000/v1")).toThrow("禁止访问内部网络地址或回环地址");
      // 不同内网 IP
      expect(() => assertSafeHttpUrl("http://192.0.2.11:8080/v1")).toThrow("禁止访问内部网络地址或回环地址");
      // 其他私网网段
      expect(() => assertSafeHttpUrl("http://192.168.1.1/v1")).toThrow("禁止访问内部网络地址或回环地址");
    } finally {
      process.env.AI_GATEWAY_ALLOW_HOSTS = originalEnv;
    }
  });

  it("合法公网端点在配置白名单后依然不受影响正常放行", () => {
    process.env.AI_GATEWAY_ALLOW_HOSTS = "192.0.2.10:8080";
    try {
      expect(() => assertSafeHttpUrl("https://api.deepseek.com/v1/chat/completions")).not.toThrow();
      expect(() => assertSafeHttpUrl("https://api.openai.com/v1")).not.toThrow();
    } finally {
      process.env.AI_GATEWAY_ALLOW_HOSTS = originalEnv;
    }
  });

  it("非法协议即使命中白名单 host 依然被拒绝", () => {
    process.env.AI_GATEWAY_ALLOW_HOSTS = "192.0.2.10:8080";
    try {
      expect(() => assertSafeHttpUrl("ftp://192.0.2.10:8080/v1")).toThrow("仅支持 HTTP/HTTPS 协议");
    } finally {
      process.env.AI_GATEWAY_ALLOW_HOSTS = originalEnv;
    }
  });
});

