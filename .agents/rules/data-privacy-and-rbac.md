# Data Privacy, RBAC & Multi-Tenant Rules

1. **Backend Privilege Enforcement**: Never rely on frontend filtering for `SALES` role restrictions. Apply `WHERE user_id = ctx.userId` in the backend service.
2. **PII Masking**: Always mask phone numbers and email addresses in list views using `MaskedPhone`.
3. **Audit Trails**: Log unmasking, exports, and critical pool transitions to `audit_logs`.
4. **Tenant Context**: All DB queries must execute within `withTenant` or include `tenantId`.
