"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Role } from "@/core/auth/types";
import MaskedPhone from "@/core/security/MaskedPhone";
import type { GlobalContactItem } from "@/core/customer/service";
import {
  addContact,
  listGlobalContactsAction,
  setPrimaryContact,
  updateContact,
} from "@/core/customer/actions";
import { Badge, Button, EmptyState } from "@/components/ui";

interface Props {
  role: Role;
  currentUserId: string;
  initialContacts: GlobalContactItem[];
  initialScope: "MY" | "PUBLIC" | "ALL";
  initialRoleTag: string;
  initialSearch: string;
}

const ROLE_TAG_CONFIG: Record<
  string,
  { label: string; shortLabel: string; variant: "purple" | "blue" | "teal" | "amber" | "emerald" | "neutral" }
> = {
  DECISION_MAKER: { label: "决策拍板人 (EB)", shortLabel: "拍板人 EB", variant: "purple" },
  PROCUREMENT: { label: "商务采购", shortLabel: "采购", variant: "blue" },
  TECH_EVALUATOR: { label: "技术把关/评估人", shortLabel: "技术把关", variant: "teal" },
  FINANCE: { label: "财务把关人", shortLabel: "财务", variant: "amber" },
  USER: { label: "最终使用人", shortLabel: "使用者", variant: "emerald" },
  OTHER: { label: "其他人员", shortLabel: "其他", variant: "neutral" },
};

interface AccountGroupItem {
  customerId: string;
  customerName: string;
  customerType: string;
  customerOwnerUserId: string | null;
  customerOwnerUserName: string | null;
  inPublicPool: boolean;
  opportunityCount: number;
  contacts: GlobalContactItem[];
  primaryContact: GlobalContactItem | null;
  decisionMakerCount: number;
  procurementCount: number;
  technicalCount: number;
  championCount: number;
  totalRoles: number;
}

export default function ContactsClient({
  role,
  currentUserId,
  initialContacts,
  initialScope,
  initialRoleTag,
  initialSearch,
}: Props) {
  const [contacts, setContacts] = useState<GlobalContactItem[]>(initialContacts);
  const [scope, setScope] = useState<"MY" | "PUBLIC" | "ALL">(initialScope);
  const [roleTag, setRoleTag] = useState<string>(initialRoleTag);
  const [search, setSearch] = useState<string>(initialSearch);
  const [viewMode, setViewMode] = useState<"FLAT" | "ACCOUNT">("FLAT"); // 默认高密度个人列表，支持万级快速检索
  const [expandedCustomerIds, setExpandedCustomerIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 新建联系人模态窗状态
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    customerId: "",
    name: "",
    phone: "",
    email: "",
    title: "",
    roleTag: "DECISION_MAKER",
    isPrimary: false,
  });

  // 编辑联系人模态窗状态
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<GlobalContactItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    title: "",
    roleTag: "DECISION_MAKER",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";

  // 去重提取可选客户列表供新建使用
  const uniqueCustomers = useMemo(() => {
    const map = new Map<string, string>();
    contacts.forEach((c) => {
      if (!map.has(c.customerId)) {
        map.set(c.customerId, c.customerName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [contacts]);

  // 企业单位聚合图谱数据结构
  const accountGroups = useMemo<AccountGroupItem[]>(() => {
    const map = new Map<string, AccountGroupItem>();
    contacts.forEach((c) => {
      let group = map.get(c.customerId);
      if (!group) {
        group = {
          customerId: c.customerId,
          customerName: c.customerName,
          customerType: c.customerType,
          customerOwnerUserId: c.customerOwnerUserId,
          customerOwnerUserName: c.customerOwnerUserName,
          inPublicPool: c.inPublicPool,
          opportunityCount: c.opportunityCount,
          contacts: [],
          primaryContact: null,
          decisionMakerCount: 0,
          procurementCount: 0,
          technicalCount: 0,
          championCount: 0,
          totalRoles: 0,
        };
        map.set(c.customerId, group);
      }
      group.contacts.push(c);
      if (c.isPrimary && !group.primaryContact) {
        group.primaryContact = c;
      }
      if (c.roleTag === "DECISION_MAKER") group.decisionMakerCount++;
      else if (c.roleTag === "PROCUREMENT") group.procurementCount++;
      else if (c.roleTag === "TECH_EVALUATOR") group.technicalCount++;
      else if (c.roleTag === "FINANCE") group.championCount++;
    });

    const groups = Array.from(map.values());
    groups.forEach((g) => {
      // 内部排序：主联系人置顶，其次按关键角色权重排序
      g.contacts.sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        const roleOrder: Record<string, number> = {
          DECISION_MAKER: 1,
          TECH_EVALUATOR: 2,
          FINANCE: 3,
          PROCUREMENT: 4,
          USER: 5,
          OTHER: 6,
        };
        const rA = roleOrder[a.roleTag] || 99;
        const rB = roleOrder[b.roleTag] || 99;
        return rA - rB;
      });

      const uniqueRoles = new Set(g.contacts.map((c) => c.roleTag));
      g.totalRoles = uniqueRoles.size;
      if (!g.primaryContact && g.contacts.length > 0) {
        g.primaryContact = g.contacts[0];
      }
    });

    return groups;
  }, [contacts]);

  // 折叠与展开控制
  const toggleExpand = (customerId: string) => {
    setExpandedCustomerIds((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  };

  const handleToggleExpandAll = () => {
    if (expandedCustomerIds.size === accountGroups.length) {
      setExpandedCustomerIds(new Set());
    } else {
      setExpandedCustomerIds(new Set(accountGroups.map((g) => g.customerId)));
    }
  };

  // 统计概览指标
  const metrics = useMemo(() => {
    const totalContacts = contacts.length;
    const totalAccounts = accountGroups.length;
    const totalDecisionMakers = contacts.filter((c) => c.roleTag === "DECISION_MAKER").length;
    const totalFinance = contacts.filter((c) => c.roleTag === "FINANCE").length;
    return { totalContacts, totalAccounts, totalDecisionMakers, totalFinance };
  }, [contacts, accountGroups]);

  // 触发筛选重查
  const handleQuery = (newScope?: "MY" | "PUBLIC" | "ALL", newRoleTag?: string, newSearch?: string) => {
    const s = newScope ?? scope;
    const r = newRoleTag !== undefined ? newRoleTag : roleTag;
    const q = newSearch !== undefined ? newSearch : search;

    startTransition(async () => {
      const res = await listGlobalContactsAction({
        scope: s,
        roleTag: r === "ALL" ? undefined : r,
        search: q || undefined,
      });

      if (res.ok && res.data) {
        setContacts(res.data);
      }
    });
  };

  // 打开编辑联系人
  const handleOpenEdit = (contact: GlobalContactItem) => {
    setEditingContact(contact);
    setEditForm({
      name: contact.name,
      phone: contact.phone,
      email: contact.email || "",
      title: contact.title || "",
      roleTag: contact.roleTag || "OTHER",
    });
    setIsEditModalOpen(true);
  };

  // 快速打开针对某家企业的新建联系人
  const handleOpenCreateForAccount = (customerId: string) => {
    setCreateForm({
      customerId,
      name: "",
      phone: "",
      email: "",
      title: "",
      roleTag: "DECISION_MAKER",
      isPrimary: false,
    });
    setIsCreateModalOpen(true);
  };

  // 设为主联系人
  const handleSetPrimary = async (customerId: string, contactId: string) => {
    setFeedback(null);
    const res = await setPrimaryContact({ customerId, contactId });
    if (res.ok) {
      setFeedback({ type: "success", text: "已成功设为该企业主联系人" });
      handleQuery();
    } else {
      setFeedback({ type: "error", text: res.message || "设置失败" });
    }
  };

  // 保存新建联系人
  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.customerId || !createForm.name.trim() || !createForm.phone.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await addContact({
        customerId: createForm.customerId,
        name: createForm.name.trim(),
        phone: createForm.phone.trim(),
        email: createForm.email.trim() || undefined,
        title: createForm.title.trim() || undefined,
        roleTag: createForm.roleTag.trim() || undefined,
        isPrimary: createForm.isPrimary,
      });

      if (res.ok) {
        setIsCreateModalOpen(false);
        setCreateForm({
          customerId: "",
          name: "",
          phone: "",
          email: "",
          title: "",
          roleTag: "DECISION_MAKER",
          isPrimary: false,
        });
        setFeedback({ type: "success", text: "新联系人已成功录入系统" });
        handleQuery();
      } else {
        setFeedback({ type: "error", text: res.message || "创建失败" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 保存编辑联系人
  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact || isSubmitting) return;

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const res = await updateContact({
        contactId: editingContact.id,
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        email: editForm.email.trim() || undefined,
        title: editForm.title.trim() || undefined,
        roleTag: editForm.roleTag.trim() || undefined,
      });

      if (res.ok) {
        setIsEditModalOpen(false);
        setFeedback({ type: "success", text: "联系人信息已成功更新" });
        handleQuery();
      } else {
        setFeedback({ type: "error", text: res.message || "更新失败" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 头部区域与双重视角说明 */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              销售管线
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-950">联系人脉</h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {contacts.length} 位联系人 · {accountGroups.length} 家企业客户
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            企业客户组织决策链图谱，支持按个人全景速查与按企业折叠透视决策阵型（EB 拍板人/采购/技术教练）
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              if (uniqueCustomers.length > 0 && !createForm.customerId) {
                setCreateForm((prev) => ({ ...prev, customerId: uniqueCustomers[0].id }));
              }
              setIsCreateModalOpen(true);
            }}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            新建联系人
          </Button>
          <Link href="/customers">
            <Button variant="secondary" size="md">
              前往客户管理
            </Button>
          </Link>
        </div>
      </header>

      {/* 核心指标微卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="text-[11px] font-medium text-slate-500">人脉库总数</div>
          <div className="mt-1 text-lg font-bold font-mono text-slate-900">{metrics.totalContacts} <span className="text-xs font-normal text-slate-400">人</span></div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
          <div className="text-[11px] font-medium text-slate-500">覆盖企业单位</div>
          <div className="mt-1 text-lg font-bold font-mono text-slate-900">{metrics.totalAccounts} <span className="text-xs font-normal text-slate-400">家</span></div>
        </div>
        <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-3.5 shadow-2xs">
          <div className="text-[11px] font-medium text-purple-700">决策拍板人 (EB)</div>
          <div className="mt-1 text-lg font-bold font-mono text-purple-950">{metrics.totalDecisionMakers} <span className="text-xs font-normal text-purple-600">人</span></div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 shadow-2xs">
          <div className="text-[11px] font-medium text-amber-700">财务把关人 (Finance)</div>
          <div className="mt-1 text-lg font-bold font-mono text-amber-950">{metrics.totalFinance} <span className="text-xs font-normal text-amber-600">人</span></div>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`rounded-xl p-3.5 text-xs font-semibold flex items-center justify-between shadow-2xs transition ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* 筛选与搜索工具条（集成双重视角切换器） */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs">
        {/* 状态与私海/公海 Tabs */}
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-lg border border-slate-200/70 shadow-2xs">
          <button
            type="button"
            onClick={() => {
              setScope("MY");
              handleQuery("MY");
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              scope === "MY"
                ? "bg-white text-slate-950 font-bold shadow-2xs border border-slate-200/80"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
            }`}
          >
            我的私海联系人
          </button>
          <button
            type="button"
            onClick={() => {
              setScope("PUBLIC");
              handleQuery("PUBLIC");
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              scope === "PUBLIC"
                ? "bg-white text-slate-950 font-bold shadow-2xs border border-slate-200/80"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
            }`}
          >
            公海池联系人
          </button>
          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => {
                setScope("ALL");
                handleQuery("ALL");
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                scope === "ALL"
                  ? "bg-white text-slate-950 font-bold shadow-2xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/60"
              }`}
            >
              全公司所有人脉
            </button>
          )}
        </div>

        {/* 角色筛选、搜索栏与视角切换器 */}
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2.5 min-w-[min(100%,22rem)]">
          {/* 角色筛选 */}
          <select
            value={roleTag}
            onChange={(e) => {
              const next = e.target.value;
              setRoleTag(next);
              handleQuery(undefined, next);
            }}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 outline-none cursor-pointer focus:border-slate-900"
          >
            <option value="ALL">全部决策角色</option>
            <option value="DECISION_MAKER">决策拍板人 (EB)</option>
            <option value="PROCUREMENT">商务采购</option>
            <option value="TECH_EVALUATOR">技术评估人</option>
            <option value="FINANCE">财务把关人</option>
            <option value="USER">最终使用人</option>
            <option value="OTHER">其他人员</option>
          </select>

          {/* 现代化集成搜索栏 */}
          <div className="relative flex items-center min-w-[180px] flex-1 sm:max-w-xs">
            <svg
              className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              aria-label="搜索姓名、手机、职务或企业"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleQuery(undefined, undefined, search);
              }}
              placeholder="搜索姓名、手机、职务、企业..."
              className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 transition shadow-2xs placeholder:text-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  handleQuery(undefined, undefined, "");
                }}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 text-xs font-bold cursor-pointer"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>

          {/* 视图切换器 (Segmented Control: 个人平铺列表 vs 企业折叠树状表格) */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200/80 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode("FLAT")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                viewMode === "FLAT"
                  ? "bg-white text-slate-950 shadow-2xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="按个人平铺列表：高密度快速检索、按角色过滤"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
              <span>个人列表</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("ACCOUNT")}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                viewMode === "ACCOUNT"
                  ? "bg-white text-slate-950 shadow-2xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
              title="按企业组织聚合：高密度折叠表格，透视企业决策阵型"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.75c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12l6 4.5V21" />
              </svg>
              <span>企业聚合</span>
            </button>
          </div>
        </div>
      </div>

      {/* 视图 1：个人列表平铺视图 (Flat Table View，默认核心视图，支持万级检索) */}
      {viewMode === "FLAT" && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          {contacts.length === 0 ? (
            <EmptyState
              title={scope === "PUBLIC" ? "公海池暂无联系人" : "暂未检索到联系人"}
              description={
                scope === "PUBLIC"
                  ? "公海池中的客户联系人将集中在此展示，如需跟进请前往「客户管理」领取对应客户。"
                  : "请尝试调整角色筛选条件，或在客户档案中添加关键联系人。"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">联系人姓名 / 职务</th>
                    <th className="py-3 px-4">所属客户企业</th>
                    <th className="py-3 px-4">组织决策角色</th>
                    <th className="py-3 px-4">联系方式</th>
                    <th className="py-3 px-4">客户归属状态</th>
                    <th className="py-3 px-4">关联商机</th>
                    <th className="py-3 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {contacts.map((c) => {
                    const roleConfig = ROLE_TAG_CONFIG[c.roleTag] || ROLE_TAG_CONFIG.OTHER;

                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* 姓名与职务 */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{c.name}</span>
                            {c.isPrimary && (
                              <span className="rounded-sm bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.2 text-[10px] font-semibold">
                                主联系人
                              </span>
                            )}
                          </div>
                          {c.title ? (
                            <div className="text-[11px] text-slate-500 mt-0.5">{c.title}</div>
                          ) : (
                            <div className="text-[11px] text-slate-400 mt-0.5">未填写职务</div>
                          )}
                        </td>

                        {/* 所属企业 */}
                        <td className="py-3 px-4">
                          <Link
                            href={`/customers/${c.customerId}`}
                            className="font-medium text-slate-900 hover:text-blue-600 hover:underline"
                          >
                            {c.customerName}
                          </Link>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {c.customerType === "ENTERPRISE" ? "单位客户" : "个人客户"}
                          </div>
                        </td>

                        {/* 决策角色 */}
                        <td className="py-3 px-4">
                          <Badge variant={roleConfig.variant} size="sm">
                            {roleConfig.label}
                          </Badge>
                        </td>

                        {/* 联系方式 */}
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-700">
                          <div className="flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                            </svg>
                            <MaskedPhone phone={c.phone} entityType="CONTACT" entityId={c.id} reason="人脉库检索联系人后电话联络" showCopy={true} />
                          </div>
                          {c.email && (
                            <div className="flex items-center gap-1.5 text-slate-400 text-[10px] mt-0.5">
                              <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                              </svg>
                              <span>{c.email}</span>
                            </div>
                          )}
                        </td>

                        {/* 归属状态与公海 */}
                        <td className="py-3 px-4">
                          {c.inPublicPool ? (
                            <Badge variant="amber" dot size="sm">
                              公海池客户
                            </Badge>
                          ) : (
                            <Badge variant="emerald" dot size="sm">
                              {c.customerOwnerUserId === currentUserId
                                ? "我的私海"
                                : c.customerOwnerUserName || "私海"}
                            </Badge>
                          )}
                        </td>

                        {/* 关联商机 */}
                        <td className="py-3 px-4 font-medium text-slate-600">
                          {c.opportunityCount > 0 ? (
                            <span className="text-slate-900 font-bold">{c.opportunityCount} 个在途商机</span>
                          ) : (
                            <span className="text-slate-400">暂无商机</span>
                          )}
                        </td>

                        {/* 操作 */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="xs"
                              onClick={() => handleOpenEdit(c)}
                            >
                              编辑
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 视图 2：企业组织聚合表格 (Compact Expandable Table，高信息密度，支持成千上万家企业折叠透视) */}
      {viewMode === "ACCOUNT" && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
          {/* 工具条：折叠全部 / 展开全部 */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/80 border-b border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800">企业决策链名录</span>
              <span className="text-slate-400 font-mono text-[11px]">
                共 {accountGroups.length} 家企业 · {contacts.length} 位联系人
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="text-[11px] font-medium text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-200/60 transition cursor-pointer"
            >
              {expandedCustomerIds.size === accountGroups.length ? "全部折叠" : "全部展开"}
            </button>
          </div>

          {accountGroups.length === 0 ? (
            <EmptyState
              title={scope === "PUBLIC" ? "公海池暂无企业联系人" : "暂未检索到企业联系人"}
              description={
                scope === "PUBLIC"
                  ? "公海池客户的联系人将在此聚合展示，如需跟进请前往「客户管理」领取对应客户。"
                  : "请尝试调整角色筛选或搜索关键词。"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-2.5 px-3 w-8 text-center"></th>
                    <th className="py-2.5 px-4">客户企业名称</th>
                    <th className="py-2.5 px-4">企业归属</th>
                    <th className="py-2.5 px-4">人脉规模</th>
                    <th className="py-2.5 px-4">决策拍板人 (EB)</th>
                    <th className="py-2.5 px-4">角色覆盖分布</th>
                    <th className="py-2.5 px-4">在途商机</th>
                    <th className="py-2.5 px-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accountGroups.map((group) => {
                    const isExpanded = expandedCustomerIds.has(group.customerId);

                    return (
                      <Fragment key={group.customerId}>
                        {/* 企业主行 */}
                        <tr
                          onClick={() => toggleExpand(group.customerId)}
                          className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                        >
                          {/* 展开收起指示图标 */}
                          <td className="py-3 px-3 text-center">
                            <svg
                              className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 ${
                                isExpanded ? "rotate-90 text-slate-800" : ""
                              }`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                          </td>

                          {/* 企业名称 */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 hover:text-blue-600">
                                {group.customerName}
                              </span>
                              <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.2 text-[10px] font-medium">
                                {group.customerType === "ENTERPRISE" ? "企业" : "个人"}
                              </span>
                            </div>
                          </td>

                          {/* 归属状态 */}
                          <td className="py-3 px-4">
                            {group.inPublicPool ? (
                              <Badge variant="amber" dot size="sm">
                                公海池
                              </Badge>
                            ) : (
                              <Badge variant="emerald" dot size="sm">
                                {group.customerOwnerUserId === currentUserId
                                  ? "我的私海"
                                  : group.customerOwnerUserName || "私海"}
                              </Badge>
                            )}
                          </td>

                          {/* 人脉规模 */}
                          <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                            {group.contacts.length} 人
                          </td>

                          {/* 核心拍板人 (EB) 状态 */}
                          <td className="py-3 px-4">
                            {group.decisionMakerCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                                <svg className="w-3 h-3 text-purple-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>
                                  {group.primaryContact?.roleTag === "DECISION_MAKER"
                                    ? group.primaryContact.name
                                    : group.contacts.find((c) => c.roleTag === "DECISION_MAKER")?.name || "已锁定"}
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                <svg className="w-3 h-3 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span>待补齐 EB</span>
                              </span>
                            )}
                          </td>

                          {/* 决策角色覆盖小胶囊 */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1 flex-wrap">
                              {group.decisionMakerCount > 0 && (
                                <span className="rounded bg-purple-50 text-purple-700 px-1.5 py-0.2 text-[10px] font-semibold border border-purple-200">
                                  EB:{group.decisionMakerCount}
                                </span>
                              )}
                              {group.procurementCount > 0 && (
                                <span className="rounded bg-blue-50 text-blue-700 px-1.5 py-0.2 text-[10px] font-semibold border border-blue-200">
                                  采购:{group.procurementCount}
                                </span>
                              )}
                              {group.technicalCount > 0 && (
                                <span className="rounded bg-teal-50 text-teal-700 px-1.5 py-0.2 text-[10px] font-semibold border border-teal-200">
                                  技术:{group.technicalCount}
                                </span>
                              )}
                              {group.championCount > 0 && (
                                <span className="rounded bg-amber-50 text-amber-700 px-1.5 py-0.2 text-[10px] font-semibold border border-amber-200">
                                  教练:{group.championCount}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 在途商机 */}
                          <td className="py-3 px-4 font-mono text-slate-700">
                            {group.opportunityCount > 0 ? (
                              <span className="font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded text-[11px]">
                                {group.opportunityCount} 个商机
                              </span>
                            ) : (
                              <span className="text-slate-400">无商机</span>
                            )}
                          </td>

                          {/* 行内操作 */}
                          <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="secondary"
                                size="xs"
                                onClick={() => handleOpenCreateForAccount(group.customerId)}
                              >
                                + 联系人
                              </Button>
                              <Link href={`/customers/${group.customerId}`}>
                                <Button variant="secondary" size="xs">
                                  进入客户
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>

                        {/* 展开的联系人子明细抽屉列表 */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70 border-y border-slate-200/80">
                            <td colSpan={8} className="p-3 sm:p-4 pl-8 sm:pl-10">
                              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-2xs">
                                <table className="w-full text-left text-xs border-collapse">
                                  <thead>
                                    <tr className="bg-slate-100/80 text-[10.5px] font-semibold text-slate-500 border-b border-slate-200">
                                      <th className="py-2 px-3">联系人姓名 / 职务</th>
                                      <th className="py-2 px-3">组织决策角色</th>
                                      <th className="py-2 px-3">联系电话</th>
                                      <th className="py-2 px-3">工作邮箱</th>
                                      <th className="py-2 px-3">主联系人状态</th>
                                      <th className="py-2 px-3 text-right">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {group.contacts.map((c) => {
                                      const roleConfig = ROLE_TAG_CONFIG[c.roleTag] || ROLE_TAG_CONFIG.OTHER;

                                      return (
                                        <tr key={c.id} className="hover:bg-slate-50/80">
                                          <td className="py-2.5 px-3">
                                            <span className="font-bold text-slate-900">{c.name}</span>
                                            <span className="text-slate-500 ml-2 text-[11px]">
                                              {c.title || "未注明职务"}
                                            </span>
                                          </td>
                                          <td className="py-2.5 px-3">
                                            <Badge variant={roleConfig.variant} size="sm">
                                              {roleConfig.label}
                                            </Badge>
                                          </td>
                                          <td className="py-2.5 px-3 font-mono text-[11px]">
                                            <MaskedPhone
                                              phone={c.phone}
                                              entityType="CONTACT"
                                              entityId={c.id}
                                              reason="企业聚合视图核对决策链联系人"
                                              showCopy={true}
                                            />
                                          </td>
                                          <td className="py-2.5 px-3 font-mono text-slate-500 text-[11px]">
                                            {c.email || "未填写"}
                                          </td>
                                          <td className="py-2.5 px-3">
                                            {c.isPrimary ? (
                                              <span className="text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded text-[10px] font-bold">
                                                首要联络窗口
                                              </span>
                                            ) : (
                                              <button
                                                type="button"
                                                onClick={() => handleSetPrimary(c.customerId, c.id)}
                                                className="text-[10px] text-slate-500 hover:text-blue-600 transition cursor-pointer font-medium"
                                              >
                                                设为主联系人
                                              </button>
                                            )}
                                          </td>
                                          <td className="py-2.5 px-3 text-right">
                                            <Button
                                              variant="secondary"
                                              size="xs"
                                              onClick={() => handleOpenEdit(c)}
                                            >
                                              编辑
                                            </Button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 新建联系人模态窗 */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">新建企业联系人</h3>
                <p className="text-xs text-slate-500 mt-0.5">挂载关键人脉至对应企业客户档案</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateContact} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">所属客户企业 *</label>
                {uniqueCustomers.length > 0 ? (
                  <select
                    required
                    value={createForm.customerId}
                    onChange={(e) => setCreateForm({ ...createForm, customerId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none bg-white"
                  >
                    <option value="">请选择所属企业客户...</option>
                    {uniqueCustomers.map((cust) => (
                      <option key={cust.id} value={cust.id}>
                        {cust.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-slate-400 text-xs">暂无企业客户，请先在客户管理中创建客户</p>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">联系人姓名 *</label>
                <input
                  type="text"
                  required
                  placeholder="例如：王建国"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">组织决策角色 *</label>
                <select
                  value={createForm.roleTag}
                  onChange={(e) => setCreateForm({ ...createForm, roleTag: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none bg-white"
                >
                  <option value="DECISION_MAKER">决策拍板人 (Economic Buyer / EB)</option>
                  <option value="PROCUREMENT">商务采购 (Procurement)</option>
                  <option value="TECH_EVALUATOR">技术评估/把关人 (Tech Evaluator)</option>
                  <option value="FINANCE">财务把关人 (Finance)</option>
                  <option value="USER">最终使用人 (End User)</option>
                  <option value="OTHER">其他关联人员 (Other)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">职务头衔</label>
                <input
                  type="text"
                  placeholder="例如：技术副总裁 / 采购总监"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">手机号码 *</label>
                <input
                  type="tel"
                  required
                  placeholder="13800000000"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">工作邮箱</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmitting}
                >
                  录入联系人
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑联系人信息模态窗 */}
      {isEditModalOpen && editingContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-950">编辑联系人信息</h3>
                <p className="text-xs text-slate-500 mt-0.5">所属企业：{editingContact.customerName}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold cursor-pointer"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">姓名 *</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">组织决策角色 *</label>
                <select
                  value={editForm.roleTag}
                  onChange={(e) => setEditForm({ ...editForm, roleTag: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none bg-white"
                >
                  <option value="DECISION_MAKER">决策拍板人 (Economic Buyer / EB)</option>
                  <option value="PROCUREMENT">商务采购 (Procurement)</option>
                  <option value="TECH_EVALUATOR">技术评估/把关人 (Tech Evaluator)</option>
                  <option value="FINANCE">财务把关人 (Finance)</option>
                  <option value="USER">最终使用人 (End User)</option>
                  <option value="OTHER">其他关联人员 (Other)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">职务头衔</label>
                <input
                  type="text"
                  placeholder="例如：技术副总裁 / 采购总监"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">手机号码 *</label>
                <input
                  type="tel"
                  required
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">工作邮箱</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-slate-900 font-mono focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmitting}
                >
                  保存更新
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
