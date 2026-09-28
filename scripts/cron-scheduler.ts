/**
 * 内置定时调度器：驱动系统的三个「到点动作」
 *   1. /api/cron/scan-tasks          → 任务超时通知 + 销售洞察扫描
 *   2. /api/cron/recycle-public-pools → 公海自动回收
 *
 * 为什么需要它：这些动作只会在被 POST 时执行，此前仓库里没有任何
 * 调度配置，导致「自动回收 / 超时提醒」上线即静默失效。
 *
 * 用法：
 *   pnpm cron                        # 常驻，默认每 5 分钟一轮
 *   CRON_RUN_ONCE=1 pnpm cron        # 只跑一轮（冒烟验证用）
 *   CRON_INTERVAL_MINUTES=1 pnpm cron
 *
 * 生产环境可用系统 crontab / launchd / 平台定时器替代本进程，
 * 只要按时 POST 上述两个接口并带 x-cron-secret 头即可。
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE_URL = process.env.CRON_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MINUTES = Number(process.env.CRON_INTERVAL_MINUTES ?? 5);
const RUN_ONCE = process.env.CRON_RUN_ONCE === "1";

// 心跳文件：每轮结束后写入最近一次成功时间戳（epoch 秒）。
// 用途：容器 healthcheck 据其新鲜度判断「调度器是否真的在跑通任务」。
// 仅检测「有 node 进程存活」无法反映业务是否真的执行——进程活着但任务连续
// 失败同样是故障，且这种情况不会有任何外部信号。
// 写入失败不中断调度（只读文件系统等环境下降级为无心跳，healthcheck 会报
// unhealthy 并提示原因，而不是静默通过）。
const HEARTBEAT_FILE = process.env.CRON_HEARTBEAT_FILE ?? "/tmp/cron-last-success";

const ENDPOINTS = [
  "/api/cron/scan-tasks",
  "/api/cron/recycle-public-pools",
  "/api/cron/ai-daily-inspection",
] as const;

if (!SECRET) {
  console.error("[cron] 缺少 CRON_SECRET 环境变量，无法启动。请在 .env 中配置。");
  process.exit(1);
}
// process.exit 的不可达性不会收窄类型，这里显式落成 string 供下方闭包使用
const CRON_SECRET_VALUE: string = SECRET;
if (SECRET === "replace-with-a-random-secret") {
  console.warn("[cron] 警告：CRON_SECRET 仍是示例占位值，公网部署前必须换成随机值。");
}
if (!Number.isFinite(INTERVAL_MINUTES) || INTERVAL_MINUTES < 1) {
  console.error(`[cron] CRON_INTERVAL_MINUTES 无效：${process.env.CRON_INTERVAL_MINUTES}`);
  process.exit(1);
}

function writeHeartbeat(): void {
  try {
    mkdirSync(dirname(HEARTBEAT_FILE), { recursive: true });
    writeFileSync(HEARTBEAT_FILE, String(Math.floor(Date.now() / 1000)), "utf8");
  } catch (error) {
    console.error(`[cron] 心跳写入失败（${HEARTBEAT_FILE}）：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

async function tick(): Promise<void> {
  const startedAt = Date.now();
  let failed = 0;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "x-cron-secret": CRON_SECRET_VALUE },
      });
      if (res.ok) {
        console.log(`[cron] ${endpoint} -> ${res.status} (${Date.now() - startedAt}ms)`);
      } else {
        failed += 1;
        const body = await res.text().catch(() => "");
        console.error(`[cron] ${endpoint} -> ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (error) {
      failed += 1;
      // 应用未启动或网络故障：记录后继续下一轮，进程不退出
      console.error(`[cron] ${endpoint} 调用失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  // 只有全部任务都成功才刷新心跳：任一任务持续失败时心跳会过期，
  // healthcheck 转为 unhealthy，运维可见而非静默降级。
  if (failed === 0) {
    writeHeartbeat();
  } else {
    console.error(`[cron] 本轮 ${failed}/${ENDPOINTS.length} 个任务失败，不刷新心跳`);
  }
}

async function main(): Promise<void> {
  console.log(`[cron] 调度器启动：${BASE_URL}，每 ${INTERVAL_MINUTES} 分钟一轮（${ENDPOINTS.length} 个任务）`);
  await tick();
  if (RUN_ONCE) {
    console.log("[cron] CRON_RUN_ONCE=1，单轮模式结束。");
    return;
  }
  setInterval(() => {
    void tick();
  }, INTERVAL_MINUTES * 60 * 1000);
}

void main();
