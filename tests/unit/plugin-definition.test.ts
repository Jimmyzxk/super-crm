import { describe, expect, it } from "vitest";
import { definePlugin, pluginMountPointValues } from "@/plugin-kit/definition";
import PluginMountBoundary from "@/plugin-kit/PluginMountBoundary";
import {
  listCompiledPlugins,
  listEnabledLeadDetailPanels,
  listEnabledOpportunityDetailTabs,
  listEnabledPluginNavigation,
  listPluginSettingsSections,
} from "@/plugin-kit/registry";

/**
 * 开源版（AGPL-3.0）：本文件验证的是**插件框架契约**本身，
 * 而不是任何具体业务插件（业务插件为闭源组件，不在本仓库）。
 *  · definePlugin 的 key / 路由前缀校验逻辑对二次开发挂载的插件依然生效
 *  · registry 装配点为空框架：所有查询函数返回空数组，上游调用点优雅降级
 */

describe("plugin definition", () => {
  it("暴露标准扩展挂载点枚举", () => {
    expect(pluginMountPointValues).toEqual([
      "nav.main",
      "lead.detail.panel",
      "customer.detail.tab",
      "opportunity.detail.tab",
      "workbench.widget",
      "settings.section",
      "workplace.sync",
    ]);
  });

  it("拒绝非法标识和越过插件前缀的路由", () => {
    expect(() => definePlugin({ key: "Bad Key", name: "非法" })).toThrow("Invalid plugin key");
    expect(() => definePlugin({
      key: "example-plugin",
      name: "示例扩展",
      navigation: { label: "示例入口", path: "/settings" as `/p/${string}`, roles: ["ADMIN"] },
    })).toThrow("Plugin route must use /p/example-plugin");
  });

  it("definePlugin 对合规定义原样返回（框架契约对闭源插件包继续可用）", () => {
    const def = definePlugin({
      key: "example-plugin",
      name: "示例扩展",
      navigation: { label: "示例入口", path: "/p/example-plugin", roles: ["ADMIN", "MANAGER"] },
    });
    expect(def.key).toBe("example-plugin");
    expect(def.navigation?.roles).toEqual(["ADMIN", "MANAGER"]);
  });

  it("开源版 registry 为空框架：所有装配查询返回空数组", () => {
    expect(listCompiledPlugins()).toEqual([]);
    expect(listEnabledPluginNavigation([], "ADMIN")).toEqual([]);
    expect(listEnabledPluginNavigation(["example-plugin"], "ADMIN")).toEqual([]);
    expect(listEnabledPluginNavigation(["form-capture", "orders", "contracts"], "ADMIN")).toEqual([]);
    expect(listEnabledLeadDetailPanels([])).toEqual([]);
    expect(listEnabledLeadDetailPanels(["form-capture", "knowledge-base"])).toEqual([]);
    expect(listEnabledOpportunityDetailTabs(["orders"])).toEqual([]);
    expect(listPluginSettingsSections()).toEqual([]);
  });

  it("单个挂载点出错后降级为空", () => {
    const boundary = new PluginMountBoundary({ children: "content", pluginKey: "example-plugin", mountPoint: "lead.detail.panel" });
    boundary.state = PluginMountBoundary.getDerivedStateFromError();
    expect(boundary.render()).toBeNull();
  });
});
