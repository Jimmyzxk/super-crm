# 容量基线与复现

> 本文记录压测方法和已取得的证据。小规模 smoke 只证明工具链可运行，不证明百万级容量达标。

## 1. 安全边界

- 生成器和基准只接受本机 PostgreSQL；
- 数据库名必须以 `_capacity` 结尾；
- 生成器只追加一个新租户，不提供删除或重置；
- 不使用生产数据，不把多个小租户合计规模代替单一大租户；
- 100% 目标规模必须使用独立实例，不能与开发数据库共享资源。

## 2. 生成数据

数据库先执行全部迁移。默认 smoke 规模为 1000 客户、5000 线索、5000 商机和 2 万跟进：

```bash
CAPACITY_DATABASE_URL=postgres://.../salescrm_capacity pnpm capacity:generate
```

100% 目标规模参数：

```bash
CAPACITY_DATABASE_URL=postgres://.../salescrm_capacity pnpm capacity:generate \
  --customers=1000000 --leads=5000000 --opportunities=5000000 --activities=50000000
```

生成器输出 `tenantId`、销售用户 ID、主管用户 ID 和各表写入量。商机依赖客户，跟进依赖商机；违反依赖时直接失败，不静默生成空数据。

## 3. 运行基准

```bash
CAPACITY_APP_DATABASE_URL=postgres://.../salescrm_capacity \
CAPACITY_TENANT_ID=... \
CAPACITY_SALES_USER_ID=... \
CAPACITY_MANAGER_USER_ID=... \
BENCHMARK_RUNS=100 \
BENCHMARK_MODE=warm \
BENCHMARK_OUTPUT=artifacts/capacity-warm.json \
pnpm capacity:benchmark
```

需要固定同一个客户做前后对照时，可额外设置 `CAPACITY_CUSTOMER_ID`。脚本会验证该客户属于当前租户且未删除；不设置时自动选择有商机和开放任务的代表客户。

报告保存 SQL、参数、P50/P95/P99、返回行数、数据规模、PostgreSQL 版本和完整 `EXPLAIN (ANALYZE, BUFFERS)` JSON。

`BENCHMARK_MODE=cold` 只是报告标签。真正的冷缓存测试必须在专用实例重启后立即执行，脚本不会擅自重启共享 PostgreSQL 或清空操作系统缓存。

## 4. 当前 smoke 证据

环境：PostgreSQL 17.10，ARM64，本地 Docker；热缓存；7 次采样。

| 查询 | 样本规模 | P95 | 顶层共享命中块 | 判断 |
|---|---:|---:|---:|---|
| 线索池创建时间排序 | 5000 线索 | 4.08ms | 319 | 工具链通过，不证明 500 万 |
| 线索池有限计数 | 5000 线索 | 1.40ms | 167 | ceiling 路径已生效 |
| 客户池最近互动 | 1000 客户 / 5000 商机 | 6.51ms | 990 | 相关摘要仍需 1%/100% 验证 |
| 商机池活跃排序（旧查询） | 5000 商机 | 7.20ms | 22274 | 需要先修或解释 |
| 商机池活跃排序（0023，30 次） | 5000 商机 | 14.08ms | 1375 | 共享块下降 93.8%；当前样本增加固定开销，仍需 1%/100% 验证 |
| 销售工作台（旧简化投影） | 550 个开放任务 | 1.19ms | 1510 | 仅作历史工具链记录，不代表生产查询 |
| 主管有限计数 | 同上 | 0.81ms | 28 | ceiling 路径已生效 |

原始证据：[capacity-smoke.json](../artifacts/capacity-smoke.json)。

## 5. 1% 目标规模证据

环境：PostgreSQL 17.10，ARM64，本地 Docker，热缓存；单租户 10000 客户、50000 线索、50000 商机、500000 跟进和 5500 个开放任务；固定同一个客户运行 30 次。

| 查询 | P95 | 顶层共享命中块 | 判断 |
|---|---:|---:|---|
| 线索池创建时间排序 | 1.07ms | 66 | 1% 通过 |
| 线索池有限计数 | 9.46ms | 1297 | 有界计数生效，仍需 100% 验证 |
| 客户池最近互动 | 8.10ms | 1258 | 任务摘要已拆成两个索引分支 |
| 商机池活跃排序 | 10.46ms | 9046 | 延迟通过；块访问仍需 100% 观察 |
| 销售工作台数据库查询（候选先行） | 8.43ms | 16724 | 与完整展示投影对照 legacy：P95 15.42ms / 34847 块；两个指标均下降 |
| 客户详情摘要 | 2.84ms | 44 | 改读已维护的 `last_activity_at` |
| 客户来源线索 | 2.39ms | 17 | 三个迁移期入口均按关系键读取 |
| 客户时间线 | 3.98ms | 194 | 活动和旧来源分支先有界再合并 |

同一个客户、同一数据集下，优化前的详情摘要、来源线索和时间线 P95 分别为 114.99ms、149.38ms 和 826.79ms；优化后的对应值为 2.84ms、2.39ms 和 3.98ms。原始报告见 [capacity-1pct-detail-v1.json](../artifacts/capacity-1pct-detail-v1.json) 和 [capacity-1pct-detail-v2-fixed.json](../artifacts/capacity-1pct-detail-v2-fixed.json)。

## 6. 尚未通过

- 未运行 100% 目标规模；
- 未运行独立实例冷缓存测试；
- 商机池已增加逾期候选和正常候选的有界分支，以及对应部分索引；在 5000 商机 smoke 中共享块下降，但 P95 从 7.20ms 上升到 14.08ms，不能据此宣称全面提速；
- 销售工作台已将候选选择与详情关联分开：1% 热缓存数据库查询 P95 8.43ms、共享命中块 16724；与同统计、同投影的 legacy 查询相比，P95 从 15.42ms、共享块从 34847 下降。该指标不包含页面渲染；优化仍需 100% 目标规模验证，不能外推为百万级容量通过；
- 客户详情中的来源、联系人、商机和任务读取已设置 100 条上限并返回 `truncation` 元数据，但详情页尚未接入“加载更多”，还不是完整分页；

因此当前只能声明“容量工具链、smoke 和单租户 1% 热缓存验证已通过”，不能声明支持百万级客户或 5000 万跟进。

本轮工作台对照报告见 [capacity-1pct-workbench-final.json](../artifacts/capacity-1pct-workbench-final.json)，其中保留同一数据集下的 `sales_workbench_legacy` 与 `sales_workbench` 结果。`0025_workbench_indexes.sql` 已纳入全新迁移验证；服务层在数据库候选查询返回后对最多 50 条结果按数据库时钟稳定排序。

客户详情的来源线索、联系人、商机和开放任务现通过稳定游标分批读取；`0026_customer_detail_collection_indexes.sql` 为四类关系提供租户/归属键与展示排序的部分索引。容量库已完成该迁移并用 `EXPLAIN (ANALYZE, BUFFERS)` 检查索引命中；这不是百万级容量达标声明，正式门禁仍需按本文件的完整容量口径复测。

0023 的最终报告见 [capacity-smoke-0023-v3.json](../artifacts/capacity-smoke-0023-v3.json)。该报告使用同一容量库、同一租户和热缓存运行 30 次；旧查询和 0023 查询的对照报告分别保留在 [capacity-smoke.json](../artifacts/capacity-smoke.json) 和 [capacity-smoke-0023.json](../artifacts/capacity-smoke-0023.json)。
