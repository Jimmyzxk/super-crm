"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/core/auth/types";
import {
  archiveProductAction,
  createProductAction,
  listProductCategoriesAction,
  listProductsAction,
  updateProductAction,
} from "@/core/products/actions";
import type {
  CreateProductInput,
  PricingModel,
  ProductCategorySummary,
  ProductItem,
  ProductStatus,
  UpdateProductInput,
} from "@/core/products/types";
import { Button, Badge, EmptyState } from "@/components/ui";

interface ProductsClientProps {
  initialProducts: ProductItem[];
  initialCategories: ProductCategorySummary[];
  role: Role;
  permissions?: string[];
}

const PRICING_MODEL_MAP: Record<PricingModel, { label: string; badgeVariant: "blue" | "teal" | "emerald" | "amber" | "purple" }> = {
  SUBSCRIPTION_YEARLY: { label: "年费订阅", badgeVariant: "blue" },
  SUBSCRIPTION_MONTHLY: { label: "月费订阅", badgeVariant: "teal" },
  ONE_TIME: { label: "一次性买断", badgeVariant: "emerald" },
  MAN_MONTH: { label: "人月/人天服务", badgeVariant: "amber" },
  USAGE_BASED: { label: "按量/流量计费", badgeVariant: "purple" },
};

export default function ProductsClient({
  initialProducts,
  initialCategories,
  role,
  permissions = [],
}: ProductsClientProps) {
  const [products, setProducts] = useState<ProductItem[]>(initialProducts);
  const [categories, setCategories] = useState<ProductCategorySummary[]>(initialCategories);
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductItem | null>(null);
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    category: string;
    pricingModel: PricingModel;
    unitPriceYuan: number;
    unit: string;
    description: string;
  }>({
    code: "",
    name: "",
    category: "数字化云平台",
    pricingModel: "SUBSCRIPTION_YEARLY",
    unitPriceYuan: 19800,
    unit: "年/席位",
    description: "",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = role === "ADMIN" || permissions.includes("products:manage");

  const refreshList = () => {
    startTransition(async () => {
      const [pRes, cRes] = await Promise.all([
        listProductsAction({
          category: selectedCategory === "ALL" ? undefined : selectedCategory,
          status: selectedStatus === "ALL" ? undefined : (selectedStatus as ProductStatus),
          search: searchQuery.trim() || undefined,
        }),
        listProductCategoriesAction(),
      ]);

      if (pRes.ok) setProducts(pRes.data);
      if (cRes.ok) setCategories(cRes.data);
    });
  };

  const handleOpenCreate = () => {
    setEditingProduct(null);
    setFormData({
      code: `SKU-${Date.now().toString().slice(-4)}`,
      name: "",
      category: categories[0]?.category || "数字化云平台",
      pricingModel: "SUBSCRIPTION_YEARLY",
      unitPriceYuan: 19800,
      unit: "年/席位",
      description: "",
    });
    setErrorMessage(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (p: ProductItem) => {
    setEditingProduct(p);
    setFormData({
      code: p.code,
      name: p.name,
      category: p.category,
      pricingModel: p.pricingModel,
      unitPriceYuan: p.unitPrice / 100,
      unit: p.unit,
      description: p.description || "",
    });
    setErrorMessage(null);
    setModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!formData.name.trim()) {
      setErrorMessage("请填写产品名称");
      return;
    }
    if (!formData.category.trim()) {
      setErrorMessage("请填写业务分类");
      return;
    }
    if (formData.unitPriceYuan < 0) {
      setErrorMessage("单价不能小于 0");
      return;
    }

    startTransition(async () => {
      if (editingProduct) {
        const payload: UpdateProductInput = {
          name: formData.name.trim(),
          category: formData.category.trim(),
          pricingModel: formData.pricingModel,
          unitPrice: Math.round(formData.unitPriceYuan * 100),
          unit: formData.unit.trim(),
          description: formData.description.trim() || null,
        };
        const res = await updateProductAction(editingProduct.id, payload);
        if (res.ok) {
          setModalOpen(false);
          refreshList();
        } else {
          setErrorMessage(res.message || "更新产品失败");
        }
      } else {
        const payload: CreateProductInput = {
          code: formData.code.trim().toUpperCase(),
          name: formData.name.trim(),
          category: formData.category.trim(),
          pricingModel: formData.pricingModel,
          unitPrice: Math.round(formData.unitPriceYuan * 100),
          unit: formData.unit.trim(),
          description: formData.description.trim() || undefined,
        };
        const res = await createProductAction(payload);
        if (res.ok) {
          setModalOpen(false);
          refreshList();
        } else {
          setErrorMessage(res.message || "创建产品失败");
        }
      }
    });
  };

  const handleArchive = async (id: string) => {
    if (!confirm("确定要归档此产品 SKU 吗？已创建的商机不受影响，后续将不能再挑选此款产品。")) {
      return;
    }
    setErrorMessage(null);
    startTransition(async () => {
      const res = await archiveProductAction(id);
      if (res.ok) {
        refreshList();
      } else {
        setErrorMessage(res.message || "归档失败");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  };

  const handleUnarchive = async (p: ProductItem) => {
    setErrorMessage(null);
    startTransition(async () => {
      const res = await updateProductAction(p.id, { status: "ACTIVE" });
      if (res.ok) {
        refreshList();
      } else {
        setErrorMessage(res.message || "恢复启用失败");
        setTimeout(() => setErrorMessage(null), 5000);
      }
    });
  };

  const totalSKUs = products.length;
  const activeSKUs = products.filter((p) => p.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      {/* 顶部标题与操作 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="blue" size="sm">
              销售管线
            </Badge>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight">
              产品配置
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            统一维护企业标准产品 SKU、多样化计费模式与基准定价，支撑商机明细挂载与自动核算
          </p>
        </div>

        {canManage && (
          <Button
            variant="primary"
            size="md"
            onClick={handleOpenCreate}
            leftIcon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            }
          >
            新建产品 SKU
          </Button>
        )}
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-medium shadow-2xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => setErrorMessage(null)} className="text-rose-600 hover:text-rose-800 font-bold">×</button>
        </div>
      )}

      {/* 统计指标卡 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">有效在售 SKU</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{activeSKUs} <span className="text-xs font-normal text-slate-400">/ {totalSKUs} 款</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">产品业务线分类</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">{categories.length} <span className="text-xs font-normal text-slate-400">条主线</span></div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">支持计费模式</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">5 <span className="text-xs font-normal text-slate-400">种 (订阅/买断/人月等)</span></div>
        </div>
      </div>

      {/* 筛选与搜索工具条 */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* 分类过滤 */}
          <button
            onClick={() => {
              setSelectedCategory("ALL");
              refreshList();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedCategory === "ALL"
                ? "bg-slate-900 text-white font-semibold shadow-2xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            全部品类 ({totalSKUs})
          </button>
          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => {
                setSelectedCategory(c.category);
                refreshList();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === c.category
                  ? "bg-slate-900 text-white font-semibold shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {c.category} ({c.productCount})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* 状态筛选 */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              refreshList();
            }}
            className="text-xs border border-slate-200 bg-white text-slate-700 rounded-lg px-2.5 py-1.5 focus:border-slate-900 focus:outline-none shadow-2xs"
          >
            <option value="ALL">全部状态</option>
            <option value="ACTIVE">在售 (Active)</option>
            <option value="ARCHIVED">已归档 (Archived)</option>
          </select>

          {/* 关键字搜索 */}
          <div className="relative flex-1 sm:w-64">
            <input
              type="text"
              placeholder="搜索产品名称 / 编码..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && refreshList()}
              className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 bg-white text-slate-800 rounded-lg focus:border-slate-900 focus:outline-none shadow-2xs"
            />
            <svg
              className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* 产品 SKU 列表表格 */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">产品编码</th>
                <th className="py-3 px-4">产品名称</th>
                <th className="py-3 px-4">业务分类</th>
                <th className="py-3 px-4">计费模式</th>
                <th className="py-3 px-4 text-right">标准指导单价</th>
                <th className="py-3 px-4">计价单位</th>
                <th className="py-3 px-4">状态</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    <EmptyState
                      title="暂无符合条件的产品 SKU"
                      description="可尝试清空筛选条件，或立即录入第一款产品"
                      actionLabel={canManage ? "+ 立即录入第一款产品" : undefined}
                      onAction={canManage ? handleOpenCreate : undefined}
                    />
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const pricing = PRICING_MODEL_MAP[p.pricingModel];
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {p.code}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        {p.description && (
                          <div className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{p.description}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="neutral" size="sm">
                          {p.category}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={pricing?.badgeVariant || "neutral"} size="sm">
                          {pricing?.label || p.pricingModel}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                        ¥ {(p.unitPrice / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {p.unit}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={p.status === "ACTIVE" ? "emerald" : "neutral"}
                          dot
                          size="sm"
                        >
                          {p.status === "ACTIVE" ? "在售" : "已归档"}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5">
                        {canManage && (
                          <>
                            <Button
                              variant="secondary"
                              size="xs"
                              onClick={() => handleOpenEdit(p)}
                            >
                              编辑
                            </Button>
                            {p.status === "ACTIVE" ? (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-amber-700 hover:text-amber-800"
                                onClick={() => handleArchive(p.id)}
                              >
                                归档
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="xs"
                                className="text-emerald-700 hover:text-emerald-800"
                                onClick={() => handleUnarchive(p)}
                              >
                                重新在售
                              </Button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新建/编辑产品弹窗 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? "编辑产品 SKU" : "新建产品 SKU"}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            {errorMessage && (
              <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    产品编码 (Code) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!!editingProduct}
                    placeholder="如: SAAS-ENT"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full border border-slate-300 bg-slate-50 text-slate-900 rounded-lg px-3 py-2 disabled:opacity-60 focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    业务分类 (Category) *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="如: 数字化云平台"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  产品名称 *
                </label>
                <input
                  type="text"
                  required
                  placeholder="如: 智能制造工业大脑标准版"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    计费模式 *
                  </label>
                  <select
                    value={formData.pricingModel}
                    onChange={(e) => setFormData({ ...formData, pricingModel: e.target.value as PricingModel })}
                    className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-2.5 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="SUBSCRIPTION_YEARLY">年费订阅</option>
                    <option value="SUBSCRIPTION_MONTHLY">月费订阅</option>
                    <option value="ONE_TIME">一次性买断</option>
                    <option value="MAN_MONTH">人月/人天服务</option>
                    <option value="USAGE_BASED">按量计费</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    标准指导价 (元) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={formData.unitPriceYuan}
                    onChange={(e) => setFormData({ ...formData, unitPriceYuan: Number(e.target.value) })}
                    className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    计价单位 *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="如: 年/席位, 套"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  产品规格与交付说明
                </label>
                <textarea
                  rows={3}
                  placeholder="填写产品核心功能、交付周期、适用客群等..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-slate-300 bg-white text-slate-900 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 font-medium"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-xs disabled:opacity-50"
                >
                  {isPending ? "保存中..." : "保存产品"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
