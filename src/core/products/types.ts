export type PricingModel =
  | "SUBSCRIPTION_YEARLY"
  | "SUBSCRIPTION_MONTHLY"
  | "ONE_TIME"
  | "USAGE_BASED"
  | "MAN_MONTH";

export function formatPricingModel(model?: string | null): string {
  switch (model) {
    case "SUBSCRIPTION_YEARLY": return "按年订阅";
    case "SUBSCRIPTION_MONTHLY": return "按月订阅";
    case "ONE_TIME": return "一次性买断";
    case "USAGE_BASED": return "按量计费";
    case "MAN_MONTH": return "人月结算";
    default: return "";
  }
}

export type ProductStatus = "ACTIVE" | "ARCHIVED";

export interface ProductItem {
  id: string;
  code: string;
  name: string;
  category: string;
  pricingModel: PricingModel;
  unitPrice: number; // 分
  unit: string;
  description: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductInput {
  code: string;
  name: string;
  category: string;
  pricingModel: PricingModel;
  unitPrice: number; // 分
  unit: string;
  description?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  category?: string;
  pricingModel?: PricingModel;
  unitPrice?: number;
  unit?: string;
  description?: string | null;
  status?: ProductStatus;
}

export interface OpportunityLineItem {
  id: string;
  opportunityId: string;
  productId: string;
  productName: string;
  productCode: string;
  category: string;
  pricingModel: PricingModel;
  unit: string;
  quantity: number;
  unitPrice: number; // 分
  discountRate: number; // 1-100
  subtotalAmount: number; // 分
  note: string | null;
  createdAt: string;
}

export interface SaveLineItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  note?: string | null;
}

export interface ProductCategorySummary {
  category: string;
  productCount: number;
  activeCount: number;
}
