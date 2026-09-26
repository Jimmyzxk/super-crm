import { requireSession } from "@/core/auth/session";
import { getEffectiveUserPermissionsService } from "@/core/auth/permissions";
import { listProductsService, listProductCategoriesService } from "@/core/products/service";
import ProductsClient from "./ProductsClient";

export const metadata = {
  title: "产品目录与价目表 - 商脉AI CRM",
  description: "企业多产品线与 SKU 目录配置中心，支持多样化计费模式与商机明细挂载核算",
};

export default async function ProductsPage() {
  const session = await requireSession();

  const [products, categories, permissions] = await Promise.all([
    listProductsService(session),
    listProductCategoriesService(session),
    getEffectiveUserPermissionsService(session),
  ]);

  return (
    <ProductsClient
      initialProducts={products}
      initialCategories={categories}
      role={session.role}
      permissions={permissions}
    />
  );
}
