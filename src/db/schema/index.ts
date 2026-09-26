import { sql } from "drizzle-orm";
import {
  bigserial, bigint, boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgEnum,
  pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

export const tenantStatus = pgEnum("tenant_status", ["ACTIVE", "SUSPENDED"]);
export const userRole = pgEnum("user_role", ["ADMIN", "MANAGER", "SALES"]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const leadStatus = pgEnum("lead_status", ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "DISCARDED"]);
export const discardReason = pgEnum("discard_reason", ["NO_NEED", "NO_BUDGET", "WRONG_CONTACT", "INVALID_INFO", "COMPETITOR", "OTHER"]);
export const activityType = pgEnum("activity_type", ["CALL", "MEETING", "VISIT", "MESSAGE", "NOTE"]);
export const activityOutcome = pgEnum("activity_outcome", ["CONNECTED", "NO_ANSWER", "REFUSED", "INTERESTED"]);
export const taskType = pgEnum("task_type", ["FIRST_RESPONSE", "FOLLOW_UP", "STAGE_PUSH"]);
export const taskStatus = pgEnum("task_status", ["OPEN", "DONE", "CANCELLED"]);
export const customerSize = pgEnum("customer_size", ["1-20", "21-100", "101-500", "501-1000", "1000+"]);
export const opportunityStage = pgEnum("opportunity_stage", ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "WON", "LOST"]);
export const lostReason = pgEnum("lost_reason", ["PRICE", "COMPETITOR", "NO_BUDGET", "NO_DECISION", "TIMING", "OTHER"]);
export const insightSeverity = pgEnum("insight_severity", ["INFO", "ATTENTION", "HIGH_RISK"]);
export const insightStatus = pgEnum("insight_status", ["OPEN", "ACCEPTED", "DISMISSED", "EXPIRED"]);
export const insightSource = pgEnum("insight_source", ["RULE", "PLAYBOOK", "MODEL"]);
export const scoreOperator = pgEnum("score_operator", ["EXISTS", "NOT_EXISTS", "EQUALS", "CONTAINS", "STARTS_WITH", "GT", "GTE", "IN"]);
export const scoreFeedbackVerdict = pgEnum("score_feedback_verdict", ["ACCURATE", "INACCURATE"]);
export const notificationType = pgEnum("notification_type", [
  "TASK_OVERDUE",
  "TASK_DUE_SOON",
  "LEAD_ASSIGNED",
  "RECYCLE_WARNING",
  "RECYCLE_EXECUTED",
  "DIRECTORY_SYNC_COMPLETED",
  "PAYMENT_RECEIVED",
  "INVOICE_REMINDER",
  "CONTRACT_SIGNED",
  "ORDER_CONFIRMED",
  "PROJECT_DELIVERED",
  "DEAL_WON",
  "CONTRACT_APPROVAL_REQUESTED",
  "CONTRACT_APPROVED",
  "CONTRACT_REJECTED",
  "CONTRACT_EXPIRING_SOON",
  "SCHEDULE_PAYMENT_OVERDUE",
  "CONTRACT_REVISION_REQUESTED",
  "CONTRACT_REVISION_AUDITED",
  "MORNING_COPILOT",
  "CHAMPION_PRACTICE",
]);
export const winReviewStatus = pgEnum("win_review_status", ["DRAFT", "REVIEWED", "REJECTED"]);
export const salesPlaybookStatus = pgEnum("sales_playbook_status", ["DRAFT", "PUBLISHED", "RETIRED"]);
export const salesPlaybookFeedbackVerdict = pgEnum("sales_playbook_feedback_verdict", ["HELPFUL", "NOT_HELPFUL", "NOT_APPLICABLE"]);
export const customerType = pgEnum("customer_type", ["ENTERPRISE", "INDIVIDUAL"]);
export const contactRoleTag = pgEnum("contact_role_tag", ["DECISION_MAKER", "TECH_EVALUATOR", "PROCUREMENT", "USER", "FINANCE", "OTHER"]);
export const pricingModel = pgEnum("pricing_model", ["SUBSCRIPTION_YEARLY", "SUBSCRIPTION_MONTHLY", "ONE_TIME", "USAGE_BASED", "MAN_MONTH"]);
export const productStatus = pgEnum("product_status", ["ACTIVE", "ARCHIVED"]);
export const interventionType = pgEnum("intervention_type", ["EXECUTIVE_SPONSOR", "DISCOUNT_APPROVAL", "SOLUTION_SUPPORT", "STRATEGY_COACHING"]);
export const interventionStatus = pgEnum("intervention_status", ["REQUESTED", "IN_PROGRESS", "RESOLVED", "REJECTED"]);
export const scheduleType = pgEnum("schedule_type", ["CALL", "MEETING", "VISIT", "PROPOSAL_DEMO", "FOLLOW_UP"]);
export const scheduleStatus = pgEnum("schedule_status", ["PENDING", "COMPLETED", "CANCELLED"]);
export const aiRecommendationType = pgEnum("ai_recommendation_type", [
  "NEXT_BEST_ACTION",
  "OBJECTION_KILLER",
  "LEAD_PITCH",
  "HEALTH_DIAGNOSTIC",
  "MORNING_COPILOT",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  status: tenantStatus("status").default("ACTIVE").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  leaderUserId: uuid("leader_user_id"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("departments_tenant_id_id_unique").on(table.tenantId, table.id),
  index("departments_tenant_parent_idx").on(table.tenantId, table.parentId).where(sql`${table.deletedAt} is null`),
  index("departments_tenant_sort_idx").on(table.tenantId, table.sortOrder.asc(), table.name.asc()).where(sql`${table.deletedAt} is null`),
  check("departments_name_length", sql`char_length(${table.name}) between 1 and 50`),
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  departmentId: uuid("department_id").references(() => departments.id),
  email: text("email").notNull(),
  phone: text("phone"),
  employeeNo: text("employee_no"),
  jobTitle: text("job_title"),
  maxLeadQuota: integer("max_lead_quota").default(100).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: userRole("role").default("SALES").notNull(),
  status: userStatus("status").default("ACTIVE").notNull(),
  sessionVersion: integer("session_version").default(1).notNull(),
  failedLoginCount: integer("failed_login_count").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  unique("users_tenant_id_id_unique").on(table.tenantId, table.id),
  index("users_tenant_role_idx").on(table.tenantId, table.role),
  index("users_tenant_department_idx").on(table.tenantId, table.departmentId),
  check("users_email_normalized", sql`${table.email} = lower(btrim(${table.email}))`),
]);

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ownerUserId: uuid("owner_user_id"),
  /** 最近一次被认领/划入私海的时间，公海保护期以此为准 */
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  customerType: customerType("customer_type").default("ENTERPRISE").notNull(),
  name: text("name").notNull(),
  industry: text("industry"),
  region: text("region"),
  size: customerSize("size"),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  /** @deprecated Removed after lead_conversions Contract migration. */
  fromLeadId: uuid("from_lead_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("customers_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "customers_owner_user_tenant_fk", columns: [table.tenantId, table.ownerUserId], foreignColumns: [users.tenantId, users.id] }),
  index("customers_tenant_owner_idx").on(table.tenantId, table.ownerUserId),
  index("customers_tenant_type_idx").on(table.tenantId, table.customerType),
  index("customers_tenant_name_idx").on(table.tenantId, table.name),
  index("customers_tenant_created_idx").on(table.tenantId, table.createdAt.desc(), table.id.desc()),
  index("customers_tenant_last_activity_idx").on(table.tenantId, table.lastActivityAt.desc(), table.id.desc()).where(sql`${table.deletedAt} is null`),
  index("customers_tenant_owner_last_activity_idx").on(table.tenantId, table.ownerUserId, table.lastActivityAt.desc(), table.id.desc()).where(sql`${table.deletedAt} is null`),
  check("customers_name_length", sql`char_length(${table.name}) between 1 and 100`),
  check("customers_industry_length", sql`${table.industry} is null or char_length(${table.industry}) <= 50`),
  check("customers_region_length", sql`${table.region} is null or char_length(${table.region}) <= 50`),
]);

export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  title: text("title"),
  roleTag: contactRoleTag("role_tag").default("OTHER").notNull(),
  isPrimary: boolean("is_primary").default(false).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("contacts_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("contacts_tenant_customer_id_unique").on(table.tenantId, table.customerId, table.id),
  foreignKey({ name: "contacts_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  uniqueIndex("contacts_tenant_phone_unique").on(table.tenantId, table.phone).where(sql`${table.deletedAt} is null`),
  uniqueIndex("contacts_customer_primary_unique").on(table.customerId).where(sql`${table.isPrimary} = true and ${table.deletedAt} is null`),
  index("contacts_tenant_customer_idx").on(table.tenantId, table.customerId),
  index("contacts_tenant_customer_role_idx").on(table.tenantId, table.customerId, table.roleTag),
  check("contacts_name_length", sql`char_length(${table.name}) between 1 and 50`),
  check("contacts_phone_format", sql`${table.phone} ~ '^1[3-9][0-9]{9}$'`),
  check("contacts_email_length", sql`${table.email} is null or char_length(${table.email}) <= 100`),
  check("contacts_email_format", sql`${table.email} is null or ${table.email} ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`),
  check("contacts_title_length", sql`${table.title} is null or char_length(${table.title}) <= 50`),
]);

export const opportunities = pgTable("opportunities", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerId: uuid("customer_id").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  primaryContactId: uuid("primary_contact_id"),
  /** @deprecated Removed after lead_conversions Contract migration. */
  fromLeadId: uuid("from_lead_id"),
  name: text("name").notNull(),
  stage: opportunityStage("stage").default("DISCOVERY").notNull(),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).defaultNow().notNull(),
  expectedAmount: bigint("expected_amount", { mode: "bigint" }),
  expectedCloseAt: date("expected_close_at"),
  actualAmount: bigint("actual_amount", { mode: "bigint" }),
  actualCloseAt: date("actual_close_at"),
  demandNote: text("demand_note"),
  intendedProductId: uuid("intended_product_id"),
  intendedProduct: text("intended_product"),
  lostReason: lostReason("lost_reason"),
  lostNote: text("lost_note"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("opportunities_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("opportunities_tenant_id_id_customer_id_unique").on(table.tenantId, table.id, table.customerId),
  foreignKey({ name: "opportunities_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "opportunities_owner_user_tenant_fk", columns: [table.tenantId, table.ownerUserId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "opportunities_contact_tenant_fk", columns: [table.tenantId, table.customerId, table.primaryContactId], foreignColumns: [contacts.tenantId, contacts.customerId, contacts.id] }),
  index("opportunities_tenant_owner_stage_idx").on(table.tenantId, table.ownerUserId, table.stage),
  index("opportunities_tenant_customer_idx").on(table.tenantId, table.customerId),
  index("opportunities_tenant_customer_stage_idx").on(table.tenantId, table.customerId, table.deletedAt, table.stage),
  index("opportunities_tenant_expected_close_idx").on(table.tenantId, table.expectedCloseAt),
  check("opportunities_name_length", sql`char_length(${table.name}) between 1 and 100`),
  check("opportunities_expected_amount_nonnegative", sql`${table.expectedAmount} is null or ${table.expectedAmount} >= 0`),
  check("opportunities_actual_amount_nonnegative", sql`${table.actualAmount} is null or ${table.actualAmount} >= 0`),
  check("opportunities_demand_note_length", sql`${table.demandNote} is null or char_length(${table.demandNote}) <= 500`),
  check("opportunities_lost_note_length", sql`${table.lostNote} is null or char_length(${table.lostNote}) <= 200`),
]);

export const opportunityStageHistory = pgTable("opportunity_stage_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  opportunityId: uuid("opportunity_id").notNull(),
  fromStage: opportunityStage("from_stage"),
  toStage: opportunityStage("to_stage").notNull(),
  note: text("note"),
  operatorUserId: uuid("operator_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("opportunity_stage_history_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "opportunity_history_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "opportunity_history_operator_tenant_fk", columns: [table.tenantId, table.operatorUserId], foreignColumns: [users.tenantId, users.id] }),
  index("opportunity_stage_history_tenant_opportunity_idx").on(table.tenantId, table.opportunityId, table.createdAt.desc()),
  check("opportunity_stage_history_transition_check", sql`${table.fromStage} is null or ${table.fromStage} <> ${table.toStage}`),
  check("opportunity_stage_history_note_length", sql`${table.note} is null or char_length(${table.note}) <= 200`),
]);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ownerUserId: uuid("owner_user_id"),
  /** @deprecated Removed after lead_conversions Contract migration. */
  customerId: uuid("customer_id"),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email"),
  companyName: text("company_name"),
  title: text("title"),
  intendedProductId: uuid("intended_product_id"),
  intendedProduct: text("intended_product"),
  budget: text("budget"),
  note: text("note"),
  externalId: text("external_id"),
  sourceLabel: text("source_label"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  source: text("source").default("manual").notNull(),
  status: leadStatus("status").default("NEW").notNull(),
  score: integer("score"),
  scoreReason: text("score_reason"),
  scoredAt: timestamp("scored_at", { withTimezone: true }),
  isPossibleDuplicate: boolean("is_possible_duplicate").default(false).notNull(),
  /** 最近一次进入私海（被认领/指派）的时间，公海保护期以此为准 */
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  channel: text("channel"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  discardReason: discardReason("discard_reason"),
  discardNote: text("discard_note"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("leads_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "leads_owner_user_tenant_fk", columns: [table.tenantId, table.ownerUserId], foreignColumns: [users.tenantId, users.id] }),
  index("leads_tenant_owner_status_idx").on(table.tenantId, table.ownerUserId, table.status),
  index("leads_tenant_phone_idx").on(table.tenantId, table.contactPhone),
  index("leads_tenant_channel_idx").on(table.tenantId, table.channel),
  index("leads_tenant_score_idx").on(table.tenantId, table.score.desc().nullsLast()),
  index("leads_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
  check("leads_contact_name_length", sql`char_length(${table.contactName}) between 1 and 50`),
  check("leads_contact_phone_format", sql`${table.contactPhone} ~ '^1[3-9][0-9]{9}$'`),
  check("leads_contact_email_length", sql`${table.contactEmail} is null or char_length(${table.contactEmail}) <= 100`),
  check("leads_contact_email_format", sql`${table.contactEmail} is null or ${table.contactEmail} ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`),
  check("leads_company_name_length", sql`${table.companyName} is null or char_length(${table.companyName}) <= 100`),
  check("leads_title_length", sql`${table.title} is null or char_length(${table.title}) <= 50`),
  check("leads_intended_product_length", sql`${table.intendedProduct} is null or char_length(${table.intendedProduct}) <= 100`),
  check("leads_budget_length", sql`${table.budget} is null or char_length(${table.budget}) <= 50`),
  check("leads_note_length", sql`${table.note} is null or char_length(${table.note}) <= 500`),
  check("leads_source_format", sql`${table.source} in ('manual', 'import') or ${table.source} ~ '^(form|api):.+$'`),
  check("leads_score_range", sql`${table.score} is null or ${table.score} between 0 and 100`),
  check("leads_score_reason_length", sql`${table.scoreReason} is null or char_length(${table.scoreReason}) <= 500`),
  check("leads_score_timestamp", sql`(${table.score} is null) = (${table.scoredAt} is null)`),
  check("leads_single_discard_state", sql`(${table.status} = 'DISCARDED' and ${table.discardReason} is not null) or (${table.status} <> 'DISCARDED' and ${table.discardReason} is null and ${table.discardNote} is null)`),
  check("leads_discard_note_length", sql`${table.discardNote} is null or char_length(${table.discardNote}) <= 200`),
  check("leads_other_discard_note", sql`${table.discardReason} <> 'OTHER' or (${table.discardNote} is not null and char_length(btrim(${table.discardNote})) > 0)`),
]);

export const leadConversions = pgTable("lead_conversions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  opportunityId: uuid("opportunity_id").notNull(),
  convertedByUserId: uuid("converted_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("lead_conversions_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("lead_conversions_tenant_lead_unique").on(table.tenantId, table.leadId),
  unique("lead_conversions_tenant_opportunity_unique").on(table.tenantId, table.opportunityId),
  foreignKey({ name: "lead_conversions_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "lead_conversions_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "lead_conversions_opportunity_customer_tenant_fk", columns: [table.tenantId, table.opportunityId, table.customerId], foreignColumns: [opportunities.tenantId, opportunities.id, opportunities.customerId] }),
  foreignKey({ name: "lead_conversions_user_tenant_fk", columns: [table.tenantId, table.convertedByUserId], foreignColumns: [users.tenantId, users.id] }),
  index("lead_conversions_tenant_customer_created_idx").on(table.tenantId, table.customerId, table.createdAt.desc(), table.id.desc()),
  index("lead_conversions_tenant_lead_created_idx").on(table.tenantId, table.leadId, table.createdAt.desc(), table.id.desc()),
]);

export const leadConversionBackfillIssues = pgTable("lead_conversion_backfill_issues", {
  id: bigint("id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
  issueKey: text("issue_key").notNull().unique(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  legacyCustomerId: uuid("legacy_customer_id"),
  legacyOpportunityIds: uuid("legacy_opportunity_ids").array(),
  evidence: jsonb("evidence").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("lead_conversion_backfill_issues_tenant_lead_idx").on(table.tenantId, table.leadId, table.createdAt.desc(), table.id.desc()),
]);

export const activities = pgTable("activities", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id"),
  customerId: uuid("customer_id"),
  opportunityId: uuid("opportunity_id"),
  userId: uuid("user_id").notNull(),
  type: activityType("type").notNull(),
  outcome: activityOutcome("outcome"),
  summary: text("summary").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "activities_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "activities_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "activities_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "activities_user_tenant_fk", columns: [table.tenantId, table.userId], foreignColumns: [users.tenantId, users.id] }),
  index("activities_tenant_lead_occurred_idx").on(table.tenantId, table.leadId, table.occurredAt.desc()),
  index("activities_tenant_customer_occurred_idx").on(table.tenantId, table.customerId, table.occurredAt.desc()),
  index("activities_tenant_opportunity_occurred_idx").on(table.tenantId, table.opportunityId, table.occurredAt.desc()),
  check("activities_single_subject", sql`num_nonnulls(${table.leadId}, ${table.customerId}, ${table.opportunityId}) = 1`),
  check("activities_summary_length", sql`char_length(${table.summary}) between 1 and 200`),
  check("activities_outcome_required", sql`(${table.type} = 'NOTE' and ${table.outcome} is null) or (${table.type} <> 'NOTE' and ${table.outcome} is not null)`),
]);

export const winReviews = pgTable("win_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  opportunityId: uuid("opportunity_id").notNull(),
  status: winReviewStatus("status").default("DRAFT").notNull(),
  summary: text("summary").default("").notNull(),
  metrics: jsonb("metrics").default({}).notNull(),
  evidence: jsonb("evidence").default([]).notNull(),
  dataGaps: jsonb("data_gaps").default([]).notNull(),
  generationFailedAt: timestamp("generation_failed_at", { withTimezone: true }),
  generationAttempts: integer("generation_attempts").default(0).notNull(),
  reviewedByUserId: uuid("reviewed_by_user_id"),
  reviewReason: text("review_reason"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("win_reviews_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("win_reviews_tenant_opportunity_unique").on(table.tenantId, table.opportunityId),
  foreignKey({ name: "win_reviews_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "win_reviews_reviewer_tenant_fk", columns: [table.tenantId, table.reviewedByUserId], foreignColumns: [users.tenantId, users.id] }),
  index("win_reviews_tenant_status_idx").on(table.tenantId, table.status, table.updatedAt.desc()),
  index("win_reviews_tenant_reviewer_idx").on(table.tenantId, table.reviewedByUserId, table.reviewedAt.desc()),
  check("win_reviews_review_fields", sql`
    (${table.status} = 'DRAFT' and ${table.reviewedByUserId} is null and ${table.reviewReason} is null and ${table.reviewedAt} is null)
    or (${table.status} in ('REVIEWED', 'REJECTED') and ${table.reviewedByUserId} is not null
      and ${table.reviewReason} is not null and char_length(btrim(${table.reviewReason})) > 0 and ${table.reviewedAt} is not null
      and ${table.generationFailedAt} is null and char_length(btrim(${table.summary})) > 0 and jsonb_array_length(${table.evidence}) > 0)
  `),
]);

export const salesPlaybooks = pgTable("sales_playbooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  familyKey: text("family_key").notNull(),
  version: integer("version").notNull(),
  status: salesPlaybookStatus("status").default("DRAFT").notNull(),
  name: text("name").notNull(),
  targetStage: opportunityStage("target_stage").notNull(),
  applicableIndustries: jsonb("applicable_industries").$type<string[]>().default([]).notNull(),
  excludedIndustries: jsonb("excluded_industries").$type<string[]>().default([]).notNull(),
  applicableRegions: jsonb("applicable_regions").$type<string[]>().default([]).notNull(),
  excludedRegions: jsonb("excluded_regions").$type<string[]>().default([]).notNull(),
  applicableCustomerSizes: jsonb("applicable_customer_sizes").$type<string[]>().default([]).notNull(),
  excludedCustomerSizes: jsonb("excluded_customer_sizes").$type<string[]>().default([]).notNull(),
  checkpoints: jsonb("checkpoints").$type<string[]>().default([]).notNull(),
  recommendedCadence: jsonb("recommended_cadence").$type<string[]>().default([]).notNull(),
  effectiveActions: jsonb("effective_actions").$type<string[]>().default([]).notNull(),
  commonRisks: jsonb("common_risks").$type<string[]>().default([]).notNull(),
  claimEvidence: jsonb("claim_evidence").$type<Record<string, string[]>>().default({}).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull(),
  publishedByUserId: uuid("published_by_user_id"),
  publishReason: text("publish_reason"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("sales_playbooks_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("sales_playbooks_tenant_family_version_unique").on(table.tenantId, table.familyKey, table.version),
  foreignKey({ name: "sales_playbooks_creator_tenant_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "sales_playbooks_publisher_tenant_fk", columns: [table.tenantId, table.publishedByUserId], foreignColumns: [users.tenantId, users.id] }),
  index("sales_playbooks_tenant_stage_published_idx").on(table.tenantId, table.targetStage, table.publishedAt.desc(), table.id.desc()).where(sql`${table.status} = 'PUBLISHED'`),
  index("sales_playbooks_tenant_family_version_idx").on(table.tenantId, table.familyKey, table.version.desc()),
]);

export const salesPlaybookSamples = pgTable("sales_playbook_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  playbookId: uuid("playbook_id").notNull(),
  winReviewId: uuid("win_review_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("sales_playbook_samples_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("sales_playbook_samples_playbook_review_unique").on(table.tenantId, table.playbookId, table.winReviewId),
  foreignKey({ name: "sales_playbook_samples_playbook_tenant_fk", columns: [table.tenantId, table.playbookId], foreignColumns: [salesPlaybooks.tenantId, salesPlaybooks.id] }),
  foreignKey({ name: "sales_playbook_samples_review_tenant_fk", columns: [table.tenantId, table.winReviewId], foreignColumns: [winReviews.tenantId, winReviews.id] }),
  index("sales_playbook_samples_tenant_playbook_idx").on(table.tenantId, table.playbookId),
]);

export const salesPlaybookFeedback = pgTable("sales_playbook_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  opportunityId: uuid("opportunity_id").notNull(),
  playbookId: uuid("playbook_id").notNull(),
  playbookFamilyKey: text("playbook_family_key").notNull(),
  playbookVersion: integer("playbook_version").notNull(),
  userId: uuid("user_id").notNull(),
  verdict: salesPlaybookFeedbackVerdict("verdict").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("sales_playbook_feedback_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("sales_playbook_feedback_subject_user_unique").on(table.tenantId, table.opportunityId, table.playbookId, table.userId),
  foreignKey({ name: "sales_playbook_feedback_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "sales_playbook_feedback_playbook_tenant_fk", columns: [table.tenantId, table.playbookId], foreignColumns: [salesPlaybooks.tenantId, salesPlaybooks.id] }),
  foreignKey({ name: "sales_playbook_feedback_user_tenant_fk", columns: [table.tenantId, table.userId], foreignColumns: [users.tenantId, users.id] }),
  index("sales_playbook_feedback_tenant_opportunity_idx").on(table.tenantId, table.opportunityId, table.updatedAt.desc()),
]);

export const pluginRegistry = pgTable("plugin_registry", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  pluginKey: text("plugin_key").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("plugin_registry_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("plugin_registry_tenant_key_unique").on(table.tenantId, table.pluginKey),
  index("plugin_registry_tenant_enabled_idx").on(table.tenantId, table.enabled, table.pluginKey),
]);

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id"),
  customerId: uuid("customer_id"),
  opportunityId: uuid("opportunity_id"),
  assigneeUserId: uuid("assignee_user_id").notNull(),
  type: taskType("type").notNull(),
  title: text("title"),
  note: text("note"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: taskStatus("status").default("OPEN").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("tasks_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "tasks_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "tasks_customer_tenant_fk", columns: [table.tenantId, table.customerId], foreignColumns: [customers.tenantId, customers.id] }),
  foreignKey({ name: "tasks_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "tasks_assignee_user_tenant_fk", columns: [table.tenantId, table.assigneeUserId], foreignColumns: [users.tenantId, users.id] }),
  uniqueIndex("tasks_open_lead_unique").on(table.leadId).where(sql`${table.status} = 'OPEN' and ${table.leadId} is not null`),
  uniqueIndex("tasks_open_customer_unique").on(table.customerId).where(sql`${table.status} = 'OPEN' and ${table.customerId} is not null`),
  uniqueIndex("tasks_open_opportunity_unique").on(table.opportunityId).where(sql`${table.status} = 'OPEN' and ${table.opportunityId} is not null`),
  index("tasks_tenant_assignee_status_due_idx").on(table.tenantId, table.assigneeUserId, table.status, table.dueAt),
  index("tasks_tenant_customer_status_due_idx").on(table.tenantId, table.customerId, table.status, table.dueAt),
  index("tasks_tenant_opportunity_status_due_idx").on(table.tenantId, table.opportunityId, table.status, table.dueAt),
  check("tasks_single_subject", sql`num_nonnulls(${table.leadId}, ${table.customerId}, ${table.opportunityId}) = 1`),
  check("tasks_completed_timestamp", sql`(${table.status} = 'DONE' and ${table.completedAt} is not null) or (${table.status} <> 'DONE' and ${table.completedAt} is null)`),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull(),
  type: notificationType("type").notNull(),
  taskId: uuid("task_id"),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("notifications_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "notifications_user_tenant_fk", columns: [table.tenantId, table.userId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "notifications_task_tenant_fk", columns: [table.tenantId, table.taskId], foreignColumns: [tasks.tenantId, tasks.id] }),
  foreignKey({ name: "notifications_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "notifications_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  index("notifications_task_type_created_idx").on(table.taskId, table.type, table.createdAt).where(sql`${table.taskId} is not null`),
  index("notifications_tenant_user_read_created_idx").on(table.tenantId, table.userId, table.readAt, table.createdAt.desc(), table.id.desc()),
  index("notifications_tenant_task_idx").on(table.tenantId, table.taskId),
  check("notifications_title_length", sql`char_length(${table.title}) between 1 and 100`),
  check("notifications_body_length", sql`${table.body} is null or char_length(${table.body}) between 1 and 200`),
  check("notifications_link_length", sql`${table.link} is null or char_length(${table.link}) between 1 and 300`),
]);

export const salesInsights = pgTable("sales_insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id"),
  opportunityId: uuid("opportunity_id"),
  code: text("code").notNull(),
  severity: insightSeverity("severity").notNull(),
  status: insightStatus("status").default("OPEN").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  suggestedAction: text("suggested_action").notNull(),
  suggestedDueAt: timestamp("suggested_due_at", { withTimezone: true }),
  evidence: jsonb("evidence").$type<unknown[]>().default([]).notNull(),
  sourceType: insightSource("source_type").default("RULE").notNull(),
  sourceVersion: text("source_version").notNull(),
  dismissReason: text("dismiss_reason"),
  acceptedTaskId: uuid("accepted_task_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  refreshFailedAt: timestamp("refresh_failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "sales_insights_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "sales_insights_opportunity_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "sales_insights_accepted_task_tenant_fk", columns: [table.tenantId, table.acceptedTaskId], foreignColumns: [tasks.tenantId, tasks.id] }),
  uniqueIndex("sales_insights_open_lead_code_unique").on(table.tenantId, table.leadId, table.code).where(sql`${table.status} = 'OPEN' and ${table.leadId} is not null`),
  uniqueIndex("sales_insights_open_opportunity_code_unique").on(table.tenantId, table.opportunityId, table.code).where(sql`${table.status} = 'OPEN' and ${table.opportunityId} is not null`),
  index("sales_insights_tenant_status_created_idx").on(table.tenantId, table.status, table.createdAt.desc()),
  index("sales_insights_tenant_lead_idx").on(table.tenantId, table.leadId, table.createdAt.desc()),
  index("sales_insights_tenant_opportunity_idx").on(table.tenantId, table.opportunityId, table.createdAt.desc()),
  check("sales_insights_single_subject", sql`num_nonnulls(${table.leadId}, ${table.opportunityId}) = 1`),
  check("sales_insights_evidence_array", sql`jsonb_typeof(${table.evidence}) = 'array'`),
  check("sales_insights_status_fields", sql`(${table.status} = 'DISMISSED' and ${table.dismissReason} is not null and ${table.acceptedTaskId} is null) or (${table.status} = 'ACCEPTED' and ${table.dismissReason} is null and ${table.acceptedTaskId} is not null) or (${table.status} in ('OPEN', 'EXPIRED') and ${table.dismissReason} is null and ${table.acceptedTaskId} is null)`),
  check("sales_insights_code_length", sql`char_length(${table.code}) between 1 and 100`),
  check("sales_insights_title_length", sql`char_length(${table.title}) between 1 and 100`),
  check("sales_insights_summary_length", sql`char_length(${table.summary}) between 1 and 500`),
  check("sales_insights_action_length", sql`char_length(${table.suggestedAction}) between 1 and 500`),
  check("sales_insights_source_version_length", sql`char_length(${table.sourceVersion}) between 1 and 100`),
  check("sales_insights_dismiss_reason_length", sql`${table.dismissReason} is null or char_length(${table.dismissReason}) between 1 and 100`),
]);

export const scoreRules = pgTable("score_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  field: text("field").notNull(),
  operator: scoreOperator("operator").notNull(),
  value: text("value"),
  weight: integer("weight").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("score_rules_tenant_id_id_unique").on(table.tenantId, table.id),
  index("score_rules_tenant_enabled_order_idx").on(table.tenantId, table.enabled, table.sortOrder),
  index("score_rules_tenant_active_order_idx").on(table.tenantId, table.sortOrder, table.id).where(sql`${table.deletedAt} is null`),
  check("score_rules_label_length", sql`char_length(${table.label}) between 1 and 30`),
  check("score_rules_field_allowed", sql`${table.field} in ('company_name', 'contact_email', 'title', 'source', 'created_hour', 'activity_count', 'last_activity_outcome')`),
  check("score_rules_value_by_operator", sql`(${table.operator} in ('EXISTS', 'NOT_EXISTS') and ${table.value} is null) or (${table.operator} not in ('EXISTS', 'NOT_EXISTS') and ${table.value} is not null and char_length(btrim(${table.value})) between 1 and 200)`),
  check("score_rules_numeric_operator_field", sql`${table.operator} not in ('GT', 'GTE') or ${table.field} in ('created_hour', 'activity_count')`),
  check("score_rules_weight_range", sql`${table.weight} between -100 and 100`),
  check("score_rules_sort_order_nonnegative", sql`${table.sortOrder} >= 0`),
]);

export const scoreFeedback = pgTable("score_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").notNull(),
  userId: uuid("user_id").notNull(),
  scoreAtFeedback: integer("score_at_feedback").notNull(),
  verdict: scoreFeedbackVerdict("verdict").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("score_feedback_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("score_feedback_lead_user_unique").on(table.leadId, table.userId),
  foreignKey({ name: "score_feedback_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }).onDelete("cascade"),
  foreignKey({ name: "score_feedback_user_tenant_fk", columns: [table.tenantId, table.userId], foreignColumns: [users.tenantId, users.id] }).onDelete("cascade"),
  index("score_feedback_tenant_lead_idx").on(table.tenantId, table.leadId, table.createdAt.desc()),
  check("score_feedback_score_range", sql`${table.scoreAtFeedback} between 0 and 100`),
]);

export const leadStatusHistory = pgTable("lead_status_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  leadId: uuid("lead_id").notNull(),
  fromStatus: leadStatus("from_status"),
  toStatus: leadStatus("to_status").notNull(),
  reason: text("reason"),
  actorUserId: uuid("actor_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "lead_status_history_lead_tenant_fk", columns: [table.tenantId, table.leadId], foreignColumns: [leads.tenantId, leads.id] }),
  foreignKey({ name: "lead_status_history_actor_user_tenant_fk", columns: [table.tenantId, table.actorUserId], foreignColumns: [users.tenantId, users.id] }),
  index("lead_status_history_tenant_lead_created_idx").on(table.tenantId, table.leadId, table.createdAt.desc(), table.id.desc()),
  check("lead_status_history_transition_check", sql`${table.fromStatus} is null or ${table.fromStatus} <> ${table.toStatus}`),
  check("lead_status_history_reason_length", sql`${table.reason} is null or char_length(${table.reason}) <= 200`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: uuid("actor_user_id").notNull(),
  action: text("action").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "audit_logs_actor_user_tenant_fk", columns: [table.tenantId, table.actorUserId], foreignColumns: [users.tenantId, users.id] }),
  index("audit_logs_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
  index("audit_logs_tenant_subject_idx").on(table.tenantId, table.subjectType, table.subjectId),
  check("audit_logs_action_length", sql`char_length(${table.action}) between 1 and 100`),
  check("audit_logs_subject_type_length", sql`char_length(${table.subjectType}) between 1 and 50`),
]);

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  pricingModel: pricingModel("pricing_model").default("ONE_TIME").notNull(),
  unitPrice: integer("unit_price").default(0).notNull(),
  unit: text("unit").default("套").notNull(),
  description: text("description"),
  status: productStatus("status").default("ACTIVE").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("products_tenant_id_id_unique").on(table.tenantId, table.id),
  uniqueIndex("products_tenant_code_unique").on(table.tenantId, table.code).where(sql`${table.deletedAt} is null`),
  index("products_tenant_category_idx").on(table.tenantId, table.category).where(sql`${table.deletedAt} is null`),
  index("products_tenant_status_idx").on(table.tenantId, table.status).where(sql`${table.deletedAt} is null`),
  check("products_name_length", sql`char_length(${table.name}) between 1 and 100`),
  check("products_code_length", sql`char_length(${table.code}) between 1 and 50`),
  check("products_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
]);

export const opportunityLineItems = pgTable("opportunity_line_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  opportunityId: uuid("opportunity_id").notNull(),
  productId: uuid("product_id").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: integer("unit_price").default(0).notNull(),
  discountRate: integer("discount_rate").default(100).notNull(),
  subtotalAmount: integer("subtotal_amount").default(0).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("line_items_tenant_id_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "line_items_opp_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  foreignKey({ name: "line_items_product_tenant_fk", columns: [table.tenantId, table.productId], foreignColumns: [products.tenantId, products.id] }),
  index("line_items_tenant_opp_idx").on(table.tenantId, table.opportunityId),
  index("line_items_tenant_product_idx").on(table.tenantId, table.productId),
  check("line_items_quantity_positive", sql`${table.quantity} >= 1`),
  check("line_items_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
  check("line_items_discount_range", sql`${table.discountRate} between 1 and 100`),
  check("line_items_subtotal_non_negative", sql`${table.subtotalAmount} >= 0`),
]);

export const dealInterventions = pgTable("deal_interventions", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id),
  requesterUserId: uuid("requester_user_id").notNull().references(() => users.id),
  assignedManagerId: uuid("assigned_manager_id").references(() => users.id),
  interventionType: interventionType("intervention_type").default("STRATEGY_COACHING").notNull(),
  status: interventionStatus("status").default("REQUESTED").notNull(),
  requestNote: text("request_note").notNull(),
  managerFeedback: text("manager_feedback"),
  coachingNotes: text("coaching_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "deal_interventions_opp_tenant_fk", columns: [table.tenantId, table.opportunityId], foreignColumns: [opportunities.tenantId, opportunities.id] }),
  index("deal_interventions_tenant_opp_idx").on(table.tenantId, table.opportunityId),
  index("deal_interventions_tenant_status_idx").on(table.tenantId, table.status, table.createdAt.desc()),
  index("deal_interventions_tenant_manager_idx").on(table.tenantId, table.assignedManagerId, table.status),
  check("deal_interventions_request_note_len", sql`char_length(${table.requestNote}) between 1 and 500`),
]);

export const salesSchedules = pgTable("sales_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  scheduleType: scheduleType("schedule_type").default("FOLLOW_UP").notNull(),
  leadId: uuid("lead_id").references(() => leads.id),
  customerId: uuid("customer_id").references(() => customers.id),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  note: text("note"),
  status: scheduleStatus("status").default("PENDING").notNull(),
  source: text("source").default("MANUAL").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({ name: "sales_schedules_user_tenant_fk", columns: [table.tenantId, table.userId], foreignColumns: [users.tenantId, users.id] }),
  index("sales_schedules_tenant_user_time_idx").on(table.tenantId, table.userId, table.startAt.asc()),
  index("sales_schedules_tenant_status_idx").on(table.tenantId, table.status, table.startAt.asc()),
  check("sales_schedules_title_len", sql`char_length(${table.title}) between 1 and 100`),
]);

export const publicPoolRules = pgTable("public_pool_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ruleType: text("rule_type").notNull(),
  thresholdDays: integer("threshold_days").default(7).notNull(),
  protectWindowDays: integer("protect_window_days").default(3).notNull(),
  notifyBeforeHours: integer("notify_before_hours").default(24).notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("public_pool_rules_tenant_rule_type_unique").on(table.tenantId, table.ruleType),
  index("public_pool_rules_tenant_idx").on(table.tenantId, table.isEnabled),
  check("public_pool_rules_threshold_days_check", sql`${table.thresholdDays} >= 1 and ${table.thresholdDays} <= 365`),
  check("public_pool_rules_protect_days_check", sql`${table.protectWindowDays} >= 0 and ${table.protectWindowDays} <= 90`),
  check("public_pool_rules_notify_hours_check", sql`${table.notifyBeforeHours} >= 0 and ${table.notifyBeforeHours} <= 168`),
]);

export const workplaceIntegrations = pgTable("workplace_integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  platform: text("platform").notNull(),
  name: text("name").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  secretKey: text("secret_key"),
  events: jsonb("events").default(sql`'["DEAL_WON", "INTERVENTION_REQUESTED", "OPPORTUNITY_CREATED"]'::jsonb`).notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("workplace_integrations_tenant_id_id_unique").on(table.tenantId, table.id),
  index("workplace_integrations_tenant_idx").on(table.tenantId, table.isEnabled),
  check("workplace_integrations_name_len", sql`char_length(${table.name}) between 1 and 50`),
  check("workplace_integrations_platform_check", sql`${table.platform} in ('WECOM', 'DINGTALK', 'FEISHU', 'GENERIC_WEBHOOK')`),
]);

export const workplaceDirectoryConfigs = pgTable("workplace_directory_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  platform: text("platform").notNull(),
  corpId: text("corp_id").notNull(),
  secret: text("secret").notNull(),
  syncMode: text("sync_mode").default("INCREMENTAL").notNull(),
  defaultRole: text("default_role").default("SALES").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncResult: jsonb("last_sync_result"),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("workplace_directory_tenant_platform_unique").on(table.tenantId, table.platform),
  index("workplace_directory_tenant_idx").on(table.tenantId, table.isEnabled),
  check("workplace_directory_platform_check", sql`${table.platform} in ('WECOM', 'DINGTALK', 'FEISHU')`),
  check("workplace_directory_sync_mode_check", sql`${table.syncMode} in ('FULL', 'INCREMENTAL')`),
  check("workplace_directory_default_role_check", sql`${table.defaultRole} in ('SALES', 'MANAGER', 'ADMIN')`),
]);

export const aiRecommendations = pgTable("ai_recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  recommendationType: aiRecommendationType("recommendation_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  suggestedAction: jsonb("suggested_action"),
  confidenceScore: numeric("confidence_score", { precision: 5, scale: 2 }).default("90.00").notNull(),
  isApplied: boolean("is_applied").default(false).notNull(),
  feedbackVerdict: salesPlaybookFeedbackVerdict("feedback_verdict"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_rec_tenant_opp_idx").on(table.tenantId, table.opportunityId).where(sql`${table.opportunityId} is not null`),
  index("ai_rec_tenant_lead_idx").on(table.tenantId, table.leadId).where(sql`${table.leadId} is not null`),
  index("ai_rec_tenant_user_idx").on(table.tenantId, table.userId).where(sql`${table.userId} is not null`),
  index("ai_rec_tenant_type_idx").on(table.tenantId, table.recommendationType),
]);

export const securityComplianceConfigs = pgTable("security_compliance_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  isAiCopilotEnabled: boolean("is_ai_copilot_enabled").default(false).notNull(),
  aiProvider: text("ai_provider").default("BUILTIN").notNull(),
  aiApiKey: text("ai_api_key"),
  aiApiEndpoint: text("ai_api_endpoint"),
  aiModelName: text("ai_model_name").default("deepseek-chat").notNull(),
  aiTemperature: numeric("ai_temperature", { precision: 3, scale: 2 }).default("0.30").notNull(),
  isPhoneMaskingEnabled: boolean("is_phone_masking_enabled").default(false).notNull(),
  isEmailMaskingEnabled: boolean("is_email_masking_enabled").default(false).notNull(),
  exportRequiresApproval: boolean("export_requires_approval").default(false).notNull(),
  sessionTimeoutMinutes: integer("session_timeout_minutes").default(120).notNull(),
  watermarkEnabled: boolean("watermark_enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("security_compliance_tenant_unique").on(table.tenantId),
  index("security_compliance_tenant_idx").on(table.tenantId),
  check("security_session_timeout_check", sql`${table.sessionTimeoutMinutes} between 15 and 1440`),
]);

export const aiPromptTemplates = pgTable("ai_prompt_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  scene: text("scene").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  userPromptTemplate: text("user_prompt_template").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  version: integer("version").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_prompt_tenant_scene_idx").on(table.tenantId, table.scene, table.isActive),
]);

export const aiQualityInspections = pgTable("ai_quality_inspections", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  inspectorAgent: text("inspector_agent").default("DEAL_QUALITY_AGENT").notNull(),
  score: integer("score").default(80).notNull(),
  verdict: text("verdict").default("PASSED").notNull(),
  dimensions: jsonb("dimensions").$type<Record<string, boolean | number | string>>().default({}).notNull(),
  findings: jsonb("findings").$type<string[]>().default([]).notNull(),
  actionRecommendations: jsonb("action_recommendations").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_quality_tenant_opp_idx").on(table.tenantId, table.opportunityId, table.createdAt.desc()),
]);

export const aiAgentLearningLogs = pgTable("ai_agent_learning_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  sourceType: text("source_type").default("WIN_REVIEW").notNull(),
  sourceId: uuid("source_id"),
  topic: text("topic").notNull(),
  extractedStrategy: text("extracted_strategy").notNull(),
  sampleDialogue: text("sample_dialogue"),
  effectivenessScore: numeric("effectiveness_score", { precision: 5, scale: 2 }).default("95.00").notNull(),
  isPromotedToPool: boolean("is_promoted_to_pool").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ai_learning_tenant_src_idx").on(table.tenantId, table.sourceType, table.createdAt.desc()),
]);

export const customRoles = pgTable("custom_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(),
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("custom_roles_tenant_code_unique").on(table.tenantId, table.code),
  index("custom_roles_tenant_idx").on(table.tenantId, table.createdAt.desc()),
]);

export const userRoleAssignments = pgTable("user_role_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => customRoles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("user_role_assignments_unique").on(table.tenantId, table.userId, table.roleId),
  index("user_role_assignments_tenant_user_idx").on(table.tenantId, table.userId),
  index("user_role_assignments_tenant_role_idx").on(table.tenantId, table.roleId),
]);

export const leadSourceKeys = pgTable("lead_source_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  sourceKey: text("source_key").notNull(),
  tokenHash: text("token_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull(),
  rateWindowStartedAt: timestamp("rate_window_started_at", { withTimezone: true }),
  rateWindowCount: integer("rate_window_count").default(0).notNull(),
  scopes: jsonb("scopes").$type<string[]>().default(["leads:write"]).notNull(),
  rateLimitPerMinute: integer("rate_limit_per_minute").default(60).notNull(),
  allowedIpRanges: text("allowed_ip_ranges"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("lead_source_keys_tenant_source_unique").on(table.tenantId, table.sourceKey),
  unique("lead_source_keys_token_hash_unique").on(table.tokenHash),
  index("lead_source_keys_tenant_idx").on(table.tenantId, table.createdAt.desc()),
]);

export const leadIntakeRequests = pgTable("lead_intake_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sourceKeyId: uuid("source_key_id").notNull().references(() => leadSourceKeys.id),
  idempotencyKey: text("idempotency_key").notNull(),
  externalId: text("external_id"),
  leadId: uuid("lead_id").notNull().references(() => leads.id),
  requestFingerprint: text("request_fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("lead_intake_requests_source_key_unique").on(table.sourceKeyId, table.idempotencyKey),
  index("lead_intake_requests_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
]);

export const customerCollaborationSettings = pgTable("customer_collaboration_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  allowMultiSalesFollowup: boolean("allow_multi_sales_followup").default(false).notNull(),
  requireProductExclusivity: boolean("require_product_exclusivity").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("customer_collaboration_settings_tenant_unique").on(table.tenantId),
]);

export const salesQuotas = pgTable("sales_quotas", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
  year: integer("year").notNull(),
  periodType: text("period_type").default("MONTHLY").notNull(),
  periodKey: text("period_key").notNull(),
  targetAmountCents: bigint("target_amount_cents", { mode: "bigint" }).default(sql`0`).notNull(),
  targetDealsCount: integer("target_deals_count").default(0).notNull(),
  targetLeadsCount: integer("target_leads_count").default(0).notNull(),
  note: text("note"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("sales_quotas_tenant_user_period_unique").on(table.tenantId, table.userId, table.periodType, table.periodKey),
  index("sales_quotas_tenant_period_idx").on(table.tenantId, table.periodType, table.periodKey),
  index("sales_quotas_tenant_user_year_idx").on(table.tenantId, table.userId, table.year),
]);

export type PublicPoolRule = typeof publicPoolRules.$inferSelect;
export type WorkplaceIntegration = typeof workplaceIntegrations.$inferSelect;
export type WorkplaceDirectoryConfig = typeof workplaceDirectoryConfigs.$inferSelect;
export type AiRecommendation = typeof aiRecommendations.$inferSelect;
export type SecurityComplianceConfig = typeof securityComplianceConfigs.$inferSelect;
export type AiPromptTemplate = typeof aiPromptTemplates.$inferSelect;
export type AiQualityInspection = typeof aiQualityInspections.$inferSelect;
export type AiAgentLearningLog = typeof aiAgentLearningLogs.$inferSelect;
export type CustomRole = typeof customRoles.$inferSelect;
export type UserRoleAssignment = typeof userRoleAssignments.$inferSelect;
export type SalesQuota = typeof salesQuotas.$inferSelect;
export type CustomerCollaborationSetting = typeof customerCollaborationSettings.$inferSelect;
export type LeadConversionBackfillIssue = typeof leadConversionBackfillIssues.$inferSelect;
export type LeadSourceKey = typeof leadSourceKeys.$inferSelect;
export type LeadIntakeRequest = typeof leadIntakeRequests.$inferSelect;

export const pluginRateLimits = pgTable("plugin_rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
  count: integer("count").default(1).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uq_plugin_rate_limits_tenant_subject").on(table.tenantId, table.subject),
  index("idx_plugin_rate_limits_tenant_subj").on(table.tenantId, table.subject),
]);

export type PluginRateLimit = typeof pluginRateLimits.$inferSelect;

export const aiInsightReportKind = pgEnum("ai_insight_report_kind", ["CHAMPION_ANALYSIS", "COMPANY_PROFILE"]);
export const aiInsightConfidence = pgEnum("ai_insight_confidence", ["HIGH", "MEDIUM", "LOW"]);

export const aiAgentTraces = pgTable("ai_agent_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  task: text("task").notNull(),
  toolsUsed: jsonb("tools_used").default([]).notNull(),
  rounds: integer("rounds").notNull(),
  tokenUsage: jsonb("token_usage").default({}).notNull(),
  outcome: text("outcome").notNull(),
  opportunityId: uuid("opportunity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aiInsightReports = pgTable("ai_insight_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  kind: aiInsightReportKind("kind").notNull(),
  period: varchar("period", { length: 10 }).notNull(),
  content: text("content").notNull(),
  evidence: jsonb("evidence").default({}).notNull(),
  sampleSize: integer("sample_size").default(0).notNull(),
  confidence: aiInsightConfidence("confidence").default("MEDIUM").notNull(),
  publicSummary: text("public_summary"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("ai_insight_reports_tenant_id_id_unique").on(table.tenantId, table.id),
  unique("ai_insight_reports_tenant_kind_period_unique").on(table.tenantId, table.kind, table.period),
  index("ai_insight_reports_tenant_kind_period_idx").on(table.tenantId, table.kind, table.period),
  index("ai_insight_reports_tenant_created_idx").on(table.tenantId, table.createdAt.desc()),
]);

export type AiInsightReport = typeof aiInsightReports.$inferSelect;
