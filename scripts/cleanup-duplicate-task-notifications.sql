-- 清理 TASK_OVERDUE / TASK_DUE_SOON 历史重复通知：每个任务每个通知类型仅保留最新一条记录
WITH ranked_task_notifications AS (
  SELECT
    id,
    tenant_id,
    COALESCE(
      task_id::text,
      SUBSTRING(link FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
      link,
      title
    ) AS dedup_key,
    type,
    ROW_NUMBER() OVER (
      PARTITION BY
        tenant_id,
        COALESCE(
          task_id::text,
          SUBSTRING(link FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'),
          link,
          title
        ),
        type
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM notifications
  WHERE type IN ('TASK_OVERDUE', 'TASK_DUE_SOON')
)
DELETE FROM notifications
WHERE id IN (
  SELECT id FROM ranked_task_notifications WHERE rn > 1
);
