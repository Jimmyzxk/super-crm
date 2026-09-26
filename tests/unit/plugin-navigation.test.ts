import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppSidebar from "@/app/(app)/AppSidebar";

describe("plugin navigation mount", () => {
  it("仅在服务端传入启用插件时渲染带标识的导航（框架能力，开源版 registry 为空故默认不渲染）", () => {
    const disabled = renderToStaticMarkup(createElement(AppSidebar, { role: "ADMIN", unreadCount: 0 }));
    expect(disabled).not.toContain("扩展插件");

    const enabled = renderToStaticMarkup(createElement(AppSidebar, {
      role: "ADMIN",
      unreadCount: 0,
      pluginItems: [{ pluginKey: "example-plugin", label: "示例扩展入口", path: "/p/example-plugin" }],
    }));
    expect(enabled).toContain("示例扩展入口");
    expect(enabled).toContain("插件");
    expect(enabled).toContain("/p/example-plugin");
  });
});

