export interface NotificationWebhookPayload {
  event: "NOTIFICATION_TRIGGERED";
  tenantId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  occurredAt: string;
}

export async function dispatchNotificationWebhook(
  webhookUrl: string,
  payload: NotificationWebhookPayload,
  timeoutMs = 3000,
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl || !webhookUrl.startsWith("http")) {
    return { success: false, error: "Invalid webhook URL" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown fetch error" };
  }
}
