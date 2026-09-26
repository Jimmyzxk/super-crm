import type {
  PluginFactsProvider,
  ExpiringContractFact,
  OverduePaymentScheduleFact,
  DelayedMilestoneFact,
  CustomerOrderRevenueFact,
  CustomerBoughtProductFact,
  RenewalContractFact,
  OpportunityContractFact,
  CustomerCommerceFacts,
} from "./types";

export * from "./types";

export const defaultPluginFactsProvider: PluginFactsProvider = {
  async getExpiringContracts(): Promise<ExpiringContractFact[]> {
    return [];
  },
  async getOverduePaymentSchedules(): Promise<OverduePaymentScheduleFact[]> {
    return [];
  },
  async getDelayedMilestones(): Promise<DelayedMilestoneFact[]> {
    return [];
  },
  async getCustomerOrderRevenues(): Promise<CustomerOrderRevenueFact[]> {
    return [];
  },
  async getCustomerBoughtProducts(): Promise<CustomerBoughtProductFact[]> {
    return [];
  },
  async getRenewalContracts(): Promise<RenewalContractFact[]> {
    return [];
  },
  async isPluginEnabled(): Promise<boolean> {
    return true;
  },
  async getOpportunityContracts(): Promise<OpportunityContractFact[]> {
    return [];
  },
  async getCustomerCommerceFacts(): Promise<CustomerCommerceFacts> {
    return {
      contracts: [],
      orders: [],
      projects: [],
    };
  },
};

let registeredProvider: PluginFactsProvider | null = null;
let isExplicitlyUnregistered = false;

export function registerPluginFactsProvider(provider: PluginFactsProvider | null): void {
  if (provider === null) {
    isExplicitlyUnregistered = true;
    registeredProvider = null;
  } else {
    isExplicitlyUnregistered = false;
    registeredProvider = provider;
  }
}

export function getPluginFactsProvider(): PluginFactsProvider {
  if (isExplicitlyUnregistered) {
    return defaultPluginFactsProvider;
  }
  if (registeredProvider) {
    return registeredProvider;
  }
  // 惰性加载 plugin-kit 中的真实实现（若在场），保证现有测试集无缝兼容。
  // 开源版（AGPL-3.0）不携带 `src/plugin-kit/facts.ts`（其 SQL 全部指向闭源业务插件表），
  // 因此这里用「运行时拼接的模块说明符」而非字面量：既保留闭源插件包把该文件放回即可
  // 自动生效的扩展点，又不会让打包器在构建期尝试解析一个不存在的模块而产生告警。
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factsMod = require(["@", "plugin-kit", "facts"].join("/")) as { pluginKitFactsProvider?: PluginFactsProvider } | undefined;
    if (factsMod && factsMod.pluginKitFactsProvider) {
      registeredProvider = factsMod.pluginKitFactsProvider;
      return factsMod.pluginKitFactsProvider;
    }
  } catch {
    // 插件不存在或无法加载时安全降级
  }
  return defaultPluginFactsProvider;
}
