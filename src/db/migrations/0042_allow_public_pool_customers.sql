-- 0042_allow_public_pool_customers.sql
-- 允许客户档案的 owner_user_id 为空以支持公海客户池流转与沉睡客户自动回收

ALTER TABLE customers ALTER COLUMN owner_user_id DROP NOT NULL;
