#!/bin/bash
# CRM 数据库备份（仓库正本，手动执行版；备份落仓库 backups/）
#
# 与 cron 副本（部署在 $HOME/bin/crm-backup.sh）行为对齐：
#   - 相同的补跑守卫、相同的临时文件 + gzip -t 校验 + 原子更名
#   - 相同的失败告警三件套：[ALERT] 日志行 + ~/crm-backup-alert.txt + 限时系统通知
#   - 相同的恢复语义：此前处于告警状态时补发"已恢复"通知并删除 alert 文件
#   - 相同的离机镜像：拷到 CRM_BACKUP_MIRROR 指定的目录（默认关闭），保留 7 份
# 差异仅两处（本仓库版）：
#   1) 备份目录是仓库的 backups/，不是 ~/crm-backups/
#   2) 补跑守卫可经 CRM_BACKUP_FRESH_HOURS 调整（外置盘版供人工/低频执行）
#
# 【日志归属】本脚本是 $CRM_BACKUP_LOG_FILE（默认 ~/crm-backup.log）的唯一写入者：
#   所有输出都经 log_line() 同时写 stdout 与日志文件。因此**不要**再用
#   `./backup-db.sh >> backup.log 2>&1` 之类的重定向，否则同一行会写两遍。
#
# 失败告警背景（2026-09-26，W13-2）：脚本曾连续失败 12 小时无人发现
# （Docker Desktop 未自启导致 pg_dump 连不上），故改为三级失败可见。
set -euo pipefail

# 路径自解析：cron/launchd 下 CWD 不可靠，备份必须落在仓库 backups/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
mkdir -p "$BACKUP_DIR"

# cron/launchd 的 PATH 极简，docker 可能缺失；补齐常见安装位
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:$PATH"

LOG_FILE="${CRM_BACKUP_LOG_FILE:-$HOME/crm-backup.log}"
ALERT_FILE="${CRM_BACKUP_ALERT_FILE:-$HOME/crm-backup-alert.txt}"
# 离机镜像目标：默认留空=不做镜像。需要离机备份时设为本机之外的位置，例如
# 外置盘 /Volumes/<卷名>/crm-backups-mirror 或已挂载的网络/对象存储路径。
MIRROR_DIR="${CRM_BACKUP_MIRROR_DIR:-}"
MIRROR_KEEP=7
PG_CONTAINER="${CRM_BACKUP_PG_CONTAINER:-crm-postgres}"
NOTIFY_TIMEOUT="${CRM_BACKUP_NOTIFY_TIMEOUT:-10}"
NOTIFY_ERR_FILE="${CRM_BACKUP_NOTIFY_ERR_FILE:-$BACKUP_DIR/.notify-stderr.log}"

# ---------------------------------------------------------------- 日志出口
# 唯一写日志的地方：终端可见 + $LOG_FILE 留痕。
# 约定（tests/unit/wave6-f10-backup.test.ts 依赖此契约，勿改）：
#   - 正常进度 -> stdout（如 "Backup completed successfully" / "SKIP:"）
#   - 错误/告警 -> stderr，且必须含 "ERROR" 字样（测试断言 res.stderr 匹配 /ERROR/）
# 因为 crontab 不再重定向输出，这里各自 append 一次即不会重复。
log_line() {
  echo "$1"
  echo "$1" >> "$LOG_FILE" 2>/dev/null || true
}

# 错误行：stderr + 日志。内容须含 ERROR 前缀。
err_line() {
  echo "$1" >&2
  echo "$1" >> "$LOG_FILE" 2>/dev/null || true
}

# ---------------------------------------------------------------- 告警工具

# 发 macOS 系统通知。**必须限时**：实测（2026-09-26，真实 cron 上下文）
# `osascript -e 'tell application "System Events" ...'` 会在 cron 里永久挂起
# （TCC Automation 授权弹窗在无 GUI 会话下无法应答）。若通知调用能挂住，
# 任务就永远跑不完 => 备份停摆。故用后台子 shell + 硬超时。
send_notification() {
  local title="$1" message="$2"
  local esc_title esc_msg
  esc_title="${title//\\/\\\\}"
  esc_title="${esc_title//\"/\\\"}"
  esc_msg="${message//\\/\\\\}"
  esc_msg="${esc_msg//\"/\\\"}"
  ( osascript -e "display notification \"$esc_msg\" with title \"$esc_title\"" >/dev/null 2>"$NOTIFY_ERR_FILE" ) &
  local apid=$!
  local waited=0
  while kill -0 "$apid" 2>/dev/null; do
    if [ "$waited" -ge "$NOTIFY_TIMEOUT" ]; then
      kill -9 "$apid" 2>/dev/null || true
      wait "$apid" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$apid"
}

# 失败告警：[ALERT] 日志行 + 覆盖写 alert 文件 + 限时系统通知
raise_alert() {
  local reason="$1"
  local stamp
  stamp="$(date '+%Y-%m-%d %H:%M:%S %Z')"

  err_line "ERROR: CRM 数据库备份失败：$reason"
  err_line "[ALERT] $stamp CRM 数据库备份失败：$reason"
  err_line "[ALERT] $stamp 详见 $ALERT_FILE 与 $LOG_FILE"

  {
    echo "CRM 备份告警（未恢复）"
    echo "首次/最近告警时间: $stamp"
    echo "失败原因: $reason"
    echo "主机: $(hostname -s 2>/dev/null || echo unknown)"
    echo "日志: $LOG_FILE"
    echo "备份目录: $BACKUP_DIR"
    echo
    echo "处置建议："
    echo "  1) 确认 Docker Desktop 已启动：open -a Docker && docker info"
    echo "  2) 确认容器在跑：docker ps --filter name=$PG_CONTAINER"
    echo "  3) 手动补一次备份：$0"
  } > "$ALERT_FILE"

  if send_notification "CRM 备份告警" "备份失败：$reason"; then
    err_line "[ALERT] $stamp 系统通知已提交 osascript(display notification 退出 0)；横幅是否可见取决于「系统设置→通知→脚本编辑器」的提醒样式（当前实测不显示横幅）"
  else
    local notify_err
    notify_err="$(head -3 "$NOTIFY_ERR_FILE" 2>/dev/null | tr '\n' ' ' || true)"
    err_line "[ALERT] $stamp 系统通知不可用（send_notification 非零退出）${notify_err:+：$notify_err}；已降级为 alert 文件 + 日志行"
    printf '通知降级: osascript 在当前上下文不可用（cron/TCC 或超时 %ss），仅依赖 alert 文件与日志\n' "$NOTIFY_TIMEOUT" >> "$ALERT_FILE"
  fi
}

# 恢复通知：仅当此前处于告警状态（alert 文件存在）才发，随后删除 alert 文件
clear_alert() {
  [ -f "$ALERT_FILE" ] || return 0
  local since
  since="$(head -2 "$ALERT_FILE" 2>/dev/null | tail -1 || true)"
  log_line "RECOVERED: $(date '+%Y-%m-%d %H:%M:%S %Z') 备份恢复正常，已清除告警状态${since:+（${since}）}"
  send_notification "CRM 备份已恢复" "数据库备份已恢复正常，告警已清除" \
    || err_line "RECOVERED: 系统通知不可用（send_notification 非零退出），已清除 alert 文件"
  rm -f "$ALERT_FILE"
  return 0
}

# 补跑守卫：Mac 睡过 3 点也能醒来补上（本外置盘版为手动执行，默认 1h 与 cron 版一致）
#
# ⚠️ 必须按分钟比较：cron 在 :17:00 触发，而备份常在 :17:0x~:20 完成，下个整点
# 时间差仅 3380~3600 秒。用 `elapsed / 3600` 取整得 0，会使 `0 < 1` 恒成立、每小时
# 都被误判为"太新"跳过，实际退化成每 2 小时备份（RPO 减半）。故按分钟 + 10% 余量。
FRESH_HOURS="${CRM_BACKUP_FRESH_HOURS:-1}"
FRESH_MINUTES=$(( FRESH_HOURS * 60 ))
FRESH_THRESHOLD_MINUTES=$(( FRESH_MINUTES * 9 / 10 ))
LATEST="$(ls -t "$BACKUP_DIR"/salescrm_*.sql.gz 2>/dev/null | head -1 || true)"
if [ -n "$LATEST" ]; then
  LAST_EPOCH=$(stat -f %m -- "$LATEST" 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE_MINUTES=$(( (NOW_EPOCH - LAST_EPOCH) / 60 ))
  if [ "$AGE_MINUTES" -lt "$FRESH_THRESHOLD_MINUTES" ]; then
    log_line "SKIP: 最新备份 $(basename "$LATEST") 距今 ${AGE_MINUTES} 分钟（<${FRESH_THRESHOLD_MINUTES} 分钟阈值），无需重复备份"
    exit 0
  fi
fi

TIMESTAMP=$(date +"%Y%m%d_%H%M")
BACKUP_FILE="$BACKUP_DIR/salescrm_$TIMESTAMP.sql.gz"
TMP_FILE="$BACKUP_DIR/.tmp_salescrm_$TIMESTAMP.sql.gz"

log_line "Starting database backup to $BACKUP_FILE..."

# 统一失败出口：告警三件套 + 非零退出
fail() {
  local reason="$1"
  rm -f "$TMP_FILE"
  raise_alert "$reason"
  exit 1
}

# 1. 执行 pg_dump 并流式压缩至临时文件；pipefail 确保任一环节失败即非零退出
if ! docker exec "$PG_CONTAINER" pg_dump -U salescrm_admin salescrm 2>/dev/null | gzip > "$TMP_FILE"; then
  fail "pg_dump 失败：容器 $PG_CONTAINER 不可用（docker ps 确认名称）、库 salescrm 不存在、或权限不足"
fi

# 2. 校验 gzip 完整性，未通过则拒绝更名
if ! gzip -t "$TMP_FILE"; then
  fail "备份文件 gzip 完整性校验失败（gzip -t 未通过，通常是磁盘满或转储被截断）"
fi

# 3. 原子更名：仅在校验通过后才暴露为正式备份
mv -- "$TMP_FILE" "$BACKUP_FILE"
log_line "Backup completed successfully: $BACKUP_FILE"

# 4. 仅在有效新备份存在后才轮转旧份（保留最新 14 份）
if [ ! -f "$BACKUP_FILE" ]; then
  fail "新备份文件不存在，跳过轮转以防误删"
fi
log_line "Cleaning up old backups (keeping latest 14)..."
ls -tp "$BACKUP_DIR"/salescrm_*.sql.gz 2>/dev/null | grep -v '/$' | tail -n +15 | xargs -I {} rm -- {} 2>/dev/null || true
log_line "Cleanup done."

# ---------------------------------------------------------------- 离机镜像
mirror_backup() {
  local file="$1" ts="$2"
  # 守卫：备份目录位于系统临时目录时**不做离机镜像**。
  # 原因：tests/unit/wave6-f10-backup.test.ts 会在 mkdtemp 沙箱里真跑本脚本并用
  # 假 docker 产出假 dump；若不守卫，单元测试会把假备份写进真实镜像目录，
  # 占掉镜像位并可能误导恢复。
  case "$BACKUP_DIR" in
    /private/var/folders/*|/var/folders/*|"${TMPDIR%/}"|"${TMPDIR%/}"/*)
      log_line "MIRROR-SKIP: 备份目录位于系统临时目录（测试沙箱？），不做离机镜像"
      return 0 ;;
  esac
  if [ -z "$MIRROR_DIR" ]; then
    log_line "MIRROR-SKIP: 未配置 CRM_BACKUP_MIRROR_DIR，不做离机镜像（如需离机请设为外置盘/网络存储路径）"
    return 0
  fi
  if [ ! -d "$MIRROR_DIR" ]; then
    log_line "MIRROR-SKIP: 镜像目录 $MIRROR_DIR 不存在（外置盘未挂载？），已跳过（不影响主备份成功）"
    return 0
  fi
  local probe="$MIRROR_DIR/.wtest_$$"
  if ! : > "$probe" 2>/dev/null; then
    log_line "MIRROR-SKIP: 镜像目录 $MIRROR_DIR 不可写（外置盘未挂载，或 macOS TCC 拦截访问可移动卷），已跳过（不影响主备份成功）"
    return 0
  fi
  rm -f "$probe"
  local mtmp="$MIRROR_DIR/.tmp_salescrm_$ts.sql.gz"
  if cp -- "$file" "$mtmp" 2>/dev/null && gzip -t "$mtmp" 2>/dev/null; then
    mv -- "$mtmp" "$MIRROR_DIR/salescrm_$ts.sql.gz"
    ls -tp "$MIRROR_DIR"/salescrm_*.sql.gz 2>/dev/null | grep -v '/$' | tail -n +$((MIRROR_KEEP + 1)) | xargs -I {} rm -- {} 2>/dev/null || true
    log_line "Mirrored to $MIRROR_DIR/salescrm_$ts.sql.gz (mirror keeps latest $MIRROR_KEEP)"
  else
    rm -f "$mtmp" 2>/dev/null || true
    log_line "MIRROR-SKIP: 拷贝到 $MIRROR_DIR 失败或校验未通过（不影响主备份成功）"
  fi
  return 0
}
mirror_backup "$BACKUP_FILE" "$TIMESTAMP"

# ---------------------------------------------------------------- 恢复告警
clear_alert
