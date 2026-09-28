/**
 * 调度器健康检查：读取心跳文件，判断最近一轮任务是否在预期时间内成功。
 *
 * 为什么不用 `ps aux | grep node`：
 *   该判据只能证明「进程存在」。进程活着但每轮任务都失败（应用未就绪、
 *   密钥不匹配、接口报错）时，它会继续报健康 —— 而这恰恰是最需要被告警的
 *   状态：公海回收、超时提醒、AI 巡检全部静默失效，没有任何外部信号。
 *
 * 判据：心跳文件存在且时间戳在容忍窗口内。
 *   容忍窗口 = 2 × 调度间隔 + 60 秒缓冲（允许一轮抖动与一次调用超时）。
 *
 * 环境变量：
 *   CRON_HEARTBEAT_FILE    心跳文件路径（与调度器保持一致）
 *   CRON_INTERVAL_MINUTES  调度间隔（分钟）
 *
 * 退出码：0 = 健康；1 = 不健康（附原因到 stderr，便于 docker logs 排查）
 */
import { readFileSync } from "node:fs";

const HEARTBEAT_FILE = process.env.CRON_HEARTBEAT_FILE ?? "/tmp/cron-last-success";
const INTERVAL_MINUTES = Number(process.env.CRON_INTERVAL_MINUTES ?? 5);

if (!Number.isFinite(INTERVAL_MINUTES) || INTERVAL_MINUTES < 1) {
  console.error(`[cron-health] CRON_INTERVAL_MINUTES 无效：${process.env.CRON_INTERVAL_MINUTES}`);
  process.exit(1);
}

// 容忍窗口：两轮间隔 + 60 秒，避免因单轮抖动误判
const TOLERANCE_SECONDS = INTERVAL_MINUTES * 60 * 2 + 60;

let raw: string;
try {
  raw = readFileSync(HEARTBEAT_FILE, "utf8").trim();
} catch {
  console.error(
    `[cron-health] 未找到心跳文件 ${HEARTBEAT_FILE}。` +
    `调度器可能尚未完成首轮（启动后正常会在 ${INTERVAL_MINUTES} 分钟内出现），` +
    `或容器内该路径不可写。`,
  );
  process.exit(1);
}

const lastSuccess = Number(raw);
if (!Number.isFinite(lastSuccess) || lastSuccess <= 0) {
  console.error(`[cron-health] 心跳内容无法解析：${JSON.stringify(raw)}`);
  process.exit(1);
}

const ageSeconds = Math.floor(Date.now() / 1000) - lastSuccess;
if (ageSeconds > TOLERANCE_SECONDS) {
  console.error(
    `[cron-health] 心跳已过期：距上次全部任务成功 ${ageSeconds} 秒，` +
    `容忍上限 ${TOLERANCE_SECONDS} 秒。最近一轮有任务失败或调度器卡住，` +
    `请检查调度器日志（docker compose logs cron）。`,
  );
  process.exit(1);
}

console.log(`[cron-health] 健康：距上次全部任务成功 ${ageSeconds} 秒（容忍上限 ${TOLERANCE_SECONDS} 秒）`);
