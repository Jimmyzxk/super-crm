import PluginMountBoundary from "./PluginMountBoundary";
import {
  listEnabledLeadDetailPanels,
  listEnabledOpportunityDetailTabs,
  listPluginSettingsSections,
} from "./registry";
import type { TenantContext } from "./types";

export function PluginLeadDetailMounts({
  context,
  enabledPluginKeys,
  leadId,
}: {
  context: TenantContext;
  enabledPluginKeys: Iterable<string>;
  leadId: string;
}) {
  return <>
    {listEnabledLeadDetailPanels(enabledPluginKeys).map(({ pluginKey, component: Panel }) => (
      <PluginMountBoundary key={pluginKey} pluginKey={pluginKey} mountPoint="lead.detail.panel">
        <Panel context={context} leadId={leadId} />
      </PluginMountBoundary>
    ))}
  </>;
}

export function PluginOpportunityDetailMounts({
  context,
  enabledPluginKeys,
  opportunityId,
}: {
  context: TenantContext;
  enabledPluginKeys: Iterable<string>;
  opportunityId: string;
}) {
  return <>
    {listEnabledOpportunityDetailTabs(enabledPluginKeys).map(({ pluginKey, component: Panel }) => (
      <PluginMountBoundary key={pluginKey} pluginKey={pluginKey} mountPoint="opportunity.detail.tab">
        <Panel context={context} opportunityId={opportunityId} />
      </PluginMountBoundary>
    ))}
  </>;
}

export function PluginSettingsMounts({ context }: { context: TenantContext }) {
  return <>
    {listPluginSettingsSections().map(({ pluginKey, component: Section }) => (
      <PluginMountBoundary key={pluginKey} pluginKey={pluginKey} mountPoint="settings.section">
        <Section context={context} />
      </PluginMountBoundary>
    ))}
  </>;
}

