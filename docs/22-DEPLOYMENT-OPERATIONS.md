# 部署运维手册

> 版本 v1.0 · 2026-09-09  
> 定位：部署、环境变量、迁移/种子、定时任务、备份恢复、升级回滚与故障排查的**单一事实源**。所有命令与默认值均从仓库现况核实（`.env.example` / `package.json` / `docker-compose*.yml` / `scripts/cron-scheduler.ts` / `scripts/backup-db.sh` / `scripts/docker-entrypoint*.sh` / `src/app/api/cron/*` / `src/core/ai-gateway/client.ts` / `scripts/prepare-test-db.ts`）。禁止凭记忆编造。

---

## 1. 两种运行模式

### 1.1 定位差异

| 维度 | `docker-compose.dev.yml` 开发热更 | `docker-compose.yml` 生产构建 |
|---|---|---|
| `Dockerfile` | `Dockerfile.dev`（`node:22-bookworm-slim` + 全量依赖，`pnpm dev`） | `Dockerfile` 多阶段：`deps → builder(pnpm build standalone)` → `runner`（仅生产依赖 + `standalone` + `scripts`） |
| 入口 | `scripts/docker-entrypoint-dev.sh` 必执行 `pnpm dev -H 0.0.0.0 -p 3000` | `scripts/docker-entrypoint.sh` 优先 `node server.js`（standalone），不存在则 `pnpm start` |
| 热更 | `volumes: - .:/app - /app/node_modules - /app/.next` 宿主机改动即时同步 | 无挂载；镜像内已构建产物 |
| `NODE_ENV` | `development` | `production` |
| 内存限额 | `app 1024M / postgres 256M / cron 96M` | `app 384M(+256M NODE_OPTIONS) / postgres 256M / cron 96M(64M NODE_OPTIONS)` |
| 默认密钥 | 全部有开发级默认值（见下表） | 关键密钥必须从 `.env` 注入，缺失直接启动失败（`?:must be defined`） |
| 迁移/种子 | `RUN_MIGRATIONS=true` 默认自动跑 `pnpm db:migrate`；`SEED_DEMO=true` 默认自动跑 `pnpm db:seed:acceptance` | 同逻辑由 `docker-entrypoint.sh` 执行，受环境变量控制（见 3.） |
| 端口 | 默认 `APP_HOST_PORT=3000` → `3000`，`POSTGRES_HOST_PORT=127.0.0.1:54329` → `5432` | 同 |
| 健康检查 | `app: wget http://localhost:3000/api/health` 30s；`postgres: pg_isready` 2-3s；`cron: ps aux | grep node` | 同（`postgres` 间隔 3s） |

### 1.2 启动命令（对照 `package.json` scripts）

| 场景 | 命令 | 实际展开 |
|---|---|---|
| 开发热更启动 | `pnpm docker:dev` | `docker compose -f docker-compose.dev.yml up -d` |
| 开发停止 | `pnpm docker:dev:down` | `docker compose -f docker-compose.dev.yml down` |
| 生产构建启动 | `pnpm docker:prod` | `docker compose up -d`（读取 `docker-compose.yml` + `.env`） |
| 生产停止 | `pnpm docker:prod:down` | `docker compose down` |
| 本地直连开发（不经 Docker） | `pnpm dev` | `next dev`（需宿主机 PG 已起） |
| 构建校验 | `pnpm build && pnpm start` | `next build` + `next start`（生产镜像内为 `node server.js`） |

> 端口转发规则变更后必须带 `--force-recreate` 重建容器，否则旧映射仍生效（见 7.）。

---

## 2. 环境变量逐项表

> 来源：`.env.example` 80 行全量提取；必填性以 `docker-compose.yml` 是否含 `:?` 校验为准；代码读取点逐项核对。

| 变量 | 用途 | 示例 | 必填 | 代码读取点 |
|---|---|---|---|---|
| `NODE_ENV` | 运行模式，影响日志与构建产物 | `production` / `development` | 否（compose/镜像默认覆盖） | `Dockerfile` / `next.config` 间接 |
| `PORT` | 容器内监听端口 | `3000` | 否 | `docker-compose*.yml` `app.environment.PORT` |
| `APP_HOST_PORT` | 宿主机映射端口 | `3000` 或 `127.0.0.1:3000` | 否 | `docker-compose*.yml` ports |
| `POSTGRES_HOST_PORT` | PG 宿主机映射 | `127.0.0.1:54329` | 否 | `docker-compose*.yml` ports |
| `POSTGRES_DB` | 库名 | `salescrm` | 否（有默认） | `docker-compose*.yml` `POSTGRES_DB` |
| `POSTGRES_USER` | 迁移/Owner 角色 | `salescrm_admin` | 否（有默认） | compose `POSTGRES_USER` / `scripts/migrate.ts` |
| `POSTGRES_PASSWORD` | Owner 密码 | `openssl rand -base64 18` | **生产必填**（`?:must be defined`） | `docker-compose.yml:12`，`scripts/migrate.ts` `MIGRATION_DATABASE_URL` |
| `APP_DATABASE_PASSWORD` | `salescrm` 应用角色密码 | `openssl rand -base64 18` | **生产必填** | `docker-compose.yml:41`，`scripts/migrate.ts:6` |
| `DATABASE_URL` | 应用运行时连接串（`salescrm` 受限角色） | `postgres://salescrm:${APP_DATABASE_PASSWORD}@postgres:5432/salescrm` | 否（由 compose 拼接默认） | `db/client.ts` / `withTenant` |
| `MIGRATION_DATABASE_URL` | 迁移连接串（`salescrm_admin` Owner） | `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/salescrm` | **生产为迁移入口** | `scripts/migrate.ts:5` / `docker-entrypoint*.sh` |
| `SESSION_SECRET` | JWT/Session 签名密钥，≥32 字符 | `openssl rand -hex 32` | **生产必填** | `docker-compose.yml:42` `?:must be defined`；`core/auth/*` |
| `ENCRYPTION_KEY` | 三方密钥 AES-256-GCM 主密钥，32 字符；缺省从 `SESSION_SECRET` 派生 | 32 字符随机串 | 否 | `docker-compose*.yml:48`；`core/security/crypto.ts` |
| `CRON_SECRET` | 定时任务 Bearer Token，≥16 字符 | `openssl rand -hex 24` | **生产必填** | `scripts/cron-scheduler.ts:20`；`src/app/api/cron/*/route.ts:13-14` |
| `CRON_BASE_URL` | Cron 调度器请求基地址（容器内用 `http://app:3000`） | `http://app:3000` | 否（默认 `http://app:3000` / `http://localhost:3000`） | `scripts/cron-scheduler.ts:19`；`docker-compose*.yml:72/80` |
| `CRON_INTERVAL_MINUTES` | 轮询周期（分钟） | `5` | 否（默认 5） | `scripts/cron-scheduler.ts:21` |
| `CRON_RUN_ONCE` | 仅跑一轮后退出（冒烟用） | `1` | 否 | `scripts/cron-scheduler.ts:22` |
| `RUN_MIGRATIONS` | 容器启动自动执行增量迁移（`0000~xxxx`，Advisory Lock 防并发） | `true` / `false` | 否（默认 `true`） | `scripts/docker-entrypoint.sh:22` / `scripts/migrate.ts:14` |
| `SEED_DEMO` | 启动时灌核心演示数据（`db:seed:acceptance`） | `false`（生产必须 false） | 否（默认 `false` 生产 / `true` 开发） | `scripts/docker-entrypoint*.sh:35` / `scripts/seed-acceptance.ts` |
| `SEED_CONFIRM` | 破坏性种子二次确认（非演示库需 `yes`） | `yes` | 条件必填 | `scripts/seed/guard.ts`（`assertSeedAllowed`，由 `db:seed:acceptance` CLI 入口调用） |
| `DEV_ADMIN_EMAIL` | 首个管理员邮箱（空库初始化） | `admin@example.com` | 否 | `docker-compose*.yml:44`；`seed-*.ts` |
| `DEV_ADMIN_PASSWORD` | 首个管理员密码，≥8 字符 | `password123`（仅开发默认） | 否（生产若初始化管理员则需） | `docker-compose*.yml:45`；`seed-*.ts:21` |
| `TEST_DATABASE_URL` | 宿主机跑 `pnpm test` 时指向的测试库（`*_test` 后缀强制） | `postgres://salescrm:salescrm_dev@localhost:54329/salescrm_test` | 宿主机测试必填 | `scripts/prepare-test-db.ts:6`；`vitest` 各集成测试 |
| `TEST_MIGRATION_DATABASE_URL` | 测试库迁移连接串（需与 `TEST_DATABASE_URL` 同库） | `postgres://salescrm_admin:salescrm_migration@localhost:54329/salescrm_test` | 宿主机测试必填 | `scripts/prepare-test-db.ts:5` |
| `AI_GATEWAY_ALLOW_HOSTS` | 自建内网 LLM 网关白名单（逗号分隔 `host`/`host:port`），留空则严格拦截所有私网地址 | `llm-gateway.internal:8080` | 否 | `src/core/ai-gateway/client.ts:235` `isWhitelisted()`；`docker-compose*.yml:49/54` |

**私有地址拦截（`AI_GATEWAY_ALLOW_HOSTS` 未命中时）：** `client.ts:249-332` 对 `localhost/.local/.internal/.corp/.lan/.onion`、`10/8`、`172.16/12`、`192.168/16`、`127/8`、`0/8`、`100.64/10`、`169.254/16`、`fc00::/7`、`fe80::/10`、多进制/十六进制/单整数 IP 及 DNS 解析后的 A/AAAA 均 `fail-closed` 拒绝；仅白名单精确匹配 `host` 或 `host:port` 放行。

---

## 3. 首次启动流程

### 3.1 依赖

- Node.js 22+、`pnpm 9.15.5`（`package.json:62`）、Docker/Docker Compose。
- 端口占用检查：`lsof -i :3000 -i :54329`。

### 3.2 配置 `.env`

```bash
cp .env.example .env
# 生产：填入 SESSION_SECRET / CRON_SECRET / POSTGRES_PASSWORD / APP_DATABASE_PASSWORD
# 生成示例：openssl rand -hex 32 / openssl rand -hex 24 / openssl rand -base64 18
# 本地开发：可沿用 .env.example 默认值或直接使用 docker-compose.dev.yml 内置弱口令
```

### 3.3 启动数据库与应用

**开发热更（推荐本地联调）：**
```bash
pnpm docker:dev              # 后台起 postgres + app + cron（dev 镜像，volume 热更）
docker compose -f docker-compose.dev.yml logs -f app  # 观察启动
```

**生产构建：**
```bash
pnpm docker:prod             # docker compose up -d（读取 docker-compose.yml + .env）
docker compose logs -f app
```

**不经 Docker 直连（需宿主机 PG 已可达）：**
```bash
pnpm install
pnpm dev                     # next dev @ localhost:3000
```

### 3.4 迁移（`db:migrate` vs `prepare-test-db` 区分）

| 脚本 | 命令 | 作用 | 何时用 |
|---|---|---|---|
| `scripts/migrate.ts` | `pnpm db:migrate`（读取 `MIGRATION_DATABASE_URL` + `APP_DATABASE_PASSWORD`，Advisory Lock `8472910482910481`） | 增量应用 `src/db/migrations/*.sql`（`0000_stage_0` 等），记录 `schema_migrations`，支持 `migrate:no-transaction` 分段 | 开发/生产首次建库或增量升级；容器启动时 `RUN_MIGRATIONS=true` 自动同逻辑执行 |
| `scripts/prepare-test-db.ts` | `pnpm test` 前置自动调用；或单独 `tsx scripts/prepare-test-db.ts` | 校验 `*_test` 后缀与同库一致性；若库不存在则 `CREATE DATABASE`；随后 `pnpm db:migrate` 以 `TEST_MIGRATION_DATABASE_URL` 为迁移串 | 宿主机跑集成测试前必做；**永不触碰开发库**（库名不以 `_test` 结尾直接抛错） |

> 多副本安全：`migrate.ts:22` `pg_advisory_lock(8472910482910481)` 会话锁；K8s 场景可设 `RUN_MIGRATIONS=false` 改由 `initContainer/Job` 单实例执行。

### 3.5 演示数据 `db:seed:acceptance`

```bash
pnpm db:seed:acceptance      # 写入演示租户 + 管理员/销售/主管账号 + 客户/联系人/线索/商机/任务/打法库
```

- **守卫 `assertSeedAllowed()`（`scripts/seed/guard.ts`，由 `seed-acceptance.ts` CLI 入口调用）：** 需同时满足 `SEED_CONFIRM=yes` **或**（`hostname ∈ {localhost,127.0.0.1}` 且 `dbname ∈ {demo,showcase,salescrm_dev,salescrm_test}`）。生产库默认拦截，防“向生产灌脏数据”。
- **幂等：** 先 `advisory_lock(SEED_ADVISORY_LOCK_ID)`，再按外键倒序清理演示租户历史，最后批量插入；可重复执行。
- **容器自动灌：** `SEED_DEMO=true` 时 `docker-entrypoint*.sh` 自动触发；生产 `docker-compose.yml` 默认 `false`。

### 3.6 访问

- 打开 `http://localhost:3000/login`，用 `DEV_ADMIN_EMAIL/DEV_ADMIN_PASSWORD` 登录（开发默认 `admin@example.com / password123`）。
- 健康探针：`GET /api/health`（`docker-compose` `healthcheck` 即此接口）。

---

## 4. 定时任务

### 4.1 调度器 `scripts/cron-scheduler.ts`

- **触发端点（`ENDPOINTS` 3 个）：**
  1. `POST /api/cron/scan-tasks` — 任务超时通知 + 销售洞察扫描（`scanTaskNotificationsService` + `scanSalesInsightsService`，单租户 `1000` 条上限、`FOR UPDATE SKIP LOCKED`、超时 >30s 记 warn，共用 `CRON_SECRET`）
  2. `POST /api/cron/recycle-public-pools` — 公海自动回收（`runPublicPoolRecycleForAllTenantsService`，逐租户 `withTenant` 循环、单租户失败不中断他租户）
  3. `POST /api/cron/ai-daily-inspection` — AI 每日巡检（`runDailyAiInspectionService`，支持 `x-cron-secret` 或 `Authorization: Bearer`）
- **认证：** 请求头 `x-cron-secret: <CRON_SECRET>`（`ai-daily-inspection` 兼容 `Authorization: Bearer <CRON_SECRET>`）；服务端用 `sha256 + timingSafeEqual` 比对，缺失/不匹配 `401 UNAUTHENTICATED`。
- **运行模式：**
  ```bash
  pnpm cron                              # 常驻，每 5 分钟一轮（CRON_INTERVAL_MINUTES 默认 5）
  CRON_RUN_ONCE=1 pnpm cron              # 单轮冒烟，跑完即退出
  CRON_INTERVAL_MINUTES=1 pnpm cron      # 1 分钟轮询（调试用，生产不推荐 <5）
  ```
  启动日志：`[cron] 调度器启动：<BASE_URL>，每 <N> 分钟一轮（3 个任务）`；每轮输出 `endpoint -> status (ms)`。

### 4.2 外部触发（替代常驻进程）

适用于 `crontab / launchd / 云平台定时器`：

```bash
curl -X POST http://localhost:3000/api/cron/scan-tasks \
  -H "x-cron-secret: $CRON_SECRET"

curl -X POST http://localhost:3000/api/cron/recycle-public-pools \
  -H "x-cron-secret: $CRON_SECRET"

curl -X POST http://localhost:3000/api/cron/ai-daily-inspection \
  -H "x-cron-secret: $CRON_SECRET"
# 或 -H "Authorization: Bearer $CRON_SECRET"
```

> `docker-compose*.yml` 已内置 `cron` 服务（`command: node --experimental-strip-types scripts/cron-scheduler.ts`，`depends_on: app:healthy`，`CRON_BASE_URL=http://app:3000` 容器内网络）。若使用外部触发，可 `docker compose stop cron` 停内置调度器，避免重复执行（重复由 `(task_id,type)` 唯一约束 + `SKIP LOCKED` 兜底，但仍建议单源调度）。

---

## 5. 备份与恢复

### 5.1 备份脚本机制（`scripts/backup-db.sh` 仓库正本 / `$HOME/bin/crm-backup.sh` cron 抄本）

> ⚠️ **2026-09-26 更新**：两版脚本已加入**失败告警三件套**（见 5.1.1）与**离机镜像**（见 5.1.2）。
> 起因是实测教训：脚本曾连续失败 12 小时无人发现（Docker Desktop 未自启 → `pg_dump` 连不上），
> 旧版失败时只往日志写一行就 `exit 1`。

| 项目 | 实现 |
|---|---|
| 路径 | `SCRIPT_DIR/../backups` 自解析（`cron/launchd` 下 CWD 不可靠）；`PATH` 补齐 `/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/...` |
| 补跑守卫 | cron 抄本 `FRESH_HOURS=1`（契合 RPO≤1h）；仓库正本默认 `20h`（人工/低频执行）。两者均可用 `CRM_BACKUP_FRESH_HOURS` 覆盖 |
| 命名 | `salescrm_YYYYMMDD_HHMM.sql.gz`，先写 `.tmp_salescrm_*.sql.gz` |
| 转储 | `docker exec $PG_CONTAINER pg_dump -U salescrm_admin salescrm \| gzip > TMP_FILE`（`set -euo pipefail` 任一环节失败即非零退出并清理临时文件） |
| 校验 | `gzip -t TMP_FILE` 完整性校验，未通过则拒绝更名 |
| 原子更名 | 校验通过后 `mv TMP_FILE BACKUP_FILE` 才暴露为正式备份 |
| 轮转 | 仅在新份存在后执行：`ls -tp salescrm_*.sql.gz \| tail -n +15 \| xargs rm` 保留最新 14 份（`grep -v '/$'` 排除目录） |
| 失败出口 | 全部失败路径统一走 `fail()` → `raise_alert()` → **非 0 退出**，保证告警一定触发 |
| 容器名可覆盖 | `CRM_BACKUP_PG_CONTAINER`（默认 `crm-postgres`），便于演练与测试 |
| **日志归属** | 脚本是 `~/crm-backup.log` 的**唯一写入者**（所有输出经 `log_line()` 同时写 stdout + 日志）。**因此 crontab 那行不带 `>> ~/crm-backup.log 2>&1`** |

> **日志重复行的坑（已踩并修复）**：早期版本让脚本自己 `append` 日志、同时 crontab 又做
> `>> log 2>&1`，导致同一行写两遍（12:17 真实 cron 运行实测到 `RECOVERED` 行成对出现）。
> 曾尝试用 `readlink /dev/fd/2` 或 `[ /dev/fd/2 -ef file ]` 探测 stderr 是否已指向日志，
> **在 macOS 上两者都不可靠**（前者返回空；后者因 `/tmp` 的 device 差异恒为假）。
> 最终改为「单一写入者」：去掉 crontab 重定向，脚本内部自己写日志，从结构上消除重复。

#### 5.1.1 失败告警三件套（零外部依赖）

失败时同时走三条通道，**不依赖任何需要注册的第三方服务**（无 Slack / SMTP / webhook）：

| 通道 | 实现 | 实测结论（2026-09-26） |
|---|---|---|
| ① 日志 `[ALERT]` 行 | `log_line "[ALERT] <时间戳> CRM 数据库备份失败：<原因>"` | ✅ 可靠。进 `~/crm-backup.log` |
| ② 告警文件 | 覆盖写 `~/crm-backup-alert.txt`（含时间戳、原因、主机、处置建议 3 步） | ✅ 可靠。恢复成功后自动删除 |
| ③ 系统通知 | `osascript -e 'display notification ... with title "CRM 备份告警"'` | ⚠️ **退出码 0、无 stderr、不挂起，但横幅默认不显示**（详见下方实测） |

**恢复语义：** 下一次成功时若 `~/crm-backup-alert.txt` 存在 → 发"已恢复"通知 → 写 `RECOVERED:` 日志行 → 删除 alert 文件。
（真实 cron 于 12:17 自动完成过一次恢复：检测到 12:16 的告警态 → 备份成功 → 写 `RECOVERED` → 清 alert。）

**③ 系统通知的实测结论（务必读）：**

- ✅ 在**真实 cron 上下文**里 `osascript -e 'display notification ...'` **退出码 0、stderr 为空、不会挂起**——TCC 没有拦截通知本身。
- ❌ 但**横幅不会出现在屏幕上**。三重证据：
  1. `screencapture` 连拍 6 帧通知时刻，**无横幅**；
  2. **对照组**：`osascript -e 'display dialog ...'` 的模态框**能被拍到**——证明截图能捕捉瞬态 UI，不是截图方式的问题；
  3. 通知中心数据库 `~/Library/Group Containers/group.com.apple.usernoted/db2/db` 中 `com.apple.scripteditor2`（`osascript` 的责任进程）的记录为 `delivered_date` 非空但 `presented=0`。
- ⚠️ **另一个更危险的发现**：`osascript -e 'tell application "System Events" ...'` 在 cron 上下文会**永久挂起**（TCC Automation 授权弹窗在无 GUI 会话下无法应答，实测进程 `etime` 持续增长）。若通知调用能挂住，cron 任务就永远跑不完 → **备份直接停摆，比不告警更糟**。因此 `send_notification()` 用「后台子 shell + 硬超时（默认 10s，`CRM_BACKUP_NOTIFY_TIMEOUT` 可调）」实现，超时返回 124 并降级。
- **一次性人工动作**：想让横幅真正弹出，需在 **系统设置 → 通知 → 脚本编辑器** 把提醒样式改为「横幅」。未做之前，**请以 `~/crm-backup-alert.txt` 为准**，它是最可靠通道。

#### 5.1.2 离机镜像（保留 7 份）

备份成功后额外拷一份到 `CRM_BACKUP_MIRROR_DIR` 指定的目录（如外置盘或网络存储上的镜像目录），**与主目录 14 份轮转独立**：

- 拷贝后同样 `gzip -t` 校验，再原子 `mv` 才算成功。
- 轮转：保留最新 **7** 份（`tail -n +8`）。
- **不可用时静默跳过、只记一行日志，绝不因此判定备份失败**：
  - 目录不存在 → `MIRROR-SKIP: 镜像目录 ... 不存在（外置盘未挂载？）`
  - 目录存在但写不进去 → `MIRROR-SKIP: 镜像目录 ... 不可写（外置盘未挂载，或 macOS TCC 拦截访问可移动卷）`
    （脚本会先做一次真实的写入探测 `: > "$MIRROR_DIR/.wtest_$$"`，而不是只信 `[ -w ]`）
- ⚠️ **实测限制（重要）**：`$HOME/bin/crm-backup.sh` 由 **cron** 执行时，**镜像拷贝会被 macOS TCC 拦截**（12:17 真实 cron 运行打出 `MIRROR-SKIP`）。这与 5.2 记录的外置盘 TCC 限制同源。**结论：离机镜像目前只在手动执行（仓库正本 / 终端直调）时生效**；要让 cron 也写外置盘，需给 `/usr/sbin/cron` 授予「完全磁盘访问权限」（系统设置 → 隐私与安全性 → 完全磁盘访问权限）。

### 5.2 crontab 示例

**每小时补跑（推荐，契合脚本 1h 守卫）：**
```cron
17 * * * * $HOME/bin/crm-backup.sh
```
- 含义：每小时尝试一次（示例用 :17，错开整点负载）；若 1h 内已有新份则跳过，否则落新份。Mac 睡眠错过 03:00 时，下一次唤醒自动补齐。
- ⚠️ **不要加 `>> ~/crm-backup.log 2>&1`**：脚本已是日志唯一写入者，加了会让每行写两遍（见 5.1「日志归属」）。
- 改完 crontab 后自检：`crontab -l`，并等一个整点确认 `~/crm-backup.log` 出现新行且**没有重复**。

**固定每日 03:00（历史示例，仍可用）：**
```cron
0 3 * * * /path/to/crm/scripts/backup-db.sh
```
- 需保证机器在 03:00 处于唤醒状态，否则当日无备份（无补跑）。
- 同理**不要**加输出重定向。

> ⚠️ **macOS TCC 实测限制**：macOS 的 cron 派生进程**无法访问可移动卷**（后台派生进程被透明拦截，实测 67 个整点窗口零执行，连写日志都不行）。因此若把仓库放在外置盘（`/Volumes/<外部卷>/...`）并让 cron 直接调用仓库内脚本，备份会**静默失败**。
> **处置**：把 `backup-db.sh` 复制到主目录下的路径（如 `$HOME/bin/crm-backup.sh`）由 cron 调用该副本——只触碰主目录与 docker，备份落 `~/crm-backups/`、日志 `~/crm-backup.log`；仓库内脚本保留为手动执行入口。
> 该限制也会使 cron 版备份的**离机镜像被跳过**（见 5.1.2）；但**告警通道不受影响**（alert 文件与日志都在主目录）。若需要真正的离机备份，须改用 `launchd`（不受该 TCC 路径限制）或为 cron 授予完全磁盘访问权限。

**绕过守卫做演练（不破坏轮转）：**
```bash
# 把最新备份的 mtime 往前推 3h，使 AGE_HOURS >= 1 而非被 SKIP
touch -t "$(date -v-3H '+%Y%m%d%H%M.%S')" "$(ls -t ~/crm-backups/salescrm_*.sql.gz | head -1)"
# 或直接用环境变量覆盖守卫（仓库正本）
CRM_BACKUP_FRESH_HOURS=0 ./scripts/backup-db.sh
```

### 5.3 恢复演练（含到临时库验证）

**演练前置：** 恢复为破坏性操作，**必须先在临时库验证**，确认备份可还原再操作生产。

**1) 恢复到临时库验证：**
```bash
# 建临时库（宿主机可达 PG，或在容器内执行）
docker exec crm-postgres psql -U salescrm_admin -d postgres -c "create database salescrm_restore_test;"

# 解压还原到临时库（示例取最新一份）
gunzip -c backups/salescrm_20260909_0300.sql.gz | docker exec -i crm-postgres psql -U salescrm_admin -d salescrm_restore_test

# 抽样校验
docker exec crm-postgres psql -U salescrm_admin -d salescrm_restore_test -c "select count(*) from tenants; select count(*) from leads; select max(created_at) from opportunities;"

# 验证通过后清理临时库
docker exec crm-postgres psql -U salescrm_admin -d postgres -c "drop database salescrm_restore_test;"
```

**2) 生产恢复（需停服窗口）：**
```bash
docker compose stop app cron
# 可选：再落一份当前快照作回退点
./scripts/backup-db.sh

# 还原（会覆盖 salescrm）
gunzip -c backups/salescrm_20260909_0300.sql.gz | docker exec -i crm-postgres psql -U salescrm_admin -d salescrm

# 重启并观察迁移一致性
docker compose up -d --wait
docker compose logs -f app | grep -i migration
```

**3) 演练记录：** 每次演练保留“备份文件名、还原耗时、抽样计数、操作人、RPO/RTO 是否达标（目标 RPO ≤1h / RTO ≤4h，见 `docs/20` 18.5）”。

---

## 6. 升级与回滚

### 6.1 升级步骤

```bash
# 1. 落当前快照
./scripts/backup-db.sh

# 2. 拉新代码
git fetch && git checkout <tag>   # 或对应分支

# 3. 重建镜像并重启（生产）
docker compose build app cron
docker compose up -d --wait
# 开发热更改了依赖/端口/Dockerfile 时
docker compose -f docker-compose.dev.yml build --no-cache
docker compose -f docker-compose.dev.yml up -d --force-recreate --wait

# 4. 观察
docker compose logs -f app | grep -E "migration|PostgreSQL|Starting"
curl -s http://localhost:3000/api/health | jq .
```

- `RUN_MIGRATIONS=true` 时容器启动自动执行增量迁移（`schema_migrations` 去重，`pg_advisory_lock` 防并发）；`false` 时需手动 `pnpm db:migrate` 或 `initContainer`。
- `SEED_DEMO` 生产保持 `false`；切勿在生产库执行 `pnpm db:seed:acceptance`。

### 6.2 迁移不可逆项注意

| 迁移 | 变更 | 可逆性 | 回滚要点 |
|---|---|---|---|
| `0091_core_performance_indexes.sql` | 新增 6 个索引（`activities_tenant_occurred_idx` 等，均为 `create index if not exists`） | 仅增索引，无数据变更；注释注明 `drop index if exists <name>` 即可回滚 | 回滚执行对应 `drop index if exists`；无需数据恢复 |
| `0092_add_tasks_title_note.sql` | `tasks` 新增可空列 `title text`, `note text` | 新增可空列，无回填；注释注明 `alter table tasks drop column if exists title/note` | 回滚 `drop column if exists`；应用层对列缺失需兼容（新代码已判空） |
| `0094_wave8_r02_public_summary.sql` | `ai_insight_reports` 新增可空列 `public_summary text` | 新增可空列，自动回填 `buildPublicSafeSummary`；无破坏性约束 | 回滚 `alter table ... drop column if exists public_summary`；`evidence.public_summary` 兜底路径仍可读 |
| 其他破坏性约束（例 `0093` 复合外键） | 删旧单列 FK、建 `(tenant_id,id)` 复合 FK | 需 `drop constraint + recreate` | 回滚需重建旧约束；建议用升级前备份恢复验证 |

> **规则：** 凡 `migrate:no-transaction` 或含 `drop constraint/column` 的迁移，回滚以“备份恢复到临时库验证”为准，不建议在生产库上反向 DDL 试错。

### 6.3 回滚要点

- **应用回滚：** `checkout` 上一标签 → `docker compose build && up -d --wait`；若含不可逆 DDL，先评估是否需“备份恢复”而非仅切镜像。
- **数据回滚：** 优先用 `5.3` 的“临时库验证”流程，确认备份可用后在窗口期还原生产库；还原后重跑 `health` 与抽样计数。
- **多副本：** `RUN_MIGRATIONS=false + Job` 部署时，回滚同样需先停 `Job`，避免新旧迁移并发。

---

## 7. 常见故障排查

| 现象 | 根因 | 实操处置 |
|---|---|---|
| `docker compose up` 后应用端口仍为旧映射 / `APP_HOST_PORT` 改后不生效 | Compose 未重建容器，旧容器端口配置残留 | `docker compose up -d --force-recreate`；开发模式同理 `docker compose -f docker-compose.dev.yml up -d --force-recreate --wait` |
| `POSTGRES_PASSWORD must be defined` / `SESSION_SECRET must be defined` / `CRON_SECRET must be defined` 且容器 `Exited` | 生产 `docker-compose.yml` 对关键变量 `?:must be defined` 强校验，`.env` 缺失或未加载 | `cp .env.example .env` 并填入 `openssl` 生成的强随机值；`docker compose config` 检查变量是否解析；重启 `docker compose up -d` |
| `MIGRATION_DATABASE_URL is required` / `APP_DATABASE_PASSWORD is required` | `pnpm db:migrate` 在宿主机执行但未导出迁移串 | `export MIGRATION_DATABASE_URL=... && export APP_DATABASE_PASSWORD=... && pnpm db:migrate`；或直接在容器内 `docker exec crm-web pnpm db:migrate` |
| `TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are required` / `must target same database / must end with _test` | `pnpm test` 前置 `prepare-test-db.ts` 校验失败 | 确保 `.env` 含 `TEST_DATABASE_URL` 与 `TEST_MIGRATION_DATABASE_URL` 且同库、库名以 `_test` 结尾；`TEST_DATABASE_URL=.../salescrm_test pnpm test` |
| `Database migration exited with code` 后重试 | PG 未就绪或锁竞争 | `docker-entrypoint.sh` 已自动 `sleep 2 && retry` 一次；若仍失败 `docker compose logs postgres` 查 `pg_isready`，并 `docker exec crm-postgres pg_isready -U salescrm_admin -d salescrm` 手工探活 |
| `CRON_SECRET is replace-with-a-random-secret` 警告 | 仍为示例占位值 | 生产立即 `openssl rand -hex 24` 替换并 `docker compose up -d --force-recreate cron` |
| 定时任务静默不触发 / `POST /api/cron/* 401` | `x-cron-secret` 与容器内 `CRON_SECRET` 不一致 | `docker compose exec cron env | grep CRON` 与宿主机 `echo $CRON_SECRET` 对照；`curl -v -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/scan-tasks` 直测 |
| `docker: command not found` / `Cannot connect to the Docker daemon` / `backup-db.sh: docker: not found` | Docker Desktop 未启动或 `PATH` 不含 | 启动 Docker Desktop；`export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"`；`docker ps` 验证 |
| `pg_dump: error: connection to server at "postgres" failed` | 容器名非 `crm-postgres` 或网络隔离 | `docker ps --format "{{.Names}}"` 确认；宿主机执行需 `docker exec crm-postgres ...`，容器内则用 `postgres:5432` |
| `FATAL: role "salescrm_auth" cannot login` 或 `salescrm_migration` 登录失败预期外 | 误用 `NOLOGIN` 角色直连 | 应用连接固定用 `salescrm`（`DATABASE_URL`），迁移用 `salescrm_admin`（`MIGRATION_DATABASE_URL`）；`salescrm_auth/salescrm_migration` 仅作 `SECURITY DEFINER` 属主，不可登录 |
| `gzip: invalid compressed data` / `gzip -t 未通过` | 备份被截断或磁盘满 | `rm -f .tmp_*.sql.gz`；`df -h` 查空间；`docker system prune` 清理后重跑 `./scripts/backup-db.sh` |
| `ENCRYPTION_KEY` 未设导致三方密钥解密异常 | 生产未配主密钥 | 设 32 字符 `ENCRYPTION_KEY` 并重建容器；未设时代码从 `SESSION_SECRET` 派生，仅开发可用 |
| `AI_GATEWAY_ALLOW_HOSTS` 配后仍 `SSRF Protection` 拦截 | 白名单格式不符或含空格/尾点未标准化 | 按 `.env.example:78` 格式 `llm-gateway.internal:8080,llm-gateway.internal`（逗号分隔、无协议、无路径）；`docker compose exec app node -e "console.log(process.env.AI_GATEWAY_ALLOW_HOSTS)"` 验证 |
| Docker 持续吃满 CPU（实测 `Virtualization.framework` 进程 95%）、风扇狂转 | Docker VM 内存被容器配额打满，VM 反复换页。本机 Docker Desktop 仅分配 2GB（`~/Library/Group Containers/group.com.docker/settings-store.json` 的 `MemoryMiB=2048`），而 dev 栈原配额 app 1024M + postgres 256M + cron 96M 已逼近上限 | ①`docker ps` 找出非必需容器（`crm-web-dev`/`crm-cron-dev` 对跑测试无用，测试只依赖 postgres）并 `docker stop`；②`docker builder prune -f`（实测可回收数 GB）；③已在 `docker-compose.dev.yml` 把 app 配额降到 768M、`NODE_OPTIONS` 降至 640M 留出余量；④如确需更大 app 内存，先上调 Docker Desktop 的 Memory 上限再改容器配额，切勿让容器配额之和逼近 VM 上限 |

> 兜底自检：`pnpm typecheck && pnpm lint && pnpm test`（开源版 77 文件 / 545 用例）是提交前门禁；分层门禁 `scripts/check-layer-boundary.ts` 由 `pnpm lint` 前置执行（`core`/`lib` 既不引 `@/plugins`，也不出现任何 `plugin_*` 业务插件表字样）。
>
> **开源版说明（AGPL-3.0）**：本仓库为「主代码开源 + 业务插件闭源」发行版。`src/plugin-kit/`（插件框架：`PluginDefinition` 契约、`registry` 装配点、挂载点、启停与限流基础设施）完整保留，`src/plugins/` 与其数据表不在本仓库；框架当前为空装配（`compiledPlugins = []`），上游调用点（侧边栏导航 / 线索与商机详情挂载 / 设置页分区）自动降级为不渲染。

---

## 8. CI 门禁（GitHub Actions）

> **2026-09-26 新增**：仓库此前**完全没有 CI**（`.github/` 不存在），上述门禁全靠人工执行。
> 现由 `.github/workflows/ci.yml` 在 **push 与 pull_request** 时自动执行完整门禁。

### 8.1 触发与流水线

| 项 | 值 |
|---|---|
| 文件 | `.github/workflows/ci.yml` |
| 触发 | `push`（所有分支）+ `pull_request` |
| Job | 单 job `gate`，`ubuntu-latest`，`timeout-minutes: 30` |
| 并发 | `concurrency` 按 `workflow+ref` 分组，`cancel-in-progress: true`（同 PR 新 push 取消旧轮次） |
| 权限 | `contents: read`（最小权限） |

### 8.2 步骤（任一失败即整体失败，无 `continue-on-error`）

| # | 步骤 | 命令 | 说明 |
|---|---|---|---|
| 0 | Checkout | `actions/checkout@v4` | |
| 0 | Setup pnpm | `pnpm/action-setup@v4` | **不传 version**，自动读 `package.json` 的 `packageManager: pnpm@9.15.5` |
| 0 | Setup Node | `actions/setup-node@v4` + `node-version-file: .nvmrc` + `cache: pnpm` | Node 22（`.nvmrc`） |
| 1 | Install | `pnpm install --frozen-lockfile` | 锁文件必须一致，改依赖必须同步提交 `pnpm-lock.yaml` |
| 2 | Typecheck | `pnpm typecheck` | `tsc --noEmit` |
| 3 | Lint | `pnpm lint` | 已内含 `tsx scripts/check-layer-boundary.ts` 分层门禁，**workflow 不重复跑** |
| 4 | Test | `pnpm test` | = `tsx scripts/prepare-test-db.ts && vitest run`；连**真实 PostgreSQL 17** |
| 5 | Build | `pnpm build`（`env.NODE_ENV=production`） | Next 生产构建，验证构建可复现 |

### 8.3 测试数据库（`services: postgres`）

- 镜像 `postgres:17`（与 `docker-compose.yml` 对齐），端口 `5432:5432`，
  healthcheck `--health-cmd "pg_isready -U salescrm_admin -d salescrm_test"`（5s 间隔 / 20 次重试）。
- `POSTGRES_USER=salescrm_admin`、`POSTGRES_PASSWORD=ci_admin_pw`、`POSTGRES_DB=salescrm_test`、
  `POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256`。
- `vitest.config.ts` 已设 `fileParallelism: false`（串行），workflow 无需额外并发配置。
- 库不存在时 `prepare-test-db.ts` 自动 `CREATE DATABASE` 并跑 `pnpm db:migrate`（本机已实测该分支）。

**4 个测试环境变量（缺一即失败）：**

| 变量 | 值 | 为什么 |
|---|---|---|
| `TEST_DATABASE_URL` | `postgres://salescrm:ci_app_pw@localhost:5432/salescrm_test` | 应用侧连接串（受限角色 `salescrm`） |
| `TEST_MIGRATION_DATABASE_URL` | `postgres://salescrm_admin:ci_admin_pw@localhost:5432/salescrm_test` | 迁移侧；**必须与上者同库**、库名以 `_test` 结尾 |
| `MIGRATION_DATABASE_URL` | `postgres://salescrm_admin:ci_admin_pw@localhost:5432/**salescrm**` | ⚠️ **故意不指向测试库**，见下 |
| `APP_DATABASE_PASSWORD` | `ci_app_pw` | `scripts/migrate.ts` 用它创建/更新 `salescrm` 角色密码 |

> ⚠️ **`MIGRATION_DATABASE_URL` 必须与测试库不同名**（W13-1 实测踩坑）：
> 55 个集成测试文件顶部都有守卫
> `new URL(TEST_MIGRATION_DATABASE_URL).pathname !== new URL(MIGRATION_DATABASE_URL).pathname`
> （如 `tests/integration/stage-zero.test.ts:15`），相等即抛
> `Integration tests must not use the development database`，**直接导致 38 个测试文件失败**。
> `prepare-test-db.ts` 在 spawn `pnpm db:migrate` 时会用 `TEST_MIGRATION_DATABASE_URL` 覆盖该变量，
> 所以 CI 里把它指到一个「不存在的开发库名」既满足断言、又永不会被连接。

> ⚠️ **切勿在 job 级设 `NODE_ENV=production`**（W13-1 实测踩坑）：
> pnpm 会输出 `devDependencies: skipped because NODE_ENV is set to production` 并**跳过 devDependencies**，
> 而 `pnpm install` **仍返回 0**，随后 `pnpm typecheck` 报 `sh: tsc: command not found`。
> 因此 `NODE_ENV: production` **只加在 `Build` 步骤上**。

> ℹ️ **构建期变量实测结论**：`pnpm build` 在**完全不设** `SESSION_SECRET`/`ENCRYPTION_KEY` 时也能通过
> （`next build` 期间所有页面均为 `ƒ` 动态渲染，`src/core/security/crypto.ts` 的密钥校验发生在请求时而非模块求值时）。
> workflow 仍注入 CI 专用假值（`ci_only_*`）作为前向安全垫，避免将来新增「模块求值期读密钥」的代码时构建诡异失败。
> **这些假值仅存在于 CI，绝不可用于任何真实环境。**

### 8.4 本机等价复现（不依赖 GitHub Actions）

CI 是否会绿，唯一可信证据是在本机把每一步真跑一遍：

```bash
# 1) 起一个与 CI 同配置的 PG（PostgreSQL 17，端口 5432）
docker run -d --name crm-ci-sim -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=salescrm_test -e POSTGRES_USER=salescrm_admin \
  -e POSTGRES_PASSWORD=ci_admin_pw -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256" \
  --health-cmd "pg_isready -U salescrm_admin -d salescrm_test" \
  --health-interval 5s --health-timeout 5s --health-retries 20 postgres:17

# 2) 在一份「没有 .env」的干净副本里（CI 仓库里没有 .env）逐条执行
export TEST_DATABASE_URL="postgres://salescrm:ci_app_pw@localhost:5432/salescrm_test"
export TEST_MIGRATION_DATABASE_URL="postgres://salescrm_admin:ci_admin_pw@localhost:5432/salescrm_test"
export MIGRATION_DATABASE_URL="postgres://salescrm_admin:ci_admin_pw@localhost:5432/salescrm"
export APP_DATABASE_PASSWORD="ci_app_pw"
export NEXT_TELEMETRY_DISABLED=1 SESSION_SECRET=ci_only_... ENCRYPTION_KEY=ci_only_... \
       CRON_SECRET=ci_only_... DATABASE_URL="$TEST_DATABASE_URL"
pnpm install --frozen-lockfile   # 1
pnpm typecheck                   # 2
pnpm lint                        # 3
pnpm test                        # 4
env NODE_ENV=production pnpm build  # 5
```

**2026-09-26 实测结果（干净副本 + 先 `DROP DATABASE salescrm_test` 强制走 CREATE DATABASE 分支）：**
5 步退出码全 `0`；`Test Files 92 passed (92)` / `Tests 693 passed (693)`；lint `0 errors, 12 warnings`；
`✓ Compiled successfully`。

**开源版（AGPL-3.0）实测结果**（剥离 7 个闭源业务插件后重跑，2026-09-26）：
`pnpm install --frozen-lockfile` / `pnpm typecheck` / `pnpm lint` / `pnpm test` / `NODE_ENV=production pnpm build` 5 步退出码全 `0`；
`Test Files 77 passed (77)` / `Tests 545 passed (545)`（零 skip）；lint `0 errors, 9 warnings`（全部为剥离前既有告警）；`✓ Compiled successfully`。

### 8.5 本地修改工作流时

```bash
brew install actionlint   # 校验 workflow YAML / 表达式 / shell 片段
actionlint .github/workflows/ci.yml
```
`actionlint` 会同时调用 `shellcheck` 检查 `run:` 片段。本地**已装** `actionlint 1.7.12`。

### 8.6 Node 版本约定

- `.nvmrc` = `22`；`package.json` `engines.node = ">=22 <23"`；`Dockerfile` 用 `node:22-bookworm-slim`。
- ⚠️ `pnpm` 默认不做 engine 强校验：在 Node 24 下执行 `pnpm install` 只会打印
  `WARN Unsupported engine: wanted: {"node":">=22 <23"}`，**不会失败**（本机实测退出码 0）。
  若要强校验，可在 `.npmrc` 加 `engine-strict=true`（当前未加，避免影响现有开发机）。

---

## 9. TLS 与 HTTPS 入口（Caddy 2）

> **2026-09-26 新增**。解决**上线硬阻断**：生产 HTTP 下浏览器拒收 session cookie。
> `src/core/auth/actions.ts:31` 与 `src/core/auth/session.ts:119` 均为
> `secure: process.env.NODE_ENV === "production"`——生产模式下 cookie 带 `Secure`，
> 浏览器只在 HTTPS 下才存/发该 cookie。裸 HTTP 暴露 3000 端口 ⇒ **全员无法登录**。

### 9.1 文件与拓扑

| 文件 | 作用 |
|---|---|
| `deploy/caddy/Caddyfile` | Caddy 2 配置：TLS 终止 + 反代 `app:3000` + 头部清洗 |
| `docker-compose.prod-tls.yml` | compose overlay：新增 `caddy` 服务；把 `app` 的 3000 从公网改为仅 `127.0.0.1`；重申 `NODE_ENV=production` |

```
公网 ──443/80──▶ caddy (TLS 终止) ──app:3000（compose 内网）──▶ app
                        │
                        └─ 覆盖并剥离所有客户端可伪造的进线 IP 头
```

### 9.2 怎么填域名 / 怎么换自签

在 `.env` 增加两个变量（**只放 `.env`，不要提交**；模板见 `.env.example`）：

```bash
# 公网域名（必填）。需已解析到本机公网 IP，且 80/443 从公网可达。
SITE_DOMAIN=crm.example.com

# 证书来源，两种取值：
#   internal        -> Caddy 本地 CA 自签（内网试用/预发，浏览器会提示不受信）
#   ops@example.com -> 公网 ACME，且用该邮箱收证书到期/吊销通知（生产推荐）
# 留空则由 compose 的 ${SITE_TLS_MODE:-internal} 兜底为 internal
SITE_TLS_MODE=ops@example.com
```

启动（**必须同时带两个 compose 文件**）：

```bash
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml config   # 只校验不起服务
```

> `SITE_DOMAIN` 留空会**故意 fail-fast**：compose 的 `:?` 报 `SITE_DOMAIN must be defined`，
> 且 Caddyfile 也会报 `unrecognized global option`——没有域名就不该静默起一个明文服务。
>
> `SITE_TLS_MODE` **不要写成空串**：Caddyfile 的 `{$VAR:default}` 对「已设置为空」不生效，
> 会报 `wrong argument count or unexpected line ending after 'tls'`。compose 的 `:-internal` 已规避。

### 9.3 进线 IP 头清洗（W10-5 遗留项的处置）

开源版应用侧两处**直接信任客户端可控的请求头**作为「客户端 IP」（第三处属闭源 form-capture 插件，已随插件移除）：

| 位置 | 用途 |
|---|---|
| `src/plugin-kit/server.ts:210` | **API Key 的 IP 白名单准入** |
| `src/core/leads/service.ts:729` | 进线 IP 限流 / 白名单 |
| ~~`src/app/api/public/plugins/form-capture/...`~~ | 闭源 form-capture 插件的公开表单端点，开源版已移除 |

两处读取顺序都是 `x-real-ip` → `cf-connecting-ip` → `x-forwarded-for`。

**Caddy 2 默认行为有两个危险点：**
1. 默认**不设置** `X-Real-IP` / `CF-Connecting-IP`，客户端自定义的同名头会**原样透传**到 app；
2. 默认对 `X-Forwarded-For` 是**追加**（append）而非覆盖，客户端可注入任意前缀。

**后果：** 任何人 `curl -H 'X-Real-IP: 203.0.113.9'` 就能冒充白名单 IP，直接绕过 API Key IP 白名单。

**处置：** Caddyfile 的 `header_up` 把应用会读的每个「客户端 IP 头」都**覆盖**为 `{remote_host}`
（Caddy 看到的真实 TCP 对端，客户端无法伪造），并 `header_up -<Name>` 剥离 `Forwarded`（RFC 7239）
与 `X-Original-*` / `X-Rewrite-URL` 等伪造 URL 头。

> **为何用 `{remote_host}` 而不是 `{client_ip}`**：`{client_ip}` 在配置了 `trusted_proxies` 时会取
> 「可信代理链」里的真实 IP。一旦有人把 `trusted_proxies` 写成 `0.0.0.0/0`（常见的图省事误配），
> 任意客户端就能用 `X-Forwarded-For` 伪造 `{client_ip}`，白名单绕过立即复现。
> `{remote_host}` 是 TCP 层事实，无任何客户端可控输入。
> ⚠️ 若将来把 Caddy 放到另一个 LB/网关之后，**必须先收紧 `trusted_proxies` 再改用 `{client_ip}`**。

**实测证据（2026-09-26，真起 Caddy + 回显后端，未对外暴露）：** 客户端伪造
`X-Real-IP: 203.0.113.9` / `CF-Connecting-IP: 198.51.100.7` / `X-Forwarded-For: 198.51.100.7, 192.0.2.1` /
`X-Forwarded-Proto: http` / `Forwarded` / `X-Original-*`，后端实际收到：

| 头 | 后端实际收到 | 结论 |
|---|---|---|
| `x-real-ip` | `172.19.0.1`（真实 TCP 对端） | ✅ 伪造值被覆盖 |
| `cf-connecting-ip` | `172.19.0.1` | ✅ 伪造值被覆盖 |
| `x-forwarded-for` | `172.19.0.1`（单值，非追加） | ✅ 伪造链被覆盖 |
| `x-forwarded-proto` | `https` | ✅ 无法降级为 http |
| `forwarded` / `x-original-url` / `x-original-host` / `x-rewrite-url` | **不存在** | ✅ 已剥离 |
| `x-forwarded-port` | `18443` | ✅ 已展开 |

> 这次实测还抓出一个配置缺陷并已修复：`header_up X-Forwarded-Port {server_port}` 中
> **`{server_port}` 不是 Caddy 占位符**，会被原样透传（后端收到的字面值就是 `"{server_port}"`）。
> 正确写法是 `{http.request.port}`。

### 9.4 端口与 cookie

- `app` 的 3000 用 `ports: !override ["127.0.0.1:3000:3000"]` 覆盖基线的 `${APP_HOST_PORT:-3000}:3000`
  （默认 `0.0.0.0`，即公网可达）。**必须用 `!override`**：compose 合并 `ports` 默认是「追加」，
  只写一条新的会变成两条映射、3000 仍暴露在公网。另加 `expose: ["3000"]` 仅作文档。
- Caddy 与 app 同处 compose 默认网络，走容器名 `app:3000` 直连，不经宿主机端口。
- 对外只暴露 `443`（业务）与 `80`（ACME HTTP-01 挑战 + `http→https` 跳转）。
- `NODE_ENV=production` 已在 overlay 中重申——`secure` cookie 依赖它。
- 代码 grep 确认：**没有** `APP_URL` 之类的对外基址变量；`SESSION_SECRET` / `CRON_SECRET` /
  `DATABASE_URL` / `MIGRATION_DATABASE_URL` / `APP_DATABASE_PASSWORD` 已在基线 `docker-compose.yml` 用
  `:?` 强校验，overlay 未削弱。

### 9.5 证书自动续期在哪看

Caddy **自动续期，无需 crontab**（默认在证书剩余 1/3 时限触发）。

```bash
# 证书与 ACME 账号持久化在 caddy_data 卷（overlay 已声明）
docker volume inspect crm_caddy_data

# 调 Caddy 管理端点（容器内 2019，默认只监听 localhost）
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml exec caddy \
  wget -qO- http://localhost:2019/pki/            # 托管证书清单
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml logs -f caddy   # ACME 申请/续期日志

# 手动触发续期（调试用）
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml exec caddy \
  caddy renew --config /etc/caddy/Caddyfile --force
```

### 9.6 如何验证

```bash
# 1) 证书与 TLS
curl -I https://crm.example.com
#   断言：HTTP/2 200；响应含
#         strict-transport-security: max-age=63072000; includeSubDomains; preload
curl -sI https://crm.example.com | grep -i strict-transport-security

# 2) 80 跳转
curl -I http://crm.example.com            # 断言 308/301 且 Location: https://...

# 3) cookie 带 Secure（登录后）
curl -sk -D- -o/dev/null -X POST https://crm.example.com/api/auth/login \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode '<登录字段>=<值>' | grep -i set-cookie
#   断言：Set-Cookie 里含 Secure; HttpOnly; SameSite=Lax; Path=/

# 4) 反代头是否正确（应用侧只应看到真实对端 IP）
docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml logs caddy | tail -20
```

### 9.7 配置校验（不启动服务）

```bash
# compose 合并合法性 + 端口断言
SITE_DOMAIN=crm.example.com docker compose -f docker-compose.yml -f docker-compose.prod-tls.yml config
#   断言：app.ports 仅 1 条且 host_ip=127.0.0.1；caddy.ports 含 443 与 80；app.NODE_ENV=production

# Caddyfile 语法（本机无 caddy 二进制时用容器）
docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e SITE_DOMAIN=crm.example.com -e SITE_TLS_MODE=internal \
  caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
#   期望输出：Valid configuration（SITE_TLS_MODE 不传时同样 Valid，靠 Caddyfile 的 :internal 默认）
```

> ⚠️ **本节只交付配置，未执行 `docker compose up`**（会占用 80/443 并可能触发真实 ACME 申请）。
> `caddy validate` 已在 `SITE_TLS_MODE=internal` / `=ops@example.com` / 不传 三种情形下实测全部 `Valid configuration`；
> `SITE_DOMAIN` 缺失时按预期报错。
