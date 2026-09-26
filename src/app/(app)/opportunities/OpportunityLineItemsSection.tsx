"use client";

import { useEffect, useState, useTransition } from "react";
import {
  listOpportunityLineItemsAction,
  listProductsAction,
  saveOpportunityLineItemsAction,
} from "@/core/products/actions";
import type {
  OpportunityLineItem,
  ProductItem,
  SaveLineItemInput,
} from "@/core/products/types";

interface OpportunityLineItemsSectionProps {
  opportunityId: string;
  isTerminal: boolean;
  onTotalUpdated?: (newTotal: number) => void;
}

export default function OpportunityLineItemsSection({
  opportunityId,
  isTerminal,
  onTotalUpdated,
}: OpportunityLineItemsSectionProps) {
  const [lineItems, setLineItems] = useState<OpportunityLineItem[]>([]);
  const [availableProducts, setAvailableProducts] = useState<ProductItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 编辑表单草稿
  const [draftItems, setDraftItems] = useState<
    Array<{
      productId: string;
      quantity: number;
      unitPriceYuan: number;
      discountRate: number;
      note: string;
    }>
  >([]);

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setIsLoading(true);
      const [itemsRes, prodsRes] = await Promise.all([
        listOpportunityLineItemsAction(opportunityId),
        listProductsAction({ status: "ACTIVE" }),
      ]);
      if (mounted) {
        if (itemsRes.ok) setLineItems(itemsRes.data);
        if (prodsRes.ok) setAvailableProducts(prodsRes.data);
        setIsLoading(false);
      }
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [opportunityId]);

  const handleOpenEdit = () => {
    if (lineItems.length > 0) {
      setDraftItems(
        lineItems.map((li) => ({
          productId: li.productId,
          quantity: li.quantity,
          unitPriceYuan: li.unitPrice / 100,
          discountRate: li.discountRate,
          note: li.note || "",
        })),
      );
    } else if (availableProducts.length > 0) {
      setDraftItems([
        {
          productId: availableProducts[0].id,
          quantity: 1,
          unitPriceYuan: availableProducts[0].unitPrice / 100,
          discountRate: 100,
          note: "",
        },
      ]);
    } else {
      setDraftItems([]);
    }
    setErrorMessage(null);
    setIsEditing(true);
  };

  const handleAddDraftRow = () => {
    if (availableProducts.length === 0) return;
    setDraftItems([
      ...draftItems,
      {
        productId: availableProducts[0].id,
        quantity: 1,
        unitPriceYuan: availableProducts[0].unitPrice / 100,
        discountRate: 100,
        note: "",
      },
    ]);
  };

  const handleRemoveDraftRow = (index: number) => {
    setDraftItems(draftItems.filter((_, i) => i !== index));
  };

  const handleProductChange = (index: number, productId: string) => {
    const prod = availableProducts.find((p) => p.id === productId);
    const updated = [...draftItems];
    updated[index] = {
      ...updated[index],
      productId,
      unitPriceYuan: prod ? prod.unitPrice / 100 : updated[index].unitPriceYuan,
    };
    setDraftItems(updated);
  };

  const handleSave = () => {
    setErrorMessage(null);
    if (draftItems.length === 0) {
      setErrorMessage("请至少保留一项产品明细，或点击取消");
      return;
    }

    const payload: SaveLineItemInput[] = draftItems.map((d) => ({
      productId: d.productId,
      quantity: Math.max(1, Math.floor(d.quantity)),
      unitPrice: Math.round(Math.max(0, d.unitPriceYuan) * 100),
      discountRate: Math.min(100, Math.max(1, Math.floor(d.discountRate))),
      note: d.note.trim() || null,
    }));

    startTransition(async () => {
      const res = await saveOpportunityLineItemsAction(opportunityId, payload);
      if (res.ok) {
        setLineItems(res.data.lineItems);
        setIsEditing(false);
        if (onTotalUpdated) {
          onTotalUpdated(res.data.totalExpectedAmount);
        }
      } else {
        setErrorMessage(res.message || "保存产品明细失败");
      }
    });
  };

  const totalCents = lineItems.reduce((acc, item) => acc + item.subtotalAmount, 0);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              产品与报价明细
            </h3>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
              {lineItems.length} 款产品
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            核算产品单价、数量与折扣金额
          </p>
        </div>

        {!isTerminal && !isEditing && (
          <button
            type="button"
            onClick={handleOpenEdit}
            className="text-xs font-semibold px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200/60 rounded-lg hover:bg-blue-100 transition-colors"
          >
            {lineItems.length === 0 ? "添加产品" : "编辑明细"}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-xs text-slate-400">加载中...</div>
      ) : isEditing ? (
        <div className="space-y-4">
          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3">
            {draftItems.map((item, idx) => {
              const rowSubtotalYuan = (item.quantity * item.unitPriceYuan * item.discountRate) / 100;
              return (
                <div
                  key={idx}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 sm:grid-cols-12 gap-2 text-xs items-center"
                >
                  <div className="sm:col-span-4">
                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">选择产品 SKU</label>
                    <select
                      value={item.productId}
                      onChange={(e) => handleProductChange(idx, e.target.value)}
                      className="w-full border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                    >
                      {availableProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          [{p.code}] {p.name} ({p.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">数量</label>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => {
                        const updated = [...draftItems];
                        updated[idx].quantity = Number(e.target.value);
                        setDraftItems(updated);
                      }}
                      className="w-full border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">单价 (元)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPriceYuan}
                      onChange={(e) => {
                        const updated = [...draftItems];
                        updated[idx].unitPriceYuan = Number(e.target.value);
                        setDraftItems(updated);
                      }}
                      className="w-full border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[10px] font-medium text-slate-500 mb-0.5">折扣 (%)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={item.discountRate}
                      onChange={(e) => {
                        const updated = [...draftItems];
                        updated[idx].discountRate = Number(e.target.value);
                        setDraftItems(updated);
                      }}
                      className="w-full border border-slate-300 bg-white text-slate-800 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-slate-400">小计</div>
                      <div className="font-mono font-semibold text-slate-900">
                        ¥ {rowSubtotalYuan.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    {draftItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDraftRow(idx)}
                        className="text-red-500 hover:text-red-700 p-1 text-sm"
                        title="删除此行"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleAddDraftRow}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800"
            >
              + 添加产品行
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSave}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50"
              >
                {isPending ? "保存中..." : "保存明细"}
              </button>
            </div>
          </div>
        </div>
      ) : lineItems.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg border border-dashed border-slate-200">
          <div>暂无产品明细</div>
          {!isTerminal && (
            <button
              type="button"
              onClick={handleOpenEdit}
              className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              添加产品
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50/50">
                <th className="py-2.5 px-3">产品编码与名称</th>
                <th className="py-2.5 px-3">业务分类</th>
                <th className="py-2.5 px-3 text-right">单价</th>
                <th className="py-2.5 px-3 text-center">数量</th>
                <th className="py-2.5 px-3 text-center">折扣</th>
                <th className="py-2.5 px-3 text-right">小计金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lineItems.map((li) => (
                <tr key={li.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900">{li.productName}</div>
                    <div className="text-[10px] font-mono text-slate-400">{li.productCode}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                      {li.category}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                    ¥ {(li.unitPrice / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })} / {li.unit}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono font-medium text-slate-900">
                    {li.quantity}
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                    {li.discountRate === 100 ? "无折扣" : `${(li.discountRate / 10).toFixed(1)} 折`}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                    ¥ {(li.subtotalAmount / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={5} className="py-2.5 px-3 text-right text-slate-700">
                  产品总额：
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-blue-600">
                  ¥ {(totalCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
