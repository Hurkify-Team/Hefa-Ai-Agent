import type { ProviderSendResult } from "@/lib/emailProvider";

export type NotificationWebhookInput = {
  channel: "email" | "sms";
  destination: string;
  facilityName: string;
  html?: string;
  message: string;
  notificationType: string;
  subject?: string;
};

function webhookUrl(channel: "email" | "sms") {
  return channel === "email" ? process.env.EMAIL_NOTIFICATION_WEBHOOK_URL?.trim() : process.env.SMS_NOTIFICATION_WEBHOOK_URL?.trim();
}

function webhookSecret(channel: "email" | "sms") {
  return channel === "email" ? process.env.EMAIL_NOTIFICATION_WEBHOOK_SECRET?.trim() : process.env.SMS_NOTIFICATION_WEBHOOK_SECRET?.trim();
}

export function isNotificationWebhookConfigured(channel: "email" | "sms") {
  return Boolean(webhookUrl(channel));
}

export async function sendNotificationWebhook(input: NotificationWebhookInput): Promise<ProviderSendResult | null> {
  const url = webhookUrl(input.channel);
  if (!url) return null;

  const secret = webhookSecret(input.channel);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-HEFAMAA-Source": "smart-registry-agent",
  };
  if (secret) headers.Authorization = "Bearer " + secret;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        channel: input.channel,
        destination: input.destination,
        facilityName: input.facilityName,
        html: input.html ?? null,
        message: input.message,
        notificationType: input.notificationType,
        source: "HEFAMAA Smart Registry Agent",
        subject: input.subject ?? "",
        timestamp: new Date().toISOString(),
      }),
    });

    const responseText = await response.text();
    return {
      provider: input.channel + "-webhook",
      providerResponse: responseText || String(response.status),
      status: response.ok ? "sent" : "failed",
    };
  } catch (error) {
    return {
      provider: input.channel + "-webhook",
      providerResponse: error instanceof Error ? error.message : "Webhook delivery failed.",
      status: "failed",
    };
  }
}
