-- 扩充 notification_type 枚举值以支持审批双向触达、临期与逾期定向提醒及变更审核
-- 开源版（AGPL-3.0）手术说明：plugin_contract_status 枚举属合同插件（闭源）已移除；
--   notification_type 属核心枚举，其契约类取值保留（闭源插件可复用）。
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_APPROVAL_REQUESTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_REJECTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRING_SOON';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SCHEDULE_PAYMENT_OVERDUE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_REVISION_REQUESTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'CONTRACT_REVISION_AUDITED';
