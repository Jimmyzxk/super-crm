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

const BASE_URL = process.env.CRON_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;
const INTERVAL_MINUTES = Number(process.env.CRON_INTERVAL_MINUTES ?? 5);
const RUN_ONCE = process.env.CRON_RUN_ONCE === "1";

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

async function tick(): Promise<void> {
  const startedAt = Date.now();
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "x-cron-secret": CRON_SECRET_VALUE },
      });
      if (res.ok) {
        console.log(`[cron] ${endpoint} -> ${res.status} (${Date.now() - startedAt}ms)`);
      } else {
        const body = await res.text().catch(() => "");
        console.error(`[cron] ${endpoint} -> ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (error) {
      // 应用未启动或网络故障：记录后继续下一轮，进程不退出
      console.error(`[cron] ${endpoint} 调用失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
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
