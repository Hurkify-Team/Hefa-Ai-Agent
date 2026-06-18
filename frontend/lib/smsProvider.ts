import type { ProviderSendResult } from "@/lib/emailProvider";
import { sendNotificationWebhook } from "@/lib/notificationWebhookProvider";

export type SmsNotificationInput = {
  facilityName: string;
  message: string;
  notificationType: string;
  to: string;
};

export async function sendSmsNotification(input: SmsNotificationInput): Promise<ProviderSendResult> {
  const apiKey = process.env.TERMII_API_KEY?.trim();
  const senderId = process.env.TERMII_SENDER_ID?.trim() || "HEFAMAA";

  if (!input.to) {
    return { provider: "termii", providerResponse: "No phone number was available for this facility.", status: "skipped" };
  }

  const webhookResult = await sendNotificationWebhook({ channel: "sms", destination: input.to, facilityName: input.facilityName, message: input.message, notificationType: input.notificationType });
  if (webhookResult?.status === "sent" || (webhookResult && !apiKey)) return webhookResult;

  if (!apiKey) {
    return { provider: "termii", providerResponse: "TERMII_API_KEY is not configured, so the SMS is pending.", status: "pending" };
  }

  const response = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, channel: "generic", from: senderId, sms: input.message, to: input.to, type: "plain" }),
  });

  const text = await response.text();
  const prefix = webhookResult?.status === "failed" ? "Webhook failed (" + webhookResult.providerResponse + "); fallback Termii response: " : "";
  return { provider: "termii", providerResponse: prefix + (text || String(response.status)), status: response.ok ? "sent" : "failed" };
}
