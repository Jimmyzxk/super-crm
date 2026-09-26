/**
 * 纯核心数据演示种子（Super CRM 开源版 / AGPL-3.0）
 *
 * 定位：README「快速开始」承诺的 `pnpm db:seed:demo`——克隆者跑完就能在界面上
 * 看到一份「看起来像真实企业在用」的数据，而不是验收用的最小样本。
 *
 * 与 scripts/seed-acceptance.ts 的分工：
 *   - seed-acceptance：验收闭环用的**最小**数据集（1 租户 2 用户 1 客户 1 商机）。
 *   - seed-demo-core（本文件）：演示用的**规模**数据集（9 用户 / 88 线索 / 46 客户 /
 *     50 商机 / 90 任务 / 60 活动 …），覆盖全部核心页面的非空状态。
 *
 * 三条硬性设计约束（与插件剥离后的发行形态强相关）：
 *  1. **只写核心表**。合同 / 订单 / 项目 / 知识库等业务表随闭源插件剥离，schema 中
 *     已不存在；本脚本不引用任何 `plugin_` 前缀的表，也不引用插件语义的通知类型
 *     （CONTRACT_SIGNED / ORDER_CONFIRMED / …）与 `form:` 线索来源。
 *  2. **幂等**。全部实体主键用 `deterministicUuidV5` 派生（`scripts/seed/identity.ts`），
 *     写入一律 `on conflict (id) do nothing`；无 UUID 主键的表
 *     （lead_status_history）用 `insert … where not exists` 去重。
 *     重复执行不报错、不产生重复数据。
 *  3. **生产保护**。复用 `scripts/seed/guard.ts` 的 fail-closed 白名单
 *     （localhost/127.0.0.1 + 库名含 demo/showcase/salescrm_dev/salescrm_test，
 *     或显式 `SEED_CONFIRM=yes`），另加 `NODE_ENV=production` 硬拦截。
 *
 * 口径约定：
 *   - **金额单位为「分」**（与 src/core/shared/display.ts `formatAmountInCents` 一致），
 *     订阅年费 ¥49,800 记作 4980000。
 *   - 业务时区 Asia/Shanghai（src/core/shared/tz）："今日到期""当月配额"按上海墙钟判定。
 *   - 明细小计 `subtotal_amount = unit_price × quantity`：种子不使用折扣
 *     （discount_rate 恒为 100），与 src/core/products/service.ts 的
 *     `round(qty × unitPrice × discount / 100)` 在 discount=100 时完全一致。
 *   - **全部为公开可合成信息**：人名/公司名均为化名，手机号统一 `138` 开头且落在
 *     1381000xxxx 保留演示号段，邮箱一律 example.com。不得混入真实客户信息。
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { normalizeEmail } from "../src/core/auth/types";
import { localDateValue, addShanghaiDays } from "../src/core/shared/date";
import { buildQuotaPeriodKey } from "../src/core/shared/period";
import { zonedMonthStart, zonedWallClock, zonedWallClockToUtc, zonedYearMonth } from "../src/core/shared/tz";
import { assertSeedAllowed } from "./seed/guard";
import { DeterministicRNG, SEED_ADVISORY_LOCK_ID, SEED_TENANT_ID, deterministicUuidV5 } from "./seed/identity";

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const adminEmail = normalizeEmail(process.env.DEV_ADMIN_EMAIL ?? "admin@example.com");
const adminPassword = process.env.DEV_ADMIN_PASSWORD ?? "password123";

const TENANT_NAME = "星海智造科技（演示租户）";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const CHUNK = 100;

const rng = new DeterministicRNG(20260926);
/** 全部实体主键的命名空间前缀（不同实体类型互不撞号） */
const id = (entity: string, seq: number | string): string => deterministicUuidV5(`demo.${entity}`, seq);

// ---------------------------------------------------------------------------
// 合成语料（全部虚构：姓名为化名，公司名为虚构名，邮箱 example.com）
// ---------------------------------------------------------------------------

const COMPANY_PREFIX = ["星海", "云麓", "远山", "锦程", "恒通", "瑞宁", "弘毅", "联捷", "博远", "中启"];
const COMPANY_CORE = [
  "智能装备", "精密电子", "新能源科技", "医疗器械", "汽车部件",
  "工业软件", "新材料", "供应链", "食品科技", "商业运营",
];
const COMPANY_SUFFIX = ["有限公司", "股份有限公司", "集团有限公司", "实业有限公司", "控股有限公司"];
const INDUSTRIES = [
  "装备制造", "精密电子", "新能源", "医疗器械", "汽车零部件",
  "工业软件", "化工材料", "物流供应链", "食品饮料", "商业地产",
];
const REGIONS = ["华东", "华南", "华北", "华中", "西南", "东北", "西北"];
const CUSTOMER_SIZES = ["1-20", "21-100", "101-500", "501-1000", "1000+"];
const SURNAMES = ["陆", "沈", "秦", "孟", "邵", "傅", "祁", "樊", "路", "晏", "冉", "凌", "骆", "岑", "郗"];
const TITLES = ["经理", "总监", "总工", "主管", "工程师", "组长", "副总", "专员"];
const LEAD_CHANNELS = ["官网表单", "400 电话", "展会", "老客户转介绍", "伙伴推荐", "内容投放", "陌生拜访"];

type ContactDraft = {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  email: string | null;
  title: string;
  roleTag: "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER";
  isPrimary: boolean;
};
type CustomerDraft = {
  id: string;
  seq: number;
  name: string;
  industry: string;
  region: string;
  size: string;
  customerType: "ENTERPRISE" | "INDIVIDUAL";
  ownerIndex: number;
  claimedDaysAgo: number;
  createdDaysAgo: number;
};
type LeadDraft = {
  id: string;
  seq: number;
  status: "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "DISCARDED";
  ownerIndex: number | null;
  companyName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  title: string;
  source: string;
  channel: string;
  score: number | null;
  discardReason: string | null;
  discardNote: string | null;
  receivedDaysAgo: number;
};
type OpportunityDraft = {
  id: string;
  seq: number;
  customer: CustomerDraft;
  ownerIndex: number;
  primaryContact: ContactDraft;
  fromLead: LeadDraft | null;
  stage: "DISCOVERY" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
  expectedAmount: number;
  expectedCloseAt: string;
  actualAmount: number | null;
  actualCloseAt: string | null;
  lostReason: string | null;
  lostNote: string | null;
  createdDaysAgo: number;
  stageEnteredDaysAgo: number;
  lineItems: { productIndex: number; quantity: number }[];
};

/** 全部手机号走同一保留演示号段 1381000xxxx，按全局序号分配，天然不重复 */
let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `138${String(10_000_000 + phoneSeq)}`;
}

/** 公司名按序号做笛卡尔展开，保证前 500 个互不相同 */
function companyName(index: number): string {
  const prefix = COMPANY_PREFIX[index % COMPANY_PREFIX.length];
  const core = COMPANY_CORE[Math.floor(index / COMPANY_PREFIX.length) % COMPANY_CORE.length];
  const suffix = COMPANY_SUFFIX[Math.floor(index / (COMPANY_PREFIX.length * COMPANY_CORE.length)) % COMPANY_SUFFIX.length];
  return `${prefix}${core}${suffix}`;
}

/** 联系人化名：姓 + 职级，按序号展开 */
function contactName(index: number): string {
  return `${SURNAMES[index % SURNAMES.length]}${TITLES[Math.floor(index / SURNAMES.length) % TITLES.length]}`;
}

// ---------------------------------------------------------------------------
// 时间锚点：全部以「运行时刻」为基准相对偏移，保证「今日到期 / 逾期 / 当月配额」
// 在任意一天执行都成立（业务时区 Asia/Shanghai）。
// ---------------------------------------------------------------------------

const NOW_MS = Date.now();
const WALL = zonedWallClock(new Date(NOW_MS));
const YEAR_MONTH = zonedYearMonth(new Date(NOW_MS));
const MONTH_START_MS = zonedMonthStart(YEAR_MONTH.year, YEAR_MONTH.month).getTime();
/**
 * 「今日到期」任务统一落在这个时刻：默认 18:00（自然工时），若执行时刻已逼近/超过
 * 18:00 则退到当日 23:59 —— 无论一天中的哪个时刻运行种子，任务都**落在业务时区的
 * 今天且尚未到期**，工作台的「今日 / 逾期」两个队列都能看到内容。
 */
const TODAY_DUE_MS = (() => {
  const at18 = zonedWallClockToUtc(WALL.year, WALL.month, WALL.day, 18, 0).getTime();
  if (at18 > NOW_MS + 60 * 60_000) return at18;
  return zonedWallClockToUtc(WALL.year, WALL.month, WALL.day + 1, 0, 0).getTime() - 60_000;
})();

const iso = (ms: number): string => new Date(ms).toISOString();
const shift = (days: number, hours = 0): string => iso(NOW_MS + days * DAY_MS + hours * HOUR_MS);
/** 业务时区墙钟下的 YYYY-MM-DD（date 列用） */
const businessDate = (ms: number): string => localDateValue(new Date(ms));
const businessDateFromNow = (days: number): string => addShanghaiDays(days, new Date(NOW_MS));

// ---------------------------------------------------------------------------
// 数据规划
// ---------------------------------------------------------------------------

const SALES_USER_DEFS = [
  { email: "sales1@example.com", name: "演示销售·林一", department: 0, target: 60_000_000, deals: 2, leads: 12 },
  { email: "sales2@example.com", name: "演示销售·周二", department: 0, target: 55_000_000, deals: 2, leads: 10 },
  { email: "sales3@example.com", name: "演示销售·郑三", department: 0, target: 65_000_000, deals: 2, leads: 14 },
  { email: "sales4@example.com", name: "演示销售·王四", department: 1, target: 50_000_000, deals: 1, leads: 10 },
  { email: "sales5@example.com", name: "演示销售·李五", department: 1, target: 60_000_000, deals: 2, leads: 12 },
  { email: "sales6@example.com", name: "演示销售·赵六", department: 1, target: 45_000_000, deals: 1, leads: 8 },
];
const MANAGER_USER_DEFS = [
  { email: "manager1@example.com", name: "演示主管·沈一", department: 0, title: "销售一部负责人" },
  { email: "manager2@example.com", name: "演示主管·柳二", department: 1, title: "销售二部负责人" },
];
const DEPARTMENT_DEFS = [
  { key: "sales-1", name: "销售一部", sortOrder: 10, leaderEmail: "manager1@example.com" },
  { key: "sales-2", name: "销售二部", sortOrder: 20, leaderEmail: "manager2@example.com" },
  { key: "marketing", name: "市场与线索运营部", sortOrder: 30, leaderEmail: "admin@example.com" },
];
/** 产品目录：unitPrice 单位为「分」 */
const PRODUCT_DEFS = [
  { code: "CRM-STD", name: "标准版订阅（年）", category: "软件订阅", pricingModel: "SUBSCRIPTION_YEARLY", unitPrice: 1_980_000, unit: "套/年", status: "ACTIVE" },
  { code: "CRM-PRO", name: "专业版订阅（年）", category: "软件订阅", pricingModel: "SUBSCRIPTION_YEARLY", unitPrice: 4_980_000, unit: "套/年", status: "ACTIVE" },
  { code: "IMPL-MES", name: "产线数字化实施服务", category: "实施服务", pricingModel: "ONE_TIME", unitPrice: 12_000_000, unit: "项目", status: "ACTIVE" },
  { code: "DATA-MIG", name: "历史数据迁移服务", category: "实施服务", pricingModel: "ONE_TIME", unitPrice: 4_500_000, unit: "项目", status: "ACTIVE" },
  { code: "TRAIN-ON", name: "销售团队训练营", category: "培训赋能", pricingModel: "MAN_MONTH", unitPrice: 3_000_000, unit: "人月", status: "ACTIVE" },
  { code: "SUPPORT-A", name: "专属支持包（年）", category: "运维服务", pricingModel: "SUBSCRIPTION_YEARLY", unitPrice: 1_200_000, unit: "套/年", status: "ACTIVE" },
  { code: "LEGACY-RPT", name: "旧版报表模块（已归档）", category: "软件订阅", pricingModel: "ONE_TIME", unitPrice: 800_000, unit: "套", status: "ARCHIVED" },
];

const COUNTS = { customers: 46, leads: 88, opportunities: 50 };

const LEAD_STATUS_PLAN: LeadDraft["status"][] = [
  ...Array(18).fill("NEW"),
  ...Array(20).fill("CONTACTED"),
  ...Array(14).fill("QUALIFIED"),
  ...Array(22).fill("CONVERTED"),
  ...Array(14).fill("DISCARDED"),
];
const DISCARD_REASONS = ["NO_NEED", "NO_BUDGET", "WRONG_CONTACT", "INVALID_INFO", "COMPETITOR", "OTHER"];
const STAGE_PLAN: OpportunityDraft["stage"][] = [
  ...Array(18).fill("DISCOVERY"),
  ...Array(14).fill("PROPOSAL"),
  ...Array(10).fill("NEGOTIATION"),
  ...Array(5).fill("WON"),
  ...Array(3).fill("LOST"),
];
const LOST_REASONS = ["PRICE", "COMPETITOR", "NO_BUDGET", "NO_DECISION", "TIMING"];

function buildCustomers(): CustomerDraft[] {
  return Array.from({ length: COUNTS.customers }, (_, seq) => {
    const createdDaysAgo = 40 + ((seq * 13) % 320);
    return {
      id: id("customer", seq),
      seq,
      name: companyName(seq),
      industry: INDUSTRIES[seq % INDUSTRIES.length],
      region: REGIONS[(seq * 3) % REGIONS.length],
      size: CUSTOMER_SIZES[(seq * 2) % CUSTOMER_SIZES.length],
      customerType: seq === 7 ? "INDIVIDUAL" : "ENTERPRISE",
      ownerIndex: seq % SALES_USER_DEFS.length,
      claimedDaysAgo: 5 + ((seq * 7) % 300),
      createdDaysAgo,
    };
  });
}

function buildContacts(customers: CustomerDraft[]): Map<number, ContactDraft[]> {
  const byCustomer = new Map<number, ContactDraft[]>();
  let counter = 0;
  for (const customer of customers) {
    const count = 1 + (customer.seq % 3);
    const list: ContactDraft[] = [];
    for (let i = 0; i < count; i += 1) {
      counter += 1;
      const isPrimary = i === 0;
      const roleTag: ContactDraft["roleTag"] = isPrimary
        ? (customer.seq % 2 === 0 ? "DECISION_MAKER" : "PROCUREMENT")
        : (["TECH_EVALUATOR", "USER", "FINANCE", "OTHER"] as const)[(customer.seq + i) % 4];
      list.push({
        id: id("contact", counter),
        customerId: customer.id,
        name: contactName(counter),
        phone: nextPhone(),
        email: `contact${counter}@example.com`,
        title: TITLES[(customer.seq + i) % TITLES.length],
        roleTag,
        isPrimary,
      });
    }
    byCustomer.set(customer.seq, list);
  }
  return byCustomer;
}

function buildLeads(): LeadDraft[] {
  const plan = rng.shuffle(LEAD_STATUS_PLAN);
  return Array.from({ length: COUNTS.leads }, (_, seq) => {
    const status = plan[seq];
    // 每 5 条留 1 条未认领（owner_user_id 为空）作为公海线索
    const isPool = status !== "CONVERTED" && status !== "DISCARDED" && seq % 5 === 0;
    const ownerIndex = isPool ? null : seq % SALES_USER_DEFS.length;
    const sourceRoll = seq % 7;
    const source = sourceRoll === 0 ? "manual" : sourceRoll === 1 ? "import" : `api:website-${(seq % 3) + 1}`;
    // 每 11 条留 1 条未评分，让「未评分」态在评分工作台可见
    const scored = seq % 11 !== 0;
    const discardReason = status === "DISCARDED" ? DISCARD_REASONS[seq % DISCARD_REASONS.length] : null;
    return {
      id: id("lead", seq),
      seq,
      status,
      ownerIndex,
      companyName: companyName(200 + seq),
      contactName: contactName(500 + seq),
      contactPhone: nextPhone(),
      contactEmail: seq % 3 === 0 ? null : `lead${seq}@example.com`,
      title: TITLES[(seq * 3) % TITLES.length],
      source,
      channel: LEAD_CHANNELS[seq % LEAD_CHANNELS.length],
      score: scored ? 35 + ((seq * 17) % 66) : null,
      discardReason,
      discardNote: discardReason === "OTHER" ? "对方明确表示本年度无数字化预算" : null,
      receivedDaysAgo: 1 + ((seq * 11) % 150),
    } satisfies LeadDraft;
  });
}

function buildOpportunities(
  customers: CustomerDraft[],
  contactsByCustomer: Map<number, ContactDraft[]>,
  leads: LeadDraft[],
): OpportunityDraft[] {
  const convertedLeads = leads.filter((l) => l.status === "CONVERTED");
  const stages = rng.shuffle(STAGE_PLAN);
  const opportunities: OpportunityDraft[] = [];

  for (let seq = 0; seq < COUNTS.opportunities; seq += 1) {
    const lead = seq < convertedLeads.length ? convertedLeads[seq] : null;
    // 线索转化来的商机与线索归属同一客户；无来源线索的商机按序号直接挂客户
    const customer = lead
      ? customers[seq % customers.length]
      : customers[(seq * 7 + 3) % customers.length];
    const contacts = contactsByCustomer.get(customer.seq) ?? [];
    const primaryContact = contacts[0];
    const stage = stages[seq];
    const createdDaysAgo = 8 + ((seq * 9) % 300);
    const stageEnteredDaysAgo = Math.max(1, Math.min(createdDaysAgo, 1 + ((seq * 5) % 45)));
    const isWon = stage === "WON";
    const isLost = stage === "LOST";
    // 当月赢单铺开在当月已过的工作日里，让 BI / 排行榜的当月达成率有数
    const wonIndex = opportunities.filter((o) => o.stage === "WON").length;
    const monthDay = Math.max(1, Math.min(WALL.day, Math.round((WALL.day * (wonIndex + 1)) / 6)));
    const actualCloseAt = isWon
      ? wonIndex < 5
        ? businessDate(MONTH_START_MS + (monthDay - 1) * DAY_MS)
        : businessDateFromNow(-25)
      : null;
    const lostReason = isLost ? LOST_REASONS[seq % LOST_REASONS.length] : null;
    opportunities.push({
      id: id("opportunity", seq),
      seq,
      customer,
      ownerIndex: lead?.ownerIndex ?? customer.ownerIndex,
      primaryContact,
      fromLead: lead,
      stage,
      expectedAmount: 0, // 下方按明细回填
      expectedCloseAt: isWon || isLost
        ? businessDateFromNow(-(5 + ((seq * 4) % 40)))
        : businessDateFromNow(3 + ((seq * 11) % 75)),
      actualAmount: null,
      actualCloseAt,
      lostReason,
      lostNote: null,
      createdDaysAgo,
      stageEnteredDaysAgo,
      lineItems: [],
    });
  }
  return opportunities;
}

// ---------------------------------------------------------------------------
// 写库辅助
// ---------------------------------------------------------------------------

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * 批量插入。`onConflict` 只接受本文件内的字面量常量（非外部输入）。
 * `jsonbColumns` 里的列在 VALUES 中显式 `::jsonb` 转型，避免依赖隐式推断。
 */
async function insertMany(
  client: pg.Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  options: { onConflict?: string; jsonbColumns?: string[] } = {},
): Promise<void> {
  if (rows.length === 0) return;
  const onConflict = options.onConflict ?? "on conflict (id) do nothing";
  const jsonb = new Set(options.jsonbColumns ?? []);
  for (const chunk of chunks(rows, CHUNK)) {
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((row, r) => {
      const placeholders = columns.map((column, c) => {
        params.push(row[c]);
        const index = r * columns.length + c + 1;
        return jsonb.has(column) ? `$${index}::jsonb` : `$${index}`;
      });
      values.push(`(${placeholders.join(", ")})`);
    });
    await client.query(
      `insert into ${table} (${columns.join(", ")}) values ${values.join(", ")} ${onConflict}`,
      params,
    );
  }
}

interface ResolvedUser {
  id: string;
  role: "ADMIN" | "MANAGER" | "SALES";
  email: string;
  name: string;
  departmentSeq: number;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required");
  if (process.env.NODE_ENV === "production") {
    throw new Error("[SEED GUARD] 演示种子不允许在 NODE_ENV=production 下执行");
  }
  if (adminPassword.length < 8) {
    throw new Error("DEV_ADMIN_PASSWORD must be at least 8 characters (a valid demo login password is required)");
  }

  const customers = buildCustomers();
  const contactsByCustomer = buildContacts(customers);
  const contacts = [...contactsByCustomer.values()].flat();
  const leads = buildLeads();
  const opportunities = buildOpportunities(customers, contactsByCustomer, leads);

  // 商机明细：给前 30 个「在跟进 / 已赢单」的商机配 1-3 条 SKU，预期金额 = 明细小计之和
  const lineItemCapable = opportunities.filter((o) => o.stage !== "LOST").slice(0, 30);
  for (const o of lineItemCapable) {
    const count = 1 + (o.seq % 3);
    const used = new Set<number>();
    for (let k = 0; k < count; k += 1) {
      let productIndex = (o.seq * 3 + k * 2) % 6;
      while (used.has(productIndex)) productIndex = (productIndex + 1) % 6;
      used.add(productIndex);
      o.lineItems.push({ productIndex, quantity: 1 + ((o.seq + k) % 5) });
    }
  }
  for (const o of opportunities) {
    if (o.lineItems.length > 0) {
      o.expectedAmount = o.lineItems.reduce(
        (sum, li) => sum + PRODUCT_DEFS[li.productIndex].unitPrice * li.quantity,
        0,
      );
    } else {
      o.expectedAmount = (20 + ((o.seq * 17) % 90)) * 1_000_000;
    }
    if (o.stage === "WON") {
      // 赢单金额按 92%~100% 成交（商务折扣在合同阶段消化），使达成率既非 0 也非 100%
      o.actualAmount = Math.round((o.expectedAmount * (92 + (o.seq % 9))) / 100);
    }
  }

  const client = new pg.Client({ connectionString: migrationUrl });
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  try {
    await client.connect();
    await client.query("select pg_advisory_lock($1::bigint)", [SEED_ADVISORY_LOCK_ID]);
    await client.query("begin");

    // --- 1. 租户（插入时由 tenants_initialize_score_rules 触发器落 7 条默认评分规则）---
    await client.query(
      `insert into tenants (id, name, status) values ($1, $2, 'ACTIVE')
       on conflict (id) do update set name = excluded.name, status = 'ACTIVE', updated_at = now()`,
      [SEED_TENANT_ID, TENANT_NAME],
    );

    // --- 2. 用户（9 人：1 ADMIN / 2 MANAGER / 6 SALES）---
    // 部门序号：0=销售一部 1=销售二部 2=市场与线索运营部
    const userDefs: { email: string; name: string; role: ResolvedUser["role"]; departmentSeq: number; jobTitle: string }[] = [
      { email: adminEmail, name: "演示管理员", role: "ADMIN", departmentSeq: 2, jobTitle: "系统管理员" },
      ...MANAGER_USER_DEFS.map((m) => ({ email: m.email, name: m.name, role: "MANAGER" as const, departmentSeq: m.department, jobTitle: "销售主管" })),
      ...SALES_USER_DEFS.map((s) => ({ email: s.email, name: s.name, role: "SALES" as const, departmentSeq: s.department, jobTitle: "客户经理" })),
    ];
    const users: ResolvedUser[] = [];
    for (const [seq, def] of userDefs.entries()) {
      const userId = id("user", seq);
      const inserted = await client.query<{ id: string }>(
        `insert into users (id, tenant_id, email, phone, employee_no, job_title, max_lead_quota, password_hash, name, role, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
         on conflict (id) do nothing
         returning id`,
        [
          userId, SEED_TENANT_ID, def.email, `138${String(90_000_000 + seq)}`,
          `DEMO-${String(seq + 1).padStart(3, "0")}`, def.jobTitle, 100, passwordHash, def.name, def.role,
        ],
      );
      // 邮箱全局唯一：若该邮箱此前已由其它种子写入，取回真实主键而不重复建号
      const existing = await client.query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from users where lower(btrim(email)) = $1 for update",
        [def.email],
      );
      const resolvedId = inserted.rows[0]?.id ?? existing.rows[0]?.id ?? userId;
      if (existing.rows[0] && existing.rows[0].tenant_id !== SEED_TENANT_ID) {
        throw new Error(`[SEED GUARD] 演示邮箱已被其它租户占用，拒绝覆盖：${def.email}`);
      }
      await client.query(
        `update users set
           tenant_id = $2, phone = $3, employee_no = $4, job_title = $5, name = $6, role = $7, status = 'ACTIVE',
           password_hash = case when password_hash = $8 then password_hash else $8 end,
           session_version = case when password_hash = $8 then session_version else session_version + 1 end,
           failed_login_count = 0, locked_until = null, updated_at = now()
         where id = $1`,
        [
          resolvedId, SEED_TENANT_ID, `138${String(90_000_000 + seq)}`,
          `DEMO-${String(seq + 1).padStart(3, "0")}`, def.jobTitle, def.name, def.role, passwordHash,
        ],
      );
      users.push({ id: resolvedId, role: def.role, email: def.email, name: def.name, departmentSeq: def.departmentSeq });
    }
    const adminUser = users[0];
    const managerUsers = users.filter((u) => u.role === "MANAGER");
    const salesUsers = users.filter((u) => u.role === "SALES");

    // --- 3. 部门（3 个，leader 指向已落库的用户；用户归属在部门建好后回填）---
    const departments: { id: string; name: string }[] = [];
    for (const [seq, def] of DEPARTMENT_DEFS.entries()) {
      const departmentId = id("department", seq);
      const leaderId = users.find((u) => u.email === def.leaderEmail)?.id;
      await client.query(
        `insert into departments (id, tenant_id, name, leader_user_id, sort_order)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set name = excluded.name, leader_user_id = excluded.leader_user_id,
           sort_order = excluded.sort_order, updated_at = now()`,
        [departmentId, SEED_TENANT_ID, def.name, leaderId ?? null, def.sortOrder],
      );
      departments.push({ id: departmentId, name: def.name });
    }
    for (const user of users) {
      await client.query(
        "update users set department_id = $2 where id = $1 and department_id is distinct from $2",
        [user.id, departments[user.departmentSeq].id],
      );
    }

    // --- 4. 自定义角色 + 角色分配（设置页有内容）---
    const customRoles = [
      { key: "sales-lead", name: "线索专员", code: "sales-lead", permissions: ["products:view", "leads:claim"] },
      { key: "sales-mentor", name: "资深顾问", code: "sales-mentor", permissions: ["products:view", "products:manage", "leads:claim", "opportunities:intervene"] },
    ];
    for (const role of customRoles) {
      await client.query(
        `insert into custom_roles (id, tenant_id, name, code, description, is_system, permissions)
         values ($1, $2, $3, $4, $5, false, $6::jsonb)
         on conflict (id) do nothing`,
        [id("custom_role", role.key), SEED_TENANT_ID, role.name, role.code,
          `演示用自定义角色：${role.name}`, JSON.stringify(role.permissions)],
      );
    }
    await insertMany(
      client,
      "user_role_assignments",
      ["id", "tenant_id", "user_id", "role_id"],
      [
        [id("user_role_assignment", "mentor-1"), SEED_TENANT_ID, salesUsers[0].id, id("custom_role", "sales-mentor")],
        [id("user_role_assignment", "mentor-2"), SEED_TENANT_ID, salesUsers[1].id, id("custom_role", "sales-mentor")],
        [id("user_role_assignment", "lead-1"), SEED_TENANT_ID, salesUsers[4].id, id("custom_role", "sales-lead")],
        [id("user_role_assignment", "lead-2"), SEED_TENANT_ID, salesUsers[5].id, id("custom_role", "sales-lead")],
      ],
    );

    // --- 5. 产品目录（6 个在售 + 1 个归档）---
    await insertMany(
      client,
      "products",
      ["id", "tenant_id", "code", "name", "category", "pricing_model", "unit_price", "unit", "description", "status"],
      PRODUCT_DEFS.map((p, seq) => [
        id("product", seq), SEED_TENANT_ID, p.code, p.name, p.category, p.pricingModel,
        p.unitPrice, p.unit, `演示产品：${p.name}（虚构目录）`, p.status,
      ]),
    );

    // --- 6. 客户 + 联系人 ---
    await insertMany(
      client,
      "customers",
      ["id", "tenant_id", "owner_user_id", "claimed_at", "customer_type", "name", "industry", "region", "size", "created_at"],
      customers.map((c) => [
        c.id, SEED_TENANT_ID, salesUsers[c.ownerIndex].id, shift(-c.claimedDaysAgo),
        c.customerType, c.name, c.industry, c.region, c.size, shift(-c.createdDaysAgo),
      ]),
    );
    await insertMany(
      client,
      "contacts",
      ["id", "tenant_id", "customer_id", "name", "phone", "email", "title", "role_tag", "is_primary", "created_at"],
      contacts.map((ct) => [
        ct.id, SEED_TENANT_ID, ct.customerId, ct.name, ct.phone, ct.email, ct.title, ct.roleTag, ct.isPrimary,
        shift(-(20 + ((ct.customerId.length * 7 + ct.name.length) % 180))),
      ]),
    );

    // --- 7. 线索（覆盖 NEW/CONTACTED/QUALIFIED/CONVERTED/DISCARDED + 公海未认领）---
    const scoredAt = (lead: LeadDraft): string | null =>
      lead.score === null ? null : shift(-(lead.receivedDaysAgo - 1));
    await insertMany(
      client,
      "leads",
      [
        "id", "tenant_id", "owner_user_id", "contact_name", "contact_phone", "contact_email", "company_name",
        "title", "intended_product_id", "intended_product", "budget", "note", "source_label", "received_at",
        "source", "status", "score", "score_reason", "scored_at", "channel", "utm_source", "utm_medium",
        "utm_campaign", "discard_reason", "discard_note", "claimed_at", "created_at",
      ],
      leads.map((lead) => {
        const product = PRODUCT_DEFS[lead.seq % 6];
        const budget = lead.status === "QUALIFIED" || lead.status === "CONVERTED"
          ? ["30-50 万", "50-100 万", "100 万以上"][lead.seq % 3]
          : null;
        return [
          lead.id,
          SEED_TENANT_ID,
          lead.ownerIndex === null ? null : salesUsers[lead.ownerIndex].id,
          lead.contactName,
          lead.contactPhone,
          lead.contactEmail,
          lead.companyName,
          lead.title,
          product ? id("product", lead.seq % 6) : null,
          product ? product.name : null,
          budget,
          `演示线索备注：${lead.channel}渠道获取，待完成资格判断。`,
          `演示渠道·${lead.channel}`,
          shift(-lead.receivedDaysAgo),
          lead.source,
          lead.status,
          lead.score,
          lead.score === null ? null : `演示自动评分：角色/来源/互动历史综合命中 ${lead.score} 分档位`,
          scoredAt(lead),
          lead.channel,
          lead.source.startsWith("api:") ? "website" : null,
          lead.source.startsWith("api:") ? "cpc" : null,
          lead.source.startsWith("api:") ? `campaign-${(lead.seq % 3) + 1}` : null,
          lead.discardReason,
          lead.discardNote,
          lead.ownerIndex === null ? null : shift(-Math.min(lead.receivedDaysAgo - 1, 25)),
          shift(-lead.receivedDaysAgo),
        ];
      }),
    );

    // lead_status_history 无 UUID 主键，用 (tenant, lead, to_status) 天然键去重
    const historyRows: { lead: LeadDraft; from: string | null; to: string; reason: string; actorIndex: number }[] = [];
    for (const lead of leads) {
      const actorIndex = lead.ownerIndex ?? lead.seq % SALES_USER_DEFS.length;
      if (lead.status === "NEW") continue;
      const chain: { from: string | null; to: string; reason: string }[] =
        lead.status === "DISCARDED"
          ? [{ from: "NEW", to: "DISCARDED", reason: `演示：判定为无效线索（${lead.discardReason}）` }]
          : [
              { from: "NEW", to: "CONTACTED", reason: "演示：首次电话已接通并记录结果" },
              ...(lead.status === "QUALIFIED" || lead.status === "CONVERTED"
                ? [{ from: "CONTACTED", to: "QUALIFIED", reason: "演示：需求与预算已确认" }]
                : []),
              ...(lead.status === "CONVERTED"
                ? [{ from: "QUALIFIED", to: "CONVERTED", reason: "演示：已转客户并建立商机" }]
                : []),
            ];
      for (const step of chain) {
        historyRows.push({ lead, from: step.from, to: step.to, reason: step.reason, actorIndex });
      }
    }
    for (const chunk of chunks(historyRows, CHUNK)) {
      const values: string[] = [];
      const params: unknown[] = [];
      chunk.forEach((h, r) => {
        params.push(SEED_TENANT_ID, h.lead.id, h.from, h.to, h.reason, salesUsers[h.actorIndex].id,
          shift(-Math.max(0, h.lead.receivedDaysAgo - 1 - r)));
        const base = r * 7;
        // VALUES 列表里的字面量默认推导为 text，必须显式转型才能与 uuid / 枚举列比较
        values.push(
          `($${base + 1}::uuid, $${base + 2}::uuid, $${base + 3}::lead_status, $${base + 4}::lead_status, ` +
          `$${base + 5}::text, $${base + 6}::uuid, $${base + 7}::timestamptz)`,
        );
      });
      await client.query(
        `insert into lead_status_history (tenant_id, lead_id, from_status, to_status, reason, actor_user_id, created_at)
         select v.* from (values ${values.join(", ")}) as v(tenant_id, lead_id, from_status, to_status, reason, actor_user_id, created_at)
         where not exists (
           select 1 from lead_status_history h
           where h.tenant_id = v.tenant_id and h.lead_id = v.lead_id
             and h.to_status = v.to_status and h.from_status is not distinct from v.from_status
         )`,
        params,
      );
    }

    // --- 8. 商机（5 个阶段全覆盖）+ 阶段流转历史 ---
    await insertMany(
      client,
      "opportunities",
      [
        "id", "tenant_id", "customer_id", "owner_user_id", "primary_contact_id", "from_lead_id", "name",
        "stage", "stage_entered_at", "expected_amount", "expected_close_at", "actual_amount",
        "actual_close_at", "demand_note", "intended_product_id", "intended_product", "lost_reason",
        "lost_note", "created_at",
      ],
      opportunities.map((o) => {
        const product = PRODUCT_DEFS[o.lineItems[0]?.productIndex ?? o.seq % 6];
        return [
          o.id,
          SEED_TENANT_ID,
          o.customer.id,
          salesUsers[o.ownerIndex].id,
          o.primaryContact.id,
          o.fromLead?.id ?? null,
          `${o.customer.name.slice(0, 8)}·${product.name}采购项目`,
          o.stage,
          shift(-o.stageEnteredDaysAgo),
          o.expectedAmount,
          o.expectedCloseAt,
          o.actualAmount,
          o.actualCloseAt,
          `演示需求：${o.customer.industry}行业客户，希望统一线索到回款的全过程管理，预算区间已确认。`,
          id("product", o.lineItems[0]?.productIndex ?? o.seq % 6),
          product.name,
          o.lostReason,
          o.lostNote,
          shift(-o.createdDaysAgo),
        ];
      }),
    );

    const stageOrder = ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "WON", "LOST"] as const;
    const stageHistory: unknown[][] = [];
    for (const o of opportunities) {
      const targetIndex = stageOrder.indexOf(o.stage);
      for (let s = 0; s <= targetIndex; s += 1) {
        stageHistory.push([
          id("opportunity_stage_history", `${o.seq}-${s}`),
          SEED_TENANT_ID,
          o.id,
          s === 0 ? null : stageOrder[s - 1],
          stageOrder[s],
          s === 0
            ? "演示：立项进入初步接触"
            : `演示：评审通过，推进到${stageOrder[s]}`,
          salesUsers[o.ownerIndex].id,
          shift(-Math.max(0, o.createdDaysAgo + s * 3)),
        ]);
      }
    }
    await insertMany(
      client,
      "opportunity_stage_history",
      ["id", "tenant_id", "opportunity_id", "from_stage", "to_stage", "note", "operator_user_id", "created_at"],
      stageHistory,
    );

    // --- 9. 商机明细（subtotal = 单价 × 数量，discount_rate 恒为 100）---
    const lineItemRows: unknown[][] = [];
    let lineItemSeq = 0;
    for (const o of opportunities) {
      for (const li of o.lineItems) {
        const product = PRODUCT_DEFS[li.productIndex];
        lineItemSeq += 1;
        lineItemRows.push([
          id("opportunity_line_item", lineItemSeq),
          SEED_TENANT_ID,
          o.id,
          id("product", li.productIndex),
          li.quantity,
          product.unitPrice,
          100,
          product.unitPrice * li.quantity,
          `演示明细：${product.name} × ${li.quantity}`,
          shift(-o.createdDaysAgo),
        ]);
      }
    }
    await insertMany(
      client,
      "opportunity_line_items",
      ["id", "tenant_id", "opportunity_id", "product_id", "quantity", "unit_price", "discount_rate", "subtotal_amount", "note", "created_at"],
      lineItemRows,
    );

    // --- 10. 线索转化记录（lead 必须已是 CONVERTED，由延迟约束在提交时校验）---
    const convertedOpportunities = opportunities.filter((o) => o.fromLead);
    await insertMany(
      client,
      "lead_conversions",
      ["id", "tenant_id", "lead_id", "customer_id", "opportunity_id", "converted_by_user_id", "created_at"],
      convertedOpportunities.map((o, i) => [
        id("lead_conversion", i), SEED_TENANT_ID, o.fromLead!.id, o.customer.id, o.id,
        salesUsers[o.ownerIndex].id, shift(-(o.createdDaysAgo - 1)),
      ]),
    );

    // --- 11. 活动（线索 / 客户 / 商机各一部分，作为跟进时间线与最近活动时间来源）---
    const activityRows: unknown[][] = [];
    let activitySeq = 0;
    const addActivity = (
      subject: { type: "leadId" | "customerId" | "opportunityId"; value: string },
      userId: string,
      daysAgo: number,
    ): void => {
      activitySeq += 1;
      const type = ["CALL", "MEETING", "VISIT", "MESSAGE", "NOTE"][activitySeq % 5];
      const outcome = type === "NOTE" ? null : ["CONNECTED", "INTERESTED", "NO_ANSWER", "REFUSED"][activitySeq % 4];
      const summary = type === "NOTE"
        ? "演示记录：整理客户提出的实施顾虑，等待内部确认后回复。"
        : `演示${type === "CALL" ? "电话沟通" : type === "MEETING" ? "线上会议" : type === "VISIT" ? "上门拜访" : "消息触达"}：${
            outcome === "INTERESTED" ? "客户明确有意向，已约定下一步时间" : outcome === "CONNECTED" ? "已接通并记录关键信息" : outcome === "NO_ANSWER" ? "本次未接通，改日再拨" : "对方表示暂不考虑"
          }`;
      activityRows.push([
        id("activity", activitySeq), SEED_TENANT_ID, subject.type === "leadId" ? subject.value : null,
        subject.type === "customerId" ? subject.value : null, subject.type === "opportunityId" ? subject.value : null,
        userId, type, outcome, summary, shift(-daysAgo),
      ]);
    };
    leads.filter((l) => l.status !== "CONVERTED").slice(0, 20).forEach((lead, i) => {
      addActivity({ type: "leadId", value: lead.id }, salesUsers[lead.ownerIndex ?? i % 6].id, lead.receivedDaysAgo);
    });
    opportunities.slice(0, 26).forEach((o, i) => {
      addActivity({ type: "opportunityId", value: o.id }, salesUsers[o.ownerIndex].id, 2 + i * 3);
    });
    customers.slice(0, 14).forEach((c, i) => {
      addActivity({ type: "customerId", value: c.id }, salesUsers[c.ownerIndex].id, 5 + i * 6);
    });

    // 客户「最近跟进时间」= 其名下活动的最新一条，无活动的退化为认领时间
    const lastActivityByCustomer = new Map<string, number>();
    activityRows.forEach((row) => {
      if (row[3] === null) return;
      const occurredAt = Date.parse(row[9] as string);
      const current = lastActivityByCustomer.get(row[3] as string);
      if (current === undefined || occurredAt > current) lastActivityByCustomer.set(row[3] as string, occurredAt);
    });
    await client.query(
      `update customers c set last_activity_at = greatest(
           coalesce(($1::jsonb ->> c.id::text)::timestamptz, c.claimed_at),
           c.created_at
         ), updated_at = now()
       where c.tenant_id = $2`,
      [JSON.stringify(Object.fromEntries([...lastActivityByCustomer].map(([k, v]) => [k, new Date(v).toISOString()]))), SEED_TENANT_ID],
    );
    await insertMany(
      client,
      "activities",
      ["id", "tenant_id", "lead_id", "customer_id", "opportunity_id", "user_id", "type", "outcome", "summary", "occurred_at"],
      activityRows,
    );

    // --- 12. 任务（OPEN 每对象至多 1 条；含逾期 / 今日到期 / 未来待办 / 已完成 / 已取消）---
    const openLeadLeads = leads.filter((l) => l.ownerIndex !== null && l.status !== "CONVERTED" && l.status !== "DISCARDED").slice(0, 36);
    const openOpportunities = opportunities.filter((o) => o.stage === "DISCOVERY" || o.stage === "PROPOSAL" || o.stage === "NEGOTIATION").slice(0, 26);
    const openCustomers = customers.slice(10, 24);

    const taskRows: unknown[][] = [];
    const dueFor = (i: number): { due: string; bucket: "逾期" | "今日" | "未来" } => {
      const bucket = i % 3;
      if (bucket === 0) return { due: shift(-(1 + (i % 9)), 2), bucket: "逾期" };
      if (bucket === 1) return { due: iso(TODAY_DUE_MS), bucket: "今日" };
      return { due: shift(1 + (i % 8), 3), bucket: "未来" };
    };
    const pushTask = (row: {
      subject: ["lead_id" | "customer_id" | "opportunity_id", string];
      assignee: string;
      type: "FIRST_RESPONSE" | "FOLLOW_UP" | "STAGE_PUSH";
      due: string;
      status: "OPEN" | "DONE" | "CANCELLED";
      completedAt: string | null;
      title: string;
      note: string;
      createdDaysAgo: number;
    }): void => {
      taskRows.push([
        id("task", taskRows.length + 1), SEED_TENANT_ID, row.subject[0] === "lead_id" ? row.subject[1] : null,
        row.subject[0] === "customer_id" ? row.subject[1] : null, row.subject[0] === "opportunity_id" ? row.subject[1] : null,
        row.assignee, row.type, row.title, row.note, row.due, row.status, row.completedAt,
        shift(-row.createdDaysAgo), row.completedAt ?? shift(-row.createdDaysAgo),
      ]);
    };

    openLeadLeads.forEach((lead, i) => {
      const { due } = dueFor(i);
      pushTask({
        subject: ["lead_id", lead.id],
        assignee: salesUsers[lead.ownerIndex!].id,
        type: lead.status === "NEW" ? "FIRST_RESPONSE" : "FOLLOW_UP",
        due,
        status: "OPEN",
        completedAt: null,
        title: lead.status === "NEW" ? "首次响应：15 分钟内完成首次触达" : "跟进：确认需求与决策链",
        note: `演示待办：${lead.companyName}（${lead.channel}）`,
        createdDaysAgo: 1 + (i % 6),
      });
    });
    openOpportunities.forEach((o, i) => {
      const { due } = dueFor(i + 1);
      pushTask({
        subject: ["opportunity_id", o.id],
        assignee: salesUsers[o.ownerIndex].id,
        type: "STAGE_PUSH",
        due,
        status: "OPEN",
        completedAt: null,
        title: `阶段推进：确认进入下一阶段所需材料`,
        note: `演示待办：${o.customer.name}`,
        createdDaysAgo: 1 + (i % 8),
      });
    });
    openCustomers.forEach((c, i) => {
      const { due } = dueFor(i + 2);
      pushTask({
        subject: ["customer_id", c.id],
        assignee: salesUsers[c.ownerIndex].id,
        type: "FOLLOW_UP",
        due,
        status: "OPEN",
        completedAt: null,
        title: "客户经营：季度经营回顾邀约",
        note: `演示待办：${c.name}`,
        createdDaysAgo: 2 + (i % 5),
      });
    });
    // 已完成的历史任务
    leads.filter((l) => l.ownerIndex !== null).slice(0, 5).forEach((lead, i) => {
      const due = shift(-(10 + i * 4), 2);
      pushTask({
        subject: ["lead_id", lead.id], assignee: salesUsers[lead.ownerIndex!].id, type: "FOLLOW_UP",
        due, status: "DONE", completedAt: shift(-(9 + i * 4), 2),
        title: "已完成：首次电话沟通并记录结果", note: `演示历史任务：${lead.companyName}`,
        createdDaysAgo: 12 + i * 4,
      });
    });
    opportunities.filter((o) => o.stage === "WON" || o.stage === "LOST").forEach((o, i) => {
      const due = shift(-(20 + i * 5), 2);
      pushTask({
        subject: ["opportunity_id", o.id], assignee: salesUsers[o.ownerIndex].id, type: "STAGE_PUSH",
        due, status: "DONE", completedAt: shift(-(19 + i * 5), 2),
        title: o.stage === "WON" ? "已完成：赢单归档与复盘发起" : "已完成：丢单原因确认",
        note: `演示历史任务：${o.customer.name}`, createdDaysAgo: 22 + i * 5,
      });
    });
    customers.slice(0, 5).forEach((c, i) => {
      pushTask({
        subject: ["customer_id", c.id], assignee: salesUsers[c.ownerIndex].id, type: "FOLLOW_UP",
        due: shift(-(15 + i * 3), 2), status: "CANCELLED", completedAt: null,
        title: "已取消：客户要求延后到下季度再谈", note: `演示历史任务：${c.name}`,
        createdDaysAgo: 17 + i * 3,
      });
    });
    await insertMany(
      client,
      "tasks",
      [
        "id", "tenant_id", "lead_id", "customer_id", "opportunity_id", "assignee_user_id", "type",
        "title", "note", "due_at", "status", "completed_at", "created_at", "updated_at",
      ],
      taskRows,
    );

    // --- 13. 销售日程（日历页有数）---
    await insertMany(
      client,
      "sales_schedules",
      ["id", "tenant_id", "user_id", "title", "schedule_type", "opportunity_id", "customer_id", "start_at", "end_at", "note", "status", "source"],
      opportunities.slice(0, 14).map((o, i) => {
        const startMs = NOW_MS + (1 + (i % 9)) * DAY_MS + 2 * HOUR_MS;
        return [
          id("sales_schedule", i), SEED_TENANT_ID, salesUsers[o.ownerIndex].id,
          `演示日程：${o.customer.name.slice(0, 10)} 方案沟通`, ["MEETING", "VISIT", "PROPOSAL_DEMO", "CALL"][i % 4],
          o.id, o.customer.id, iso(startMs), iso(startMs + HOUR_MS),
          "演示日程：与客户确认方案细节与下一步动作", "PENDING", "MANUAL",
        ];
      }),
    );

    // --- 14. 销售洞察（洞察页有数；状态字段严格满足 sales_insights_status_fields）---
    const insightRows: unknown[][] = [];
    opportunities.filter((o) => o.stage === "NEGOTIATION" || o.stage === "PROPOSAL").slice(0, 5).forEach((o, i) => {
      insightRows.push([
        id("sales_insight", `opp-${i}`), SEED_TENANT_ID, null, o.id,
        i % 2 === 0 ? "STALE_NO_ACTIVITY" : "MISSING_DECISION_CHAIN",
        i % 2 === 0 ? "ATTENTION" : "HIGH_RISK", "OPEN",
        i % 2 === 0 ? "商机超过 10 天无有效推进" : "缺少决策链与下次会议时间",
        `演示洞察：${o.customer.name} 处于 ${o.stage} 阶段但缺少可核验的下一步记录。`,
        "演示建议：24 小时内与决策人确认下次会议时间并写入活动记录。",
        shift(1 + i), JSON.stringify([{ kind: "FACT", summary: "阶段已停留且无新增活动记录" }]),
        "RULE", "demo-rules-v1", null, null, null,
      ]);
    });
    leads.filter((l) => l.status === "CONTACTED").slice(0, 5).forEach((lead, i) => {
      insightRows.push([
        id("sales_insight", `lead-${i}`), SEED_TENANT_ID, lead.id, null,
        "FOLLOW_UP_OVERDUE", "ATTENTION", "OPEN",
        "线索超过约定跟进窗口未触达",
        `演示洞察：${lead.companyName} 自收到线索后已超过跟进窗口。`,
        "演示建议：今日内完成一次电话触达并记录结果。",
        shift(1 + i), JSON.stringify([{ kind: "FACT", summary: "超过约定跟进窗口" }]),
        "RULE", "demo-rules-v1", null, null, null,
      ]);
    });
    await insertMany(
      client,
      "sales_insights",
      [
        "id", "tenant_id", "lead_id", "opportunity_id", "code", "severity", "status", "title", "summary",
        "suggested_action", "suggested_due_at", "evidence", "source_type", "source_version",
        "dismiss_reason", "accepted_task_id", "expires_at",
      ],
      insightRows,
      { jsonbColumns: ["evidence"] },
    );
    // 已采纳/已忽略各一条，让状态分布不全是 OPEN
    await insertMany(
      client,
      "sales_insights",
      [
        "id", "tenant_id", "lead_id", "opportunity_id", "code", "severity", "status", "title", "summary",
        "suggested_action", "suggested_due_at", "evidence", "source_type", "source_version",
        "dismiss_reason", "accepted_task_id", "expires_at",
      ],
      [
        [
          id("sales_insight", "accepted-0"), SEED_TENANT_ID, null, opportunities[3].id,
          "MISSING_DECISION_CHAIN", "HIGH_RISK", "ACCEPTED",
          "缺少决策链与下次会议时间",
          `演示洞察：${opportunities[3].customer.name} 尚未记录决策链。`,
          "演示建议：已生成待办，由销售补齐决策链信息。",
          shift(1), JSON.stringify([{ kind: "FACT", summary: "无决策链记录" }]),
          "RULE", "demo-rules-v1", null, id("task", 1), null,
        ],
        [
          id("sales_insight", "dismissed-0"), SEED_TENANT_ID, leads[1].id, null,
          "FOLLOW_UP_OVERDUE", "ATTENTION", "DISMISSED",
          "线索超过约定跟进窗口未触达",
          `演示洞察：${leads[1].companyName} 的跟进窗口已过。`,
          "演示建议：客户已明确暂缓，本季度不再跟进。",
          null, JSON.stringify([{ kind: "FACT", summary: "客户要求暂缓" }]),
          "RULE", "demo-rules-v1", "客户已明确暂缓采购，忽略该提醒", null, null,
        ],
      ],
      { jsonbColumns: ["evidence"] },
    );

    // --- 15. 当月销售配额（6 位销售各一条，period_key 与 BI 口径一致）---
    const periodKey = buildQuotaPeriodKey(YEAR_MONTH.year, "MONTHLY", YEAR_MONTH.month);
    for (const [seq, def] of SALES_USER_DEFS.entries()) {
      const user = salesUsers[seq];
      const department = departments[def.department];
      await client.query(
        `insert into sales_quotas (id, tenant_id, user_id, department_id, year, period_type, period_key,
            target_amount_cents, target_deals_count, target_leads_count, note, created_by_user_id)
         values ($1, $2, $3, $4, $5, 'MONTHLY', $6, $7, $8, $9, $10, $11)
         on conflict (tenant_id, user_id, period_type, period_key) do update set
           department_id = excluded.department_id, target_amount_cents = excluded.target_amount_cents,
           target_deals_count = excluded.target_deals_count, target_leads_count = excluded.target_leads_count,
           note = excluded.note, updated_at = now()`,
        [
          id("sales_quota", `${periodKey}-${seq}`), SEED_TENANT_ID, user.id, department.id,
          YEAR_MONTH.year, periodKey, def.target, def.deals, def.leads,
          `演示配额：${department.name} ${user.name} ${periodKey} 月度目标`, managerUsers[def.department].id,
        ],
      );
    }

    // --- 16. 评分规则（在租户触发器落下的 7 条默认规则之上补充 8 条，sort_order 从 80 起）---
    const extraScoreRules = [
      { label: "关键决策角色", field: "title", operator: "CONTAINS", value: "总监", weight: 12, sortOrder: 80 },
      { label: "官网表单留资", field: "source", operator: "STARTS_WITH", value: "api:", weight: 12, sortOrder: 90 },
      { label: "目标行业客户", field: "customer_industry", operator: "IN", value: "装备制造,精密电子,汽车零部件", weight: 8, sortOrder: 100 },
      { label: "目标规模客户", field: "customer_size", operator: "IN", value: "101-500,501-1000,1000+", weight: 10, sortOrder: 110 },
      { label: "重点区域客户", field: "customer_region", operator: "IN", value: "华东,华南", weight: 6, sortOrder: 120 },
      { label: "长期未活动", field: "days_since_activity", operator: "GTE", value: "30", weight: -15, sortOrder: 130 },
      { label: "客户有赢单记录", field: "won_deal_count", operator: "GTE", value: "1", weight: 15, sortOrder: 140 },
      { label: "客户有在跟商机", field: "active_deal_count", operator: "GTE", value: "1", weight: 10, sortOrder: 150 },
    ];
    for (const [seq, rule] of extraScoreRules.entries()) {
      await client.query(
        `insert into score_rules (id, tenant_id, label, field, operator, value, weight, enabled, sort_order)
         values ($1, $2, $3, $4, $5, $6, $7, true, $8)
         on conflict (id) do nothing`,
        [id("score_rule", seq), SEED_TENANT_ID, rule.label, rule.field, rule.operator, rule.value, rule.weight, rule.sortOrder],
      );
    }

    // --- 17. 公海回收规则（3 条内置规则，设置页有数）---
    const poolRules = [
      { type: "LEAD_UNTOUCHED", thresholdDays: 7, protectWindowDays: 3, notifyBeforeHours: 24 },
      { type: "LEAD_UNCONVERTED", thresholdDays: 30, protectWindowDays: 3, notifyBeforeHours: 48 },
      { type: "CUSTOMER_INACTIVE", thresholdDays: 45, protectWindowDays: 7, notifyBeforeHours: 72 },
    ];
    for (const [seq, rule] of poolRules.entries()) {
      await client.query(
        `insert into public_pool_rules (id, tenant_id, rule_type, threshold_days, protect_window_days, notify_before_hours, is_enabled)
         values ($1, $2, $3, $4, $5, $6, true)
         on conflict (tenant_id, rule_type) do update set
           threshold_days = excluded.threshold_days, protect_window_days = excluded.protect_window_days,
           notify_before_hours = excluded.notify_before_hours, is_enabled = true, updated_at = now()`,
        [id("public_pool_rule", seq), SEED_TENANT_ID, rule.type, rule.thresholdDays, rule.protectWindowDays, rule.notifyBeforeHours],
      );
    }

    // --- 18. 赢单复盘（5 条已审核 + 1 条草稿；已审核行受 win_reviews_terminal_immutable 保护，只 INSERT）---
    const wonOpportunities = opportunities.filter((o) => o.stage === "WON");
    const winReviewRows: unknown[][] = [];
    wonOpportunities.forEach((o, i) => {
      const reviewed = i < 4; // 留最后一条为 DRAFT，让复盘列表同时有「待审核」与「已审核」
      winReviewRows.push([
        id("win_review", i), SEED_TENANT_ID, o.id,
        reviewed ? "REVIEWED" : "DRAFT",
        `演示复盘：${o.customer.name} 在 ${o.stageEnteredDaysAgo} 天内完成从初步接触到签约的关键动作是「每次沟通结束前确认下一步日期」。以上仅陈述已记录事实。`,
        JSON.stringify({
          effectiveFollowUpCount: 4 + (i % 4),
          cycleDays: o.createdDaysAgo,
          actualAmount: String(o.actualAmount ?? 0),
        }),
        JSON.stringify([
          { kind: "FACT", summary: "方案评审前确认了决策链与下次会议时间" },
          { kind: "FACT", summary: `按 ${3 + (i % 3)} 天节奏完成 ${4 + (i % 4)} 次有效推进` },
        ]),
        JSON.stringify(reviewed ? [] : ["缺少首次接触的原始沟通记录"]),
        reviewed ? managerUsers[i % managerUsers.length].id : null,
        reviewed ? "演示：事实与跟进记录一致，可作为团队打法样本" : null,
        reviewed ? shift(-(1 + i)) : null,
        shift(-o.createdDaysAgo + 1),
      ]);
    });
    await insertMany(
      client,
      "win_reviews",
      [
        "id", "tenant_id", "opportunity_id", "status", "summary", "metrics", "evidence", "data_gaps",
        "reviewed_by_user_id", "review_reason", "reviewed_at", "created_at",
      ],
      winReviewRows,
      { jsonbColumns: ["metrics", "evidence", "data_gaps"] },
    );

    // --- 19. 打法库（先以 DRAFT 落样本，再置为 PUBLISHED：样本对终态打法不可写）---
    // 只有已审核的复盘才能作为打法样本（DRAFT 未过审核闸门）
    const reviewedWinReviews = winReviewRows
      .filter((row) => row[3] === "REVIEWED")
      .map((row) => ({ id: row[0] as string, opportunityId: row[2] as string }));
    const playbookDefs = [
      {
        key: "enterprise-manufacturing-negotiation",
        name: "装备制造商务谈判推进法",
        targetStage: "NEGOTIATION",
        industries: ["装备制造", "汽车零部件"],
        regions: ["华东", "华北"],
        sizes: ["101-500", "501-1000", "1000+"],
        checkpoints: ["确认预算区间与决策链", "确认商务条款清单与最终审批人"],
        cadence: ["每 3 天至少一次有效推进", "每次沟通结束前确认下一步日期"],
        actions: ["带方案与报价同轮提交", "把异议逐条转为待办并指定责任人"],
        risks: ["只有口头认可但没有明确下一步时间", "关键决策人未出现在任何一次沟通中"],
      },
      {
        key: "electronics-new-business-discovery",
        name: "精密电子新客破冰法",
        targetStage: "DISCOVERY",
        industries: ["精密电子", "医疗器械"],
        regions: ["华南", "华东"],
        sizes: ["21-100", "101-500", "501-1000"],
        checkpoints: ["确认现用系统与最痛的一条流程", "确认谁是流程的实际使用者"],
        cadence: ["首周内完成 2 次触达", "每次触达后 24 小时内写活动记录"],
        actions: ["先约现场参观再谈方案", "用同行业实施案例替代产品参数"],
        risks: ["只有 IT 部门对接、业务部门缺席"],
      },
      {
        key: "logistics-proposal-standardization",
        name: "物流供应链方案标准化法",
        targetStage: "PROPOSAL",
        industries: ["物流供应链"],
        regions: ["华东", "西南"],
        sizes: ["501-1000", "1000+"],
        checkpoints: ["确认实施范围与里程碑", "确认历史数据迁移边界"],
        cadence: ["方案评审与报价在同一次会议提交", "每 5 天确认一次评审进度"],
        actions: ["用标准实施包报价并标注可选项", "把迁移工作量单独列项"],
        risks: ["实施范围持续扩大但报价未变"],
      },
    ];
    const playbookIds: string[] = [];
    for (const [seq, def] of playbookDefs.entries()) {
      const playbookId = id("sales_playbook", def.key);
      playbookIds.push(playbookId);
      const sampleReviews = reviewedWinReviews.slice(seq % 2, (seq % 2) + 3);
      await client.query(
        `insert into sales_playbooks (id, tenant_id, family_key, version, status, name, target_stage,
            applicable_industries, excluded_industries, applicable_regions, excluded_regions,
            applicable_customer_sizes, excluded_customer_sizes, checkpoints, recommended_cadence,
            effective_actions, common_risks, claim_evidence, created_by_user_id)
         values ($1, $2, $3, 1, 'DRAFT', $4, $5, $6::jsonb, '[]'::jsonb, $7::jsonb, '[]'::jsonb,
            $8::jsonb, '[]'::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14)
         on conflict (id) do nothing`,
        [
          playbookId, SEED_TENANT_ID, def.key, def.name, def.targetStage,
          JSON.stringify(def.industries), JSON.stringify(def.regions), JSON.stringify(def.sizes),
          JSON.stringify(def.checkpoints), JSON.stringify(def.cadence), JSON.stringify(def.actions),
          JSON.stringify(def.risks),
          JSON.stringify({
            checkpoints: sampleReviews.map((r) => r.id),
            recommendedCadence: sampleReviews.map((r) => r.id),
            effectiveActions: sampleReviews.map((r) => r.id),
            commonRisks: sampleReviews.map((r) => r.id),
          }),
          managerUsers[seq % managerUsers.length].id,
        ],
      );
      const status = await client.query<{ status: string }>("select status from sales_playbooks where id = $1", [playbookId]);
      // 仅在 DRAFT 状态下写样本：sales_playbook_samples 对终态打法有不可变触发器
      if (status.rows[0]?.status === "DRAFT") {
        await insertMany(
          client,
          "sales_playbook_samples",
          ["id", "tenant_id", "playbook_id", "win_review_id"],
          sampleReviews.map((r, i) => [
            id("sales_playbook_sample", `${def.key}-${i}`), SEED_TENANT_ID, playbookId, r.id,
          ]),
        );
        await client.query(
          `update sales_playbooks set status = 'PUBLISHED', published_by_user_id = $2,
             publish_reason = $3, published_at = now(), updated_at = now()
           where id = $1 and status = 'DRAFT'`,
          [playbookId, managerUsers[seq % managerUsers.length].id, "演示：与已审核赢单复盘逐条核对后发布"],
        );
      }
    }

    // --- 20. 通知（未读/已读混合；只用核心业务语义类型）---
    const notificationRows: unknown[][] = [];
    const addNotification = (row: {
      userId: string;
      type: string;
      title: string;
      body: string;
      link: string;
      taskId?: string;
      leadId?: string;
      opportunityId?: string;
      readHoursAgo: number | null;
    }): void => {
      notificationRows.push([
        id("notification", notificationRows.length + 1), SEED_TENANT_ID, row.userId, row.type,
        row.taskId ?? null, row.leadId ?? null, row.opportunityId ?? null, row.title, row.body, row.link,
        row.readHoursAgo === null ? null : shift(0, -row.readHoursAgo),
        shift(-(notificationRows.length % 6), -(notificationRows.length % 9)),
      ]);
    };
    const openLeadTasks = taskRows.filter((row) => row[2] !== null && row[10] === "OPEN").slice(0, 10);
    for (const [i, row] of openLeadTasks.entries()) {
      addNotification({
        userId: row[5] as string, type: i % 2 === 0 ? "TASK_OVERDUE" : "TASK_DUE_SOON",
        title: i % 2 === 0 ? "跟进任务已逾期" : "跟进任务今日到期",
        body: "演示通知：该线索的下一步跟进已超过计划时间，请今日内处理。",
        link: "/today", taskId: row[0] as string, leadId: row[2] as string,
        readHoursAgo: i % 3 === 0 ? null : i,
      });
    }
    leads.filter((l) => l.ownerIndex !== null).slice(0, 10).forEach((lead, i) => {
      addNotification({
        userId: salesUsers[lead.ownerIndex!].id, type: "LEAD_ASSIGNED",
        title: "新线索已分配给你",
        body: `演示通知：${lead.companyName} 通过${lead.channel}提交，已进入你的私海。`,
        link: "/leads", leadId: lead.id, readHoursAgo: i % 2 === 0 ? null : null,
      });
    });
    wonOpportunities.forEach((o, i) => {
      addNotification({
        userId: salesUsers[o.ownerIndex].id, type: "DEAL_WON",
        title: "恭喜：商机已赢单",
        body: `演示通知：${o.customer.name} 已完成签约，系统已生成复盘草稿。`,
        link: "/opportunities", opportunityId: o.id, readHoursAgo: i % 2 === 0 ? null : 5 + i,
      });
    });
    opportunities.filter((o) => o.stage === "NEGOTIATION").slice(0, 6).forEach((o, i) => {
      addNotification({
        userId: managerUsers[i % managerUsers.length].id, type: "MORNING_COPILOT",
        title: "晨间简报：今日重点跟进",
        body: `演示通知：${o.customer.name} 处于谈判阶段且 7 天内无有效推进记录。`,
        link: "/today", opportunityId: o.id, readHoursAgo: null,
      });
    });
    customers.slice(0, 8).forEach((c, i) => {
      addNotification({
        userId: salesUsers[c.ownerIndex].id, type: "RECYCLE_WARNING",
        title: "公海回收预警",
        body: `演示通知：${c.name} 超过 ${45} 天无跟进，将在保护期后回收到公海。`,
        link: "/customers", readHoursAgo: i % 2 === 0 ? null : 20 + i,
      });
    });
    await insertMany(
      client,
      "notifications",
      ["id", "tenant_id", "user_id", "type", "task_id", "lead_id", "opportunity_id", "title", "body", "link", "read_at", "created_at"],
      notificationRows,
    );

    // --- 21. 线索来源接入密钥（演示 API 留资通道）---
    const demoSourceTokens = ["demo-website-key-1", "demo-website-key-2"];
    for (const [seq, token] of demoSourceTokens.entries()) {
      const tokenHash = (await import("node:crypto")).createHash("sha256").update(token, "utf8").digest("hex");
      await client.query(
        `insert into lead_source_keys (id, tenant_id, name, source_key, token_hash, created_by_user_id, scopes, rate_limit_per_minute, last_used_at)
         values ($1, $2, $3, $4, $5, $6, '["leads:write"]'::jsonb, 60, $7)
         on conflict (id) do nothing`,
        [
          id("lead_source_key", seq), SEED_TENANT_ID, `演示网站来源 ${seq + 1}`,
          `website-${seq + 1}`, tokenHash, adminUser.id, shift(-(3 + seq)),
        ],
      );
    }

    await client.query("commit");

    const counts = await client.query<{ table_name: string; row_count: string }>(
      `select 'users' as table_name, count(*)::text as row_count from users where tenant_id = $1
       union all select 'departments', count(*)::text as row_count from departments where tenant_id = $1
       union all select 'leads', count(*)::text as row_count from leads where tenant_id = $1
       union all select 'customers', count(*)::text as row_count from customers where tenant_id = $1
       union all select 'contacts', count(*)::text as row_count from contacts where tenant_id = $1
       union all select 'opportunities', count(*)::text as row_count from opportunities where tenant_id = $1
       union all select 'opportunity_line_items', count(*)::text as row_count from opportunity_line_items where tenant_id = $1
       union all select 'tasks', count(*)::text as row_count from tasks where tenant_id = $1
       union all select 'activities', count(*)::text as row_count from activities where tenant_id = $1
       union all select 'notifications', count(*)::text as row_count from notifications where tenant_id = $1
       union all select 'sales_quotas', count(*)::text as row_count from sales_quotas where tenant_id = $1
       union all select 'win_reviews', count(*)::text as row_count from win_reviews where tenant_id = $1
       union all select 'sales_playbooks', count(*)::text as row_count from sales_playbooks where tenant_id = $1
       union all select 'score_rules', count(*)::text as row_count from score_rules where tenant_id = $1`,
      [SEED_TENANT_ID],
    );

    console.log(JSON.stringify({
      seed: "seed-demo-core（纯核心表演示数据）",
      tenantId: SEED_TENANT_ID,
      tenantName: TENANT_NAME,
      businessTimezone: "Asia/Shanghai",
      quotaPeriod: periodKey,
      adminEmail,
      adminPasswordSource: process.env.DEV_ADMIN_PASSWORD ? "DEV_ADMIN_PASSWORD" : "内置开发默认值 password123",
      leadSourceTokens: demoSourceTokens,
      rowCounts: Object.fromEntries(counts.rows.map((r) => [r.table_name, Number(r.row_count)])),
      createdAt: new Date(NOW_MS).toISOString(),
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [SEED_ADVISORY_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

// CLI 入口 guard：破坏性种子必须先过白名单/显式确认（fail-closed）
try {
  assertSeedAllowed();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
