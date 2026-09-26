import type {
  LeadDetailPanelProps,
  OpportunityDetailTabProps,
  PluginComponent,
  PluginDefinition,
  PluginNavigationItem,
  SettingsSectionProps,
} from "./definition";
import type { TenantContext } from "./types";

/**
 * 插件装配点（Plugin Assembly Point）。
 *
 * 开源版（AGPL-3.0）不包含任何业务插件的具体实现，仅保留本装配点与
 * `PluginDefinition` 契约，方便闭源插件包在二次开发中挂载进来：
 * 把插件的 `index.ts` 在此处 import 后 push 进 `compiledPlugins` 即可，
 * 上游所有调用点（PluginMounts / 侧边栏导航 / 设置页分区）无需改动。
 *
 * 业务插件（bi / contracts / form-capture / knowledge-base / lead-routing /
 * orders / projects）为闭源组件，其数据表也不在本仓库的迁移中。
 * 框架基础设施表 `plugin_registry`（插件启停开关）与 `plugin_rate_limits`
 * （插件 API 限流）由 core 保留，不属于插件实现。
 */
const compiledPlugins: readonly PluginDefinition[] = [];

export function listCompiledPlugins(): readonly PluginDefinition[] {
  return compiledPlugins;
}

export function listEnabledPluginNavigation(enabledPluginKeys: Iterable<string>, role: TenantContext["role"]): PluginNavigationItem[] {
  const enabled = new Set(enabledPluginKeys);
  return listCompiledPlugins().flatMap((plugin) => plugin.navigation && enabled.has(plugin.key) && plugin.navigation.roles.includes(role)
    ? [{ pluginKey: plugin.key, label: plugin.navigation.label, path: plugin.navigation.path }]
    : []);
}

export function listEnabledLeadDetailPanels(enabledPluginKeys: Iterable<string>): Array<{
  pluginKey: string;
  component: PluginComponent<LeadDetailPanelProps>;
}> {
  const enabled = new Set(enabledPluginKeys);
  return listCompiledPlugins().flatMap((plugin) => plugin.leadDetailPanel && enabled.has(plugin.key)
    ? [{ pluginKey: plugin.key, component: plugin.leadDetailPanel }]
    : []);
}

export function listEnabledOpportunityDetailTabs(enabledPluginKeys: Iterable<string>): Array<{
  pluginKey: string;
  component: PluginComponent<OpportunityDetailTabProps>;
}> {
  const enabled = new Set(enabledPluginKeys);
  return listCompiledPlugins().flatMap((plugin) => plugin.opportunityDetailTab && enabled.has(plugin.key)
    ? [{ pluginKey: plugin.key, component: plugin.opportunityDetailTab }]
    : []);
}

/** Settings remains mounted for compiled plugins so an admin can re-enable them. */
export function listPluginSettingsSections(): Array<{
  pluginKey: string;
  component: PluginComponent<SettingsSectionProps>;
}> {
  return listCompiledPlugins().flatMap((plugin) => plugin.settingsSection
    ? [{ pluginKey: plugin.key, component: plugin.settingsSection }]
    : []);
}
