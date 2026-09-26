-- 客户认领时间独立于创建时间：与 leads.claimed_at（迁移 0060）同理，
-- 公海保护期需要按"最近一次进入私海"计算，否则刚捞回的沉睡客户
-- 次日就会被定时回收再次抢走。
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 存量回填：已有负责人的客户以创建时间近似（保守值，避免 NULL 使保护期失效）
UPDATE public.customers SET claimed_at = created_at WHERE owner_user_id IS NOT NULL AND claimed_at IS NULL;
