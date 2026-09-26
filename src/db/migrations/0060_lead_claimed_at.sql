-- 认领时间独立于创建时间：公海保护期此前按 created_at 计算，
-- 老线索刚被捞回第二天就可能再次被回收，保护期形同虚设。
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 存量数据回填：已有负责人的线索以创建时间近似认领时间（保守值，
-- 避免回填后出现"从未认领"的 NULL 导致保护期判断失效）
UPDATE public.leads SET claimed_at = created_at WHERE owner_user_id IS NOT NULL AND claimed_at IS NULL;
