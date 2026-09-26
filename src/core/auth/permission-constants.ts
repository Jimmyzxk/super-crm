export const PERMISSIONS = {
  // 产品与报价 (CPQ)
  PRODUCTS_MANAGE: "products:manage",
  PRODUCTS_VIEW: "products:view",

  // 商机与审批 (Deals)
  OPPORTUNITIES_MANAGE_ALL: "opportunities:manage_all",
  OPPORTUNITIES_INTERVENE: "opportunities:intervene",
  OPPORTUNITIES_APPROVE_WIN_REVIEW: "opportunities:approve_win_review",

  // 线索与公海 (Leads)
  LEADS_ASSIGN: "leads:assign",
  LEADS_MANAGE_SCORING: "leads:manage_scoring",
  LEADS_MANAGE_POOL_RULES: "leads:manage_pool_rules",
  LEADS_CLAIM: "leads:claim",

  // 客户资产 (Customers)
  CUSTOMERS_MANAGE_ALL: "customers:manage_all",
  CUSTOMERS_EXPORT: "customers:export",
  CUSTOMERS_MANAGE_CAPACITY: "customers:manage_capacity",

  // 经营分析与策略 (Analytics & Playbooks)
  ANALYTICS_VIEW_TEAM: "analytics:view_team",
  PLAYBOOKS_PUBLISH: "playbooks:publish",

  // 系统与组织架构 (System)
  ORGANIZATION_MANAGE: "organization:manage",
  SECURITY_MANAGE: "security:manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionItemMeta {
  key: PermissionKey;
  name: string;
  description: string;
  category: "PRODUCTS" | "OPPORTUNITIES" | "LEADS" | "CUSTOMERS" | "ANALYTICS" | "SYSTEM";
}

export const ALL_PERMISSION_DEFINITIONS: PermissionItemMeta[] = [
  // 1. 产品与报价
  {
    key: PERMISSIONS.PRODUCTS_MANAGE,
    name: "标准产品 SKU 库与价格制定",
    description: "新增/编辑在售产品 SKU、调整基准单价、计费模式（订阅/买断/人月）与产品归档",
    category: "PRODUCTS",
  },
  {
    key: PERMISSIONS.PRODUCTS_VIEW,
    name: "产品价目表查阅与商机选配",
    description: "查阅企业标准产品目录并在商机立项/抽屉中挑选产品进行自动金额核算",
    category: "PRODUCTS",
  },

  // 2. 商机与战情室
  {
    key: PERMISSIONS.OPPORTUNITIES_MANAGE_ALL,
    name: "跨人员全团队商机查看与管理",
    description: "查看团队或跨部门所有商机管线，协助推进高价值商机",
    category: "OPPORTUNITIES",
  },
  {
    key: PERMISSIONS.OPPORTUNITIES_INTERVENE,
    name: "战情介入辅导与特批底价审批",
    description: "处理销售发起的联合高层拜访申请、批复 9.5 折等战略折扣特批意见",
    category: "OPPORTUNITIES",
  },
  {
    key: PERMISSIONS.OPPORTUNITIES_APPROVE_WIN_REVIEW,
    name: "赢单复盘审核与战法全员发布",
    description: "审核销售提交的赢单攻坚报告，将标杆打法一键萃取沉淀并向全员发布战法",
    category: "OPPORTUNITIES",
  },

  // 3. 营销线索与公海
  {
    key: PERMISSIONS.LEADS_ASSIGN,
    name: "跨销售批量派单与资源调配",
    description: "将新线索或撞单客户在不同销售顾问之间重新指派分配与收回",
    category: "LEADS",
  },
  {
    key: PERMISSIONS.LEADS_MANAGE_SCORING,
    name: "AI 潜客智能评分引擎权重",
    description: "配置高管决策人（VP/CTO）、企业规模、预算区间等维度的动态加减分规则",
    category: "LEADS",
  },
  {
    key: PERMISSIONS.LEADS_MANAGE_POOL_RULES,
    name: "公海流转与超期回收规则配置",
    description: "配置线索未跟进回收天数（如 7 天）、客户沉睡回收天数（如 30 天）及提前告警机制",
    category: "LEADS",
  },
  {
    key: PERMISSIONS.LEADS_CLAIM,
    name: "公共线索公海自主认领",
    description: "一线销售在自身库容未满时，从公共公海池中自主捞取并转化高价值线索",
    category: "LEADS",
  },

  // 4. 客户资产与库容
  {
    key: PERMISSIONS.CUSTOMERS_MANAGE_ALL,
    name: "跨人员全团队客户档案管理",
    description: "查看并维护全团队客户档案、决策链图谱与跟进记录",
    category: "CUSTOMERS",
  },
  {
    key: PERMISSIONS.CUSTOMERS_EXPORT,
    name: "客户与商机数据批量导出",
    description: "导出企业级客户与商机全量 CSV/Excel 数据（受脱敏与屏幕安全明水印审计管控）",
    category: "CUSTOMERS",
  },
  {
    key: PERMISSIONS.CUSTOMERS_MANAGE_CAPACITY,
    name: "下属销售私海库容额度调配",
    description: "针对不同资历销售动态调整个人专属私海客户数量上限（如 50/100 户）防止恶意占坑",
    category: "CUSTOMERS",
  },

  // 5. 经营分析与战法
  {
    key: PERMISSIONS.ANALYTICS_VIEW_TEAM,
    name: "团队/跨部门经营分析大盘查看",
    description: "查阅部门整体销售转化漏斗、业绩人效排名与丢单归因聚类分析",
    category: "ANALYTICS",
  },
  {
    key: PERMISSIONS.PLAYBOOKS_PUBLISH,
    name: "标杆销售打法与战法发布",
    description: "将经过实战验证的优秀打法沉淀为全员可学习的标准 Playbook",
    category: "ANALYTICS",
  },

  // 6. 系统管理与安全合规
  {
    key: PERMISSIONS.ORGANIZATION_MANAGE,
    name: "部门架构与员工角色授权",
    category: "SYSTEM",
    description: "管理部门树层级、团队成员增删改查、自定义角色与模块权限授权",
  },
  {
    key: PERMISSIONS.SECURITY_MANAGE,
    name: "等保合规与安全审计配置",
    category: "SYSTEM",
    description: "配置手机邮箱脱敏规则、屏幕安全明水印与三员分立审计日志",
  },
];

export const PERMISSION_CATEGORY_NAMES: Record<
  PermissionItemMeta["category"],
  { name: string; tag: string; color: string }
> = {
  PRODUCTS: { name: "产品与报价 (CPQ)", tag: "定价权", color: "text-blue-700 bg-blue-50 border-blue-200" },
  OPPORTUNITIES: { name: "商机与战情室", tag: "战情审批", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  LEADS: { name: "线索与公海治理", tag: "线索运营", color: "text-indigo-700 bg-indigo-50 border-indigo-200" },
  CUSTOMERS: { name: "客户资产管理", tag: "客户资产", color: "text-purple-700 bg-purple-50 border-purple-200" },
  ANALYTICS: { name: "经营分析与战法", tag: "战法赋能", color: "text-amber-700 bg-amber-50 border-amber-200" },
  SYSTEM: { name: "组织与系统安全", tag: "底座安全", color: "text-rose-700 bg-rose-50 border-rose-200" },
};

