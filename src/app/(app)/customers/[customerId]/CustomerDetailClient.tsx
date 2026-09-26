"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import {
  addContact,
  deleteContact,
  deleteCustomer,
  getCustomerDetailCollection,
  setPrimaryContact,
  updateContact,
  updateCustomer,
} from "@/core/customer/actions";
import { createOpportunity } from "@/core/opportunity/actions";
import { logActivity, rescheduleTask } from "@/core/followup/actions";
import { listProductsAction } from "@/core/products/actions";
import type { ProductItem } from "@/core/products/types";
import MaskedPhone from "@/core/security/MaskedPhone";
import type {
  CustomerDetail,
  CustomerDetailCollectionPage,
  CustomerDetailContact,
  CustomerDetailOpenTask,
  CustomerDetailOpportunity,
  CustomerDetailSourceLead,
} from "@/core/customer/types";
import { formatAmountInCents, stageLabel, taskLabel } from "@/core/shared/display";
import { dateInputValue, parseLocalDate } from "@/core/shared/date";

type ActionResult = { ok: boolean; message?: string; data?: unknown };
const progressingStageRank: Record<string, number> = { DISCOVERY: 1, PROPOSAL: 2, NEGOTIATION: 3 };
type CollectionState<T> = { items: T[]; nextCursor: string | null; loading: boolean; error: string | null };

function collectionState<T>(items: T[], nextCursor: string | null): CollectionState<T> {
  return { items, nextCursor, loading: false, error: null };
}

function appendUnique<T>(current: T[], next: T[], key: (item: T) => string): T[] {
  const seen = new Set(current.map(key));
  return [...current, ...next.filter((item) => !seen.has(key(item)) && (seen.add(key(item)), true))];
}

export default function CustomerDetailClient({
  initial,
  initialAction,
  role,
}: {
  initial: CustomerDetail;
  initialAction?: string;
  role?: string;
}) {
  const initialPanel =
    initialAction === "followup"
      ? "activity"
      : initialAction === "reschedule"
      ? initial.openTasks[0]
        ? `task-${initial.openTasks[0].id}`
        : null
      : initialAction ?? null;

  const [panel, setPanel] = useState<string | null>(initialPanel);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  const customer = initial.customer;

  const [sourceLeadNames, setSourceLeadNames] = useState(() =>
    collectionState(initial.sourceLeads, initial.truncation.sourceLeadNames.nextCursor),
  );
  const [contacts, setContacts] = useState(() =>
    collectionState(initial.contacts, initial.truncation.contacts.nextCursor),
  );
  const [opportunities, setOpportunities] = useState(() =>
    collectionState(initial.opportunities, initial.truncation.opportunities.nextCursor),
  );
  const [openTasks, setOpenTasks] = useState(() =>
    collectionState(initial.openTasks, initial.truncation.openTasks.nextCursor),
  );

  const progressingOpportunities = opportunities.items.filter((item) => item.stage in progressingStageRank);
  const primaryOpportunity = customer.primaryOpportunityId
    ? opportunities.items.find((item) => item.id === customer.primaryOpportunityId) ?? { id: customer.primaryOpportunityId }
    : progressingOpportunities.reduce<typeof progressingOpportunities[number] | null>((current, item) => {
        if (!current || progressingStageRank[item.stage] > progressingStageRank[current.stage]) return item;
        return current;
      }, null);

  function openPanelFromMenu(event: MouseEvent<HTMLButtonElement>, nextPanel: string) {
    event.currentTarget.closest("details")?.removeAttribute("open");
    setPanel(panel === nextPanel ? null : nextPanel);
  }

  async function refresh() {
    setPanel(null);
    router.refresh();
  }

  async function run(action: Promise<ActionResult>) {
    setMessage(null);
    const result = await action;
    if (!result.ok) {
      setMessage(result.message ?? "操作失败，请重试");
      return false;
    }
    await refresh();
    return true;
  }

  async function loadSourceLeadNames() {
    if (!sourceLeadNames.nextCursor || sourceLeadNames.loading) return;
    setSourceLeadNames((current) => ({ ...current, loading: true, error: null }));
    const result = await getCustomerDetailCollection({ customerId: customer.id, collection: "sourceLeadNames", cursor: sourceLeadNames.nextCursor });
    if (!result.ok) {
      setSourceLeadNames((current) => ({ ...current, loading: false, error: result.message }));
      return;
    }
    const page = result.data as CustomerDetailCollectionPage<"sourceLeadNames">;
    setSourceLeadNames((current) => ({ ...current, items: appendUnique(current.items, page.items as CustomerDetailSourceLead[], (item) => item.id), nextCursor: page.nextCursor, loading: false, error: null }));
  }

  async function loadContacts() {
    if (!contacts.nextCursor || contacts.loading) return;
    setContacts((current) => ({ ...current, loading: true, error: null }));
    const result = await getCustomerDetailCollection({ customerId: customer.id, collection: "contacts", cursor: contacts.nextCursor });
    if (!result.ok) {
      setContacts((current) => ({ ...current, loading: false, error: result.message }));
      return;
    }
    const page = result.data as CustomerDetailCollectionPage<"contacts">;
    setContacts((current) => ({ ...current, items: appendUnique(current.items, page.items as CustomerDetailContact[], (item) => item.id), nextCursor: page.nextCursor, loading: false, error: null }));
  }

  async function loadOpportunities() {
    if (!opportunities.nextCursor || opportunities.loading) return;
    setOpportunities((current) => ({ ...current, loading: true, error: null }));
    const result = await getCustomerDetailCollection({ customerId: customer.id, collection: "opportunities", cursor: opportunities.nextCursor });
    if (!result.ok) {
      setOpportunities((current) => ({ ...current, loading: false, error: result.message }));
      return;
    }
    const page = result.data as CustomerDetailCollectionPage<"opportunities">;
    setOpportunities((current) => ({ ...current, items: appendUnique(current.items, page.items as CustomerDetailOpportunity[], (item) => item.id), nextCursor: page.nextCursor, loading: false, error: null }));
  }

  async function loadOpenTasks() {
    if (!openTasks.nextCursor || openTasks.loading) return;
    setOpenTasks((current) => ({ ...current, loading: true, error: null }));
    const result = await getCustomerDetailCollection({ customerId: customer.id, collection: "openTasks", cursor: openTasks.nextCursor });
    if (!result.ok) {
      setOpenTasks((current) => ({ ...current, loading: false, error: result.message }));
      return;
    }
    const page = result.data as CustomerDetailCollectionPage<"openTasks">;
    setOpenTasks((current) => ({ ...current, items: appendUnique(current.items, page.items as CustomerDetailOpenTask[], (item) => item.id), nextCursor: page.nextCursor, loading: false, error: null }));
  }

  return (
    <div className="space-y-6">
      {/* 1. 面包屑与导航 */}
      <div className="flex items-center justify-between">
        <Link
          href="/customers"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回客户管理
        </Link>
        <span className="text-xs text-slate-400 font-mono">客户 ID: {customer.id.slice(0, 8)}...</span>
      </div>

      {/* 2. 页面主头部与操作栏 */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {customer.customerType === "INDIVIDUAL" ? (
                <span className="rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
                  个人客户
                </span>
              ) : (
                <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-700 border border-teal-200">
                  单位客户
                </span>
              )}
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
                {customer.operatingStatus || "正常在服"}
              </span>
              {customer.progressingStage && (
                <span className="text-xs text-blue-600 font-semibold">
                  主推进阶段：{stageLabel(customer.progressingStage)}
                </span>
              )}
            </div>

            <h1 className="text-xl font-bold text-slate-950 mt-2">
              {customer.name}
            </h1>

            <p className="text-xs text-slate-500 mt-1">
              负责人: <strong className="text-slate-800">{customer.ownerName}</strong>
              {customer.industry ? ` · 行业: ${customer.industry}` : ""}
              {customer.region ? ` · 地区: ${customer.region}` : ""}
              {customer.size ? ` · 规模: ${customer.size}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {primaryOpportunity ? (
              <Link
                href={`/opportunities/${primaryOpportunity.id}`}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                推进当前主商机 →
              </Link>
            ) : (
              <button
                onClick={() => setPanel(panel === "opportunity" ? null : "opportunity")}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                + 立项新商机
              </button>
            )}

            <button
              onClick={() => setPanel(panel === "activity" ? null : "activity")}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
            >
              记录跟进纪要
            </button>
            <button
              onClick={() => setPanel(panel === "edit" ? null : "edit")}
              className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs"
            >
              编辑客户档案
            </button>

            <details className="relative">
              <summary className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs cursor-pointer list-none">
                更多 ▾
              </summary>
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg text-xs space-y-1">
                {primaryOpportunity && (
                  <button
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                    onClick={(e) => openPanelFromMenu(e, "opportunity")}
                  >
                    + 立项二期/新商机
                  </button>
                )}
                <button
                  className="w-full rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-100 font-medium"
                  onClick={(e) => openPanelFromMenu(e, "contact")}
                >
                  + 添加决策链联系人
                </button>
                {role !== "SALES" && (
                  <button
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 font-medium"
                    onClick={(e) => openPanelFromMenu(e, "delete")}
                  >
                    删除客户主体
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {message}
          </div>
        )}
      </div>

      {/* 弹窗动作区域 */}
      {panel === "edit" && <CustomerEdit customer={customer} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "opportunity" && (
        <OpportunityForm
          customerId={customer.id}
          primaryContactId={contacts.items.find((c) => c.isPrimary)?.id ?? contacts.items[0]?.id ?? ""}
          onCancel={() => setPanel(null)}
          onDone={(id) => router.push(`/opportunities/${id}`)}
        />
      )}
      {panel === "activity" && <ActivityForm customerId={customer.id} onCancel={() => setPanel(null)} onDone={refresh} />}
      {panel === "delete" && <DeleteCustomerForm customerId={customer.id} onCancel={() => setPanel(null)} onDone={() => router.push("/customers")} />}
      {panel === "contact" && <ContactForm customerId={customer.id} onCancel={() => setPanel(null)} onDone={refresh} />}

      {/* 3. 两栏核心主体 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* 卡片 1：决策链联系人 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">决策链与关键联系人</h2>
                <p className="text-xs text-slate-400">沉淀单位组织架构、决策角色标签与联系信息</p>
              </div>
              <button
                onClick={() => setPanel("contact")}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                + 新增联系人
              </button>
            </div>

            {contacts.items.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">还没有联系人，点击右上角添加</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {contacts.items.map((contact) => (
                  <div
                    key={contact.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900 text-sm">{contact.name}</span>
                        {contact.isPrimary && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                            主联系人
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                        {contactRoleLabel(contact.roleTag)}
                      </span>
                    </div>

                    <div className="text-slate-600 space-y-1">
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="text-slate-400 text-[11px]">电话:</span>
                        <MaskedPhone
                          phone={contact.phone}
                          entityType="CONTACT"
                      reason="客户详情页跟进前核对联系方式"
                          entityId={contact.id}
                          showCopy={true}
                        />
                        {contact.title && <span className="text-slate-400">({contact.title})</span>}
                      </div>
                      {contact.email && <div className="text-slate-400 font-mono text-[11px]">邮箱: {contact.email}</div>}
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                      {!contact.isPrimary && (
                        <button
                          onClick={() => run(setPrimaryContact({ customerId: customer.id, contactId: contact.id }))}
                          className="text-[11px] text-blue-600 hover:underline"
                        >
                          设为主联系人
                        </button>
                      )}
                      <button
                        onClick={() => setPanel(`contact-${contact.id}`)}
                        className="text-[11px] text-slate-600 hover:underline"
                      >
                        编辑
                      </button>
                      {!contact.isPrimary && (
                        <button
                          onClick={() => {
                            if (window.confirm("确认删除这个联系人？")) {
                              void run(deleteContact({ contactId: contact.id }));
                            }
                          }}
                          className="text-[11px] text-red-600 hover:underline"
                        >
                          删除
                        </button>
                      )}
                    </div>

                    {panel === `contact-${contact.id}` && (
                      <ContactForm
                        customerId={customer.id}
                        contact={contact}
                        onCancel={() => setPanel(null)}
                        onDone={refresh}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            <LoadMore loading={contacts.loading} error={contacts.error} hasMore={Boolean(contacts.nextCursor)} onClick={loadContacts} />
          </section>

          {/* 卡片 2：商机项目管线 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">商机项目管线</h2>
                <p className="text-xs text-slate-400">推进中与已结案的采购项目全景</p>
              </div>
              <button
                onClick={() => setPanel("opportunity")}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                + 立项新商机
              </button>
            </div>

            {opportunities.items.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">暂无关联商机，点击右上角立项</div>
            ) : (
              <div className="space-y-3">
                {opportunities.items.map((opp) => (
                  <div
                    key={opp.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{opp.name}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                          {stageLabel(opp.stage)}
                        </span>
                        {opp.intendedProduct && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                            产品: {opp.intendedProduct}
                          </span>
                        )}
                        {opp.ownerName && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200/70 text-slate-700">
                            跟进人: {opp.ownerName}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 mt-1">
                        预计金额: <strong className="font-mono text-blue-600">{formatAmount(opp.expectedAmount)}</strong> · 预计结单: {opp.expectedCloseAt ? opp.expectedCloseAt.slice(0, 10) : "未指定"}
                      </div>
                    </div>
                    <Link
                      href={`/opportunities/${opp.id}`}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg font-semibold text-slate-800 self-start sm:self-auto shadow-2xs"
                    >
                      进入商机详情 →
                    </Link>
                  </div>
                ))}
              </div>
            )}
            <LoadMore loading={opportunities.loading} error={opportunities.error} hasMore={Boolean(opportunities.nextCursor)} onClick={loadOpportunities} />
          </section>

          {/* 卡片 3：来源线索 */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>来源线索</span>
                  <span className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px] font-mono font-semibold">
                    {sourceLeadNames.items.length} 条
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">客户转化前原始进线需求与历史记录</p>
              </div>
            </div>

            {sourceLeadNames.items.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">暂无关联线索（直接新建客户）</div>
            ) : (
              <div className="space-y-3">
                {sourceLeadNames.items.map((lead) => (
                  <div key={lead.id} className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 text-xs space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm">{lead.name || "线索联系人"}</span>
                        {lead.title && <span className="text-slate-500 text-xs">({lead.title})</span>}
                        {lead.phone && <MaskedPhone phone={lead.phone} className="font-mono text-slate-500 text-xs" />}
                        {lead.source && (
                          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10.5px] text-slate-700">
                            来源: {lead.source}
                          </span>
                        )}
                        <span className="rounded bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.2 text-[10px] font-semibold">
                          已转客户
                        </span>
                      </div>
                      <Link
                        href={`/leads/${lead.id}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold text-xs"
                      >
                        <span>查看线索</span>
                        <span>→</span>
                      </Link>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                      <div>
                        <span className="text-slate-400 block text-[11px]">意向产品:</span>
                        {lead.intendedProduct ? (
                          <span className="font-medium text-slate-900 inline-flex items-center gap-1 mt-0.5">
                            {lead.intendedProductCategory && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-100/70 text-blue-800 font-semibold">
                                {lead.intendedProductCategory}
                              </span>
                            )}
                            <span className="font-bold text-blue-950">{lead.intendedProduct}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">未明确</span>
                        )}
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">预估预算:</span>
                        <span className="font-mono font-semibold text-slate-800">
                          {lead.budget || "未填写"}
                        </span>
                      </div>
                    </div>

                    {lead.note && (
                      <div className="bg-white p-2.5 rounded-lg border border-slate-200/80 text-[11.5px] text-slate-700 leading-relaxed">
                        <span className="text-slate-400 block text-[10.5px] mb-0.5 font-medium">需求说明:</span>
                        <p className="whitespace-pre-wrap">{lead.note}</p>
                      </div>
                    )}

                    {lead.opportunityName && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/60">
                        <span>
                          关联商机：
                          {lead.opportunityId ? (
                            <Link href={`/opportunities/${lead.opportunityId}`} className="text-blue-600 hover:underline font-semibold ml-1">
                              {lead.opportunityName}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-700 ml-1">{lead.opportunityName}</span>
                          )}
                        </span>
                        {lead.convertedAt && (
                          <span className="font-mono text-slate-400">{new Date(lead.convertedAt).toLocaleDateString("zh-CN")} 转化</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <LoadMore loading={sourceLeadNames.loading} error={sourceLeadNames.error} hasMore={Boolean(sourceLeadNames.nextCursor)} onClick={loadSourceLeadNames} />
          </section>
        </div>

        {/* 右侧边栏：画像与待办 */}
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold text-slate-900">客户主体档案画像</h3>
            <div className="space-y-2.5 border-t border-slate-100 pt-3">
              <div className="flex justify-between">
                <span className="text-slate-400">客户类型</span>
                <span className="font-semibold">{customer.customerType === "INDIVIDUAL" ? "个人客户" : "单位客户"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">所属行业</span>
                <span>{customer.industry || "未填写"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">所属地区</span>
                <span>{customer.region || "未填写"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">人员规模</span>
                <span>{customer.size || "未填写"}</span>
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 text-xs">
            <h3 className="font-bold text-slate-900 flex items-center justify-between">
              <span>待办任务</span>
              <span className="text-slate-400 font-normal">{openTasks.items.length} 项</span>
            </h3>
            <div className="space-y-2 border-t border-slate-100 pt-3">
              {openTasks.items.length === 0 ? (
                <div className="text-slate-400 py-2 text-center">暂无待办任务</div>
              ) : (
                openTasks.items.map((task) => (
                  <div key={task.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>{taskLabel(task.type)}</span>
                      <span className="text-slate-400 font-mono text-[10px]">{task.dueAt ? task.dueAt.slice(5, 16) : ""}</span>
                    </div>
                    {panel === `task-${task.id}` && (
                      <RescheduleTask taskId={task.id} dueAt={task.dueAt!} onDone={refresh} />
                    )}
                  </div>
                ))
              )}
            </div>
            <LoadMore loading={openTasks.loading} error={openTasks.error} hasMore={Boolean(openTasks.nextCursor)} onClick={loadOpenTasks} />
          </section>
        </div>
      </div>
    </div>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function contactRoleLabel(roleTag?: string | null) {
  switch (roleTag) {
    case "DECISION_MAKER": return "最终决策人";
    case "TECH_EVALUATOR": return "技术评估";
    case "PROCUREMENT": return "商务采购";
    case "USER": return "实际使用人";
    case "FINANCE": return "财务对接";
    default: return "关键联系人";
  }
}

function formatAmount(value: string | number | null) {
  return formatAmountInCents(value ? String(value) : null, "未填写");
}

function CustomerEdit({ customer, onCancel, onDone }: { customer: CustomerDetail["customer"]; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(customer.name);
  const [customerType, setCustomerType] = useState(customer.customerType || "ENTERPRISE");
  const [industry, setIndustry] = useState(customer.industry || "");
  const [region, setRegion] = useState(customer.region || "");
  const [size, setSize] = useState<string>(customer.size || "");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await updateCustomer({
      customerId: customer.id,
      name,
      customerType: customerType as "ENTERPRISE" | "INDIVIDUAL",
      industry: industry || undefined,
      region: region || undefined,
      size: size || undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="编辑客户档案" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">客户名称 *</label>
          <input required className="w-full border rounded-lg p-2 bg-slate-50" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block font-semibold mb-1">客户类型</label>
          <select value={customerType} onChange={(e) => setCustomerType(e.target.value as "ENTERPRISE" | "INDIVIDUAL")} className="w-full border rounded-lg p-2 bg-slate-50">
            <option value="ENTERPRISE">单位客户</option>
            <option value="INDIVIDUAL">个人客户</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">所属行业</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50" value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">所在地区</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50" value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block font-semibold mb-1">人员规模</label>
          <select value={size} onChange={(e) => setSize(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
            <option value="">未选择</option>
            <option value="1-20">1-20 人</option>
            <option value="21-100">21-100 人</option>
            <option value="101-500">101-500 人</option>
            <option value="501-1000">501-1000 人</option>
            <option value="1000+">1000+ 人</option>
          </select>
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存档案</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ContactForm({ customerId, contact, onCancel, onDone }: { customerId: string; contact?: CustomerDetailContact; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState(contact?.name || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [title, setTitle] = useState(contact?.title || "");
  const [roleTag, setRoleTag] = useState(contact?.roleTag || "DECISION_MAKER");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = contact
      ? await updateContact({ contactId: contact.id, name, phone, email: email || undefined, title: title || undefined, roleTag: roleTag as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER" })
      : await addContact({ customerId, name, phone, email: email || undefined, title: title || undefined, roleTag: roleTag as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER" });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title={contact ? "编辑联系人" : "新增决策链联系人"} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div>
          <label className="block font-semibold mb-1">姓名 *</label>
          <input required className="w-full border rounded-lg p-2 bg-slate-50" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">手机号 *</label>
            <input required className="w-full border rounded-lg p-2 font-mono bg-slate-50" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">决策角色标签</label>
            <select value={roleTag} onChange={(e) => setRoleTag(e.target.value as "DECISION_MAKER" | "TECH_EVALUATOR" | "PROCUREMENT" | "USER" | "FINANCE" | "OTHER")} className="w-full border rounded-lg p-2 bg-slate-50">
              <option value="DECISION_MAKER">最终决策人</option>
              <option value="TECH_EVALUATOR">技术评估人</option>
              <option value="PROCUREMENT">商务采购</option>
              <option value="USER">实际使用人</option>
              <option value="FINANCE">财务对接</option>
              <option value="OTHER">其他协作人</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">职务/头衔</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block font-semibold mb-1">邮箱</label>
            <input className="w-full border rounded-lg p-2 bg-slate-50" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存联系人</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function OpportunityForm({ customerId, primaryContactId, onCancel, onDone }: { customerId: string; primaryContactId: string; onCancel: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [demand, setDemand] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Array<{
    productId: string;
    productName: string;
    unitPrice: number;
    pricingModel: string;
    quantity: number;
    discountRate: number;
  }>>([]);

  useEffect(() => {
    listProductsAction({ status: "ACTIVE" }).then((res) => {
      if (res.ok && res.data) {
        setAvailableProducts(res.data);
      }
    });
  }, []);

  const handleAddProduct = (prodId: string) => {
    const prod = availableProducts.find((p) => p.id === prodId);
    if (!prod) return;
    setSelectedProducts((prev) => {
      const existing = prev.find((p) => p.productId === prodId);
      if (existing) {
        return prev.map((p) => (p.productId === prodId ? { ...p, quantity: p.quantity + 1 } : p));
      }
      return [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          unitPrice: prod.unitPrice,
          pricingModel: prod.pricingModel,
          quantity: 1,
          discountRate: 100,
        },
      ];
    });
  };

  const handleRemoveProduct = (prodId: string) => {
    setSelectedProducts((prev) => prev.filter((p) => p.productId !== prodId));
  };

  const handleUpdateProduct = (prodId: string, quantity: number, discountRate: number) => {
    setSelectedProducts((prev) =>
      prev.map((p) =>
        p.productId === prodId
          ? { ...p, quantity: Math.max(1, quantity), discountRate: Math.min(100, Math.max(1, discountRate)) }
          : p,
      ),
    );
  };

  const computedProductsTotal = selectedProducts.reduce(
    (sum, p) => sum + Math.round((p.unitPrice * p.quantity * p.discountRate) / 100),
    0,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const totalAmountInCents =
      computedProductsTotal > 0
        ? computedProductsTotal
        : amount
        ? Math.round(Number(amount) * 100)
        : undefined;

    const lineItems = selectedProducts.map((p) => ({
      productId: p.productId,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
      discountRate: p.discountRate,
    }));

    const result = await createOpportunity({
      customerId,
      name: name.trim(),
      primaryContactId: primaryContactId || undefined,
      expectedAmount: totalAmountInCents,
      expectedCloseAt: date ? parseLocalDate(date) : undefined,
      demandNote: demand.trim() || undefined,
      lineItems: lineItems.length > 0 ? lineItems : undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone((result.data as { opportunityId: string }).opportunityId);
  }

  return (
    <ModalWrapper title="立项新商机" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3.5 text-xs max-w-xl">
        <div>
          <label className="block font-semibold mb-1 text-slate-800">商机项目名称 *</label>
          <input
            required
            placeholder="如: 智能制造二期数智平台采购"
            className="w-full border border-slate-200 rounded-lg p-2.5 bg-white text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1 text-slate-800">
              预估总金额 (元) {computedProductsTotal > 0 && <span className="text-indigo-600 font-normal">· 已按选配产品自动核算</span>}
            </label>
            <input
              type="number"
              min="0"
              placeholder={computedProductsTotal > 0 ? "" : "例如：50000"}
              disabled={computedProductsTotal > 0}
              className={`w-full border border-slate-200 rounded-lg p-2.5 ${computedProductsTotal > 0 ? "bg-indigo-50/50 font-bold text-indigo-900 font-mono" : "bg-white text-slate-900"} focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs`}
              value={computedProductsTotal > 0 ? (computedProductsTotal / 100).toString() : amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-semibold mb-1 text-slate-800">预计结单日期</label>
            <input
              type="date"
              className="w-full border border-slate-200 rounded-lg p-2.5 bg-white text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        {/* 选配产品清单与智能核算模块 */}
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3.5 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                <span>选配标准产品 SKU 与报价联动核算</span>
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                选配产品后系统将自动测算预估金额，并自动通过 AI 质检“产品明细”项
              </p>
            </div>
            {availableProducts.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddProduct(e.target.value);
                    e.target.value = "";
                  }
                }}
                defaultValue=""
                className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1 text-xs text-indigo-900 font-semibold shadow-2xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="" disabled>+ 添加选配产品 SKU...</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · ￥{(p.unitPrice / 100).toLocaleString()}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedProducts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-indigo-200 bg-white/60 p-3 text-center text-xs text-slate-400">
              尚未挑选产品 SKU，可点击右上角添加，或直接在上方手动录入预估金额。
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {selectedProducts.map((sp) => {
                  const lineSubtotal = Math.round((sp.unitPrice * sp.quantity * sp.discountRate) / 100);
                  return (
                    <div key={sp.productId} className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 truncate">{sp.productName}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          基准单价: ￥{(sp.unitPrice / 100).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500 text-[11px]">数量:</span>
                          <input
                            type="number"
                            min="1"
                            value={sp.quantity}
                            onChange={(e) => handleUpdateProduct(sp.productId, Number(e.target.value), sp.discountRate)}
                            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-center font-mono text-xs"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-500 text-[11px]">折扣%:</span>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={sp.discountRate}
                            onChange={(e) => handleUpdateProduct(sp.productId, sp.quantity, Number(e.target.value))}
                            className="w-14 rounded border border-slate-200 px-1.5 py-0.5 text-center font-mono text-xs"
                          />
                        </div>
                        <div className="text-right min-w-[70px]">
                          <span className="font-mono font-bold text-slate-950">
                            ￥{(lineSubtotal / 100).toLocaleString()}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(sp.productId)}
                          className="text-rose-500 hover:text-rose-700 p-1 font-bold text-xs"
                          title="移除此产品"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1 px-1 text-xs">
                <span className="text-slate-500">
                  已选 <span className="font-bold text-slate-800">{selectedProducts.length}</span> 款产品
                </span>
                <div className="text-right">
                  <span className="text-slate-500 mr-2">产品核算总价:</span>
                  <span className="font-mono font-bold text-indigo-700 text-sm">
                    ￥{(computedProductsTotal / 100).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block font-semibold text-slate-800">需求与合作背景</label>
            <span className="text-[10px] text-slate-400 font-mono">
              {demand.length}/500 字
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={500}
            placeholder="明确客户痛点、预期上线时间、预算范围与核心考核指标..."
            className="w-full border border-slate-200 rounded-xl p-3 bg-white text-slate-900 leading-relaxed focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 shadow-2xs resize-y min-h-[90px]"
            value={demand}
            onChange={(e) => setDemand(e.target.value)}
          />
        </div>

        {error && (
          <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3.5 py-1.5 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-medium">
            取消
          </button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-xs transition">
            {pending ? "立项中..." : "确认立项"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function ActivityForm({ customerId, onCancel, onDone }: { customerId: string; onCancel: () => void; onDone: () => void }) {
  const [type, setType] = useState("CALL");
  const [outcome, setOutcome] = useState("CONNECTED");
  const [summary, setSummary] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await logActivity({
      customerId,
      type: type as "CALL" | "MEETING" | "VISIT" | "MESSAGE" | "NOTE",
      outcome: type === "NOTE" ? undefined : (outcome as "CONNECTED" | "NO_ANSWER" | "REFUSED" | "INTERESTED"),
      summary,
      nextFollowUpAt: next ? new Date(next) : undefined,
    });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="记录跟进纪要" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">跟进方式</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
              <option value="CALL">电话沟通</option>
              <option value="MEETING">会议汇报</option>
              <option value="VISIT">上门拜访</option>
              <option value="MESSAGE">微信/短信</option>
              <option value="NOTE">内部备忘</option>
            </select>
          </div>
          {type !== "NOTE" && (
            <div>
              <label className="block font-semibold mb-1">沟通结果</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">
                <option value="CONNECTED">已接通</option>
                <option value="INTERESTED">极有意向</option>
                <option value="NO_ANSWER">未接通</option>
                <option value="REFUSED">明确拒绝</option>
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="block font-semibold mb-1">跟进纪要 *</label>
          <input required maxLength={200} placeholder="填写核心沟通事实与结论..." value={summary} onChange={(e) => setSummary(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        <div>
          <label className="block font-semibold mb-1">预约下次跟进时间</label>
          <input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" />
        </div>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-semibold">保存跟进</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function DeleteCustomerForm({ customerId, onCancel, onDone }: { customerId: string; onCancel: () => void; onDone: () => void }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await deleteCustomer({ customerId });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <ModalWrapper title="删除客户主体档案" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3 text-xs">
        <p className="text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
          警告：删除客户档案将同步软删除名下所有联系人与待办任务。已结案的历史商机仍将保留审计记录。
        </p>
        {error && <p className="text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg">取消</button>
          <button type="submit" disabled={pending} className="px-4 py-1.5 bg-red-600 text-white rounded-lg font-semibold">确认删除</button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function RescheduleTask({ taskId, dueAt, onDone }: { taskId: string; dueAt: string; onDone: () => void }) {
  const [value, setValue] = useState(dateInputValue(dueAt));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await rescheduleTask({ taskId, dueAt: new Date(value) });
    setPending(false);
    if (!result.ok) setError(result.message);
    else onDone();
  }

  return (
    <form className="mt-2 space-y-2" onSubmit={submit}>
      <input className="w-full text-xs border rounded p-1.5 bg-slate-50" type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button className="w-full px-3 py-1 bg-slate-900 text-white rounded text-xs font-semibold" disabled={pending}>
        {pending ? "保存中" : "确认改约"}
      </button>
    </form>
  );
}

function LoadMore({ loading, error, hasMore, onClick }: { loading: boolean; error: string | null; hasMore: boolean; onClick: () => void }) {
  if (!hasMore && !error) return null;
  return (
    <div className="pt-2 text-center text-xs">
      {error && <p className="text-red-600 mb-1">{error}</p>}
      {hasMore && (
        <button onClick={onClick} disabled={loading} className="px-3 py-1 text-slate-500 hover:text-slate-900 border rounded">
          {loading ? "加载中..." : "加载更多"}
        </button>
      )}
    </div>
  );
}
