-- 0089_remove_notifications_task_type_unique.sql
-- 移除 notifications(task_id, type) 永久硬唯一索引，改由业务层 24h 窗口去重查询承载，
-- 消除超期任务每日一提醒因硬唯一约束被拒绝的逻辑冲突。
-- 补充常规复合索引维持检索性能。

DROP INDEX IF EXISTS notifications_task_type_unique;
CREATE INDEX IF NOT EXISTS notifications_task_type_created_idx ON notifications (task_id, type, created_at) WHERE task_id IS NOT NULL;
