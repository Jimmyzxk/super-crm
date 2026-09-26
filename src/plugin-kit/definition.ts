import type { ReactNode } from "react";
import type { TenantContext } from "./types";

type PluginRole = TenantContext["role"];

export const pluginMountPointValues = [
  "nav.main",
  "lead.detail.panel",
  "customer.detail.tab",
  "opportunity.detail.tab",
  "workbench.widget",
  "settings.section",
  "workplace.sync",
] as const;
export type PluginMountPoint = (typeof pluginMountPointValues)[number];

export type PluginNavigationItem = {
  pluginKey: string;
  label: string;
  path: `/p/${string}`;
};

export type LeadDetailPanelProps = {
  leadId: string;
  context: TenantContext;
};

export type CustomerDetailTabProps = {
  customerId: string;
  context: TenantContext;
};

export type OpportunityDetailTabProps = {
  opportunityId: string;
  context: TenantContext;
};

export type WorkbenchWidgetProps = {
  context: TenantContext;
};

export type SettingsSectionProps = {
  context: TenantContext;
};

export type WorkplaceSyncProps = {
  context: TenantContext;
};

export type PluginComponent<Props> = (props: Props) => ReactNode | Promise<ReactNode>;

export type PluginDefinition = {
  key: string;
  name: string;
  navigation?: Omit<PluginNavigationItem, "pluginKey"> & { roles: readonly PluginRole[] };
  leadDetailPanel?: PluginComponent<LeadDetailPanelProps>;
  customerDetailTab?: PluginComponent<CustomerDetailTabProps>;
  opportunityDetailTab?: PluginComponent<OpportunityDetailTabProps>;
  workbenchWidget?: PluginComponent<WorkbenchWidgetProps>;
  settingsSection?: PluginComponent<SettingsSectionProps>;
  workplaceSync?: PluginComponent<WorkplaceSyncProps>;
};

export function definePlugin<const T extends PluginDefinition>(definition: T): T {
  if (!/^[a-z][a-z0-9-]{2,49}$/.test(definition.key)) {
    throw new Error(`Invalid plugin key: ${definition.key}`);
  }
  if (definition.navigation && !definition.navigation.path.startsWith(`/p/${definition.key}`)) {
    throw new Error(`Plugin route must use /p/${definition.key}`);
  }
  return definition;
}
