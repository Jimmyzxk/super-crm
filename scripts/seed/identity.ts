import crypto from "node:crypto";

export const SEED_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const SEED_UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"; // 固定命名空间 (RFC 4122 DNS)
export const SEED_ADVISORY_LOCK_ID = "8472910482910482";
export const SEED_BASE_DATE = new Date("2026-09-01T08:00:00.000Z");

/**
 * 确定性 UUID v5 纯函数：无任何 I/O 副作用，可安全被单元测试导入。
 */
export function deterministicUuidV5(entity: string, seq: number | string, tenantId = SEED_TENANT_ID): string {
  const name = `${tenantId}:${entity}:${seq}`;
  const nsBuffer = Buffer.from(SEED_UUID_NAMESPACE.replace(/-/g, ""), "hex");
  const nameBuffer = Buffer.from(name, "utf8");
  const hash = crypto.createHash("sha1").update(Buffer.concat([nsBuffer, nameBuffer])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = hash.toString("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class DeterministicRNG {
  private s: number;
  constructor(seed = 20260901) {
    this.s = seed;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: readonly T[] | T[]): T {
    return arr[this.nextInt(0, arr.length - 1)];
  }
  shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
