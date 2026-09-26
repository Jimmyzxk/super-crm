import { describe, expect, it, vi } from "vitest";
import { dispatchNotificationWebhook } from "@/core/notification/webhook";

describe("群机器人 Webhook 通知派发器", () => {
  it("对于非法或空 URL 直接返回失败并不发起请求", async () => {
    const result = await dispatchNotificationWebhook("", {
      event: "NOTIFICATION_TRIGGERED",
      tenantId: "11111111-1111-4111-8111-111111111111",
      type: "TASK_OVERDUE",
      title: "任务超时",
      occurredAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid webhook URL");
  });

  it("当 fetch 成功时返回 success: true", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = mockFetch;

    const result = await dispatchNotificationWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/xxx", {
      event: "NOTIFICATION_TRIGGERED",
      tenantId: "11111111-1111-4111-8111-111111111111",
      type: "TASK_OVERDUE",
      title: "李明的首次响应已超时",
      link: "/leads/123",
      occurredAt: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("当 fetch 失败时捕获错误返回 success: false", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
    global.fetch = mockFetch;

    const result = await dispatchNotificationWebhook("https://open.feishu.cn/open-apis/bot/v2/hook/xxx", {
      event: "NOTIFICATION_TRIGGERED",
      tenantId: "11111111-1111-4111-8111-111111111111",
      type: "LEAD_ASSIGNED",
      title: "新线索已分配",
      occurredAt: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Network timeout");
  });
});
