import type { TenantTransaction } from "@/core/tenant";

export interface ExpiringContractFact {
  id: string;
  contractNo: string;
  title: string;
  totalAmount: number;
  endDate: string;
  ownerUserId: string;
  [key: string]: unknown;
}

export interface OverduePaymentScheduleFact {
  orderId: string;
  orderNo: string;
  periodIndex: number;
  plannedAmount: number;
  paidAmount: number;
  dueDate: string;
  ownerUserId: string;
  [key: string]: unknown;
}

export interface DelayedMilestoneFact {
  projectId: string;
  projectName: string;
  milestoneTitle: string;
  plannedFinishDate: string;
  [key: string]: unknown;
}

export interface CustomerOrderRevenueFact {
  customerId: string;
  orderRevenue: number;
  [key: string]: unknown;
}

export interface CustomerBoughtProductFact {
  customerId: string;
  customerName: string;
  category: string | null;
  code: string | null;
  [key: string]: unknown;
}

export interface RenewalContractFact {
  id: string;
  contractNo: string;
  title: string;
  endDate: string;
  customerName: string;
  totalAmount: number;
  [key: string]: unknown;
}

export interface OpportunityContractFact {
  contractNo: string;
  title: string;
  totalAmount: number;
  status: string;
  signDate: string | null;
  [key: string]: unknown;
}

export interface CustomerCommerceContractFact {
  id: string;
  contractNo: string;
  title: string;
  totalAmount: number;
  status: string;
  signDate: string | null;
  [key: string]: unknown;
}

export interface CustomerCommerceOrderFact {
  id: string;
  orderNo: string;
  title: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface CustomerCommerceProjectFact {
  id: string;
  projectCode: string;
  name: string;
  healthStatus: string;
  progressPercent: number;
  status: string;
  [key: string]: unknown;
}

export interface CustomerCommerceFacts {
  contracts: CustomerCommerceContractFact[];
  orders: CustomerCommerceOrderFact[];
  projects: CustomerCommerceProjectFact[];
  [key: string]: unknown;
}

export interface PluginFactsProvider {
  getExpiringContracts(
    tx: TenantTransaction,
    tenantId: string,
    d30Str: string,
    limit?: number
  ): Promise<ExpiringContractFact[]>;

  getOverduePaymentSchedules(
    tx: TenantTransaction,
    tenantId: string,
    todayStr: string,
    limit?: number
  ): Promise<OverduePaymentScheduleFact[]>;

  getDelayedMilestones(
    tx: TenantTransaction,
    tenantId: string,
    todayStr: string,
    limit?: number
  ): Promise<DelayedMilestoneFact[]>;

  getCustomerOrderRevenues(
    tx: TenantTransaction,
    tenantId: string
  ): Promise<CustomerOrderRevenueFact[]>;

  getCustomerBoughtProducts(
    tx: TenantTransaction,
    tenantId: string
  ): Promise<CustomerBoughtProductFact[]>;

  getRenewalContracts(
    tx: TenantTransaction,
    tenantId: string,
    days: number,
    limit?: number
  ): Promise<RenewalContractFact[]>;

  isPluginEnabled(
    tx: TenantTransaction,
    tenantId: string,
    pluginKey: string
  ): Promise<boolean>;

  getOpportunityContracts(
    tx: TenantTransaction,
    tenantId: string,
    opportunityId: string
  ): Promise<OpportunityContractFact[]>;

  getCustomerCommerceFacts(
    tx: TenantTransaction,
    tenantId: string,
    customerId: string
  ): Promise<CustomerCommerceFacts>;
}
