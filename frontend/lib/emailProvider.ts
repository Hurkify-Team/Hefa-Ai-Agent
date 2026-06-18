import { sendNotificationWebhook } from "@/lib/notificationWebhookProvider";

type GmailTransport = {
  sendMail: (options: { from: string; html: string; subject: string; text: string; to: string }) => Promise<{ accepted?: string[]; messageId?: string; rejected?: string[]; response?: string }>;
};

let gmailTransport: GmailTransport | null = null;

export type EmailNotificationInput = {
  facilityName: string;
  html: string;
  notificationType: string;
  subject: string;
  to: string;
};

export type ProviderSendResult = {
  provider: string;
  providerResponse: string;
  status: "pending" | "sent" | "failed" | "skipped";
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textFromHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function htmlFromPlainText(input: EmailNotificationInput) {
  const paragraphs = input.html
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => "<p style=\"margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;\">" + escapeHtml(part).replace(/\n/g, "<br />") + "</p>")
    .join("");

  return "<!doctype html><html><body style=\"margin:0;background:#f4f8ff;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;\">"
    + "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;\">Official HEFAMAA notification for " + escapeHtml(input.facilityName || "your facility") + "</div>"
    + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#f4f8ff;padding:32px 12px;\"><tr><td align=\"center\">"
    + "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"max-width:680px;background:#ffffff;border:1px solid #dbeafe;border-radius:24px;overflow:hidden;box-shadow:0 18px 45px rgba(15,23,42,.08);\">"
    + "<tr><td style=\"background:#0b4aa2;padding:24px 28px;color:#ffffff;\"><div style=\"font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#bfdbfe;\">Health Facility Monitoring and Accreditation Agency</div><h1 style=\"margin:8px 0 0;font-size:24px;line-height:1.25;font-weight:700;\">HEFAMAA Official Notification</h1></td></tr>"
    + "<tr><td style=\"padding:28px;\"><div style=\"margin-bottom:20px;padding:14px 16px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:13px;font-weight:700;\">Facility: " + escapeHtml(input.facilityName || "Facility record") + "</div>"
    + paragraphs
    + "<div style=\"margin-top:22px;padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:1.6;\">This message was issued by HEFAMAA to support timely facility registration, renewal, monitoring, and compliance processing.</div>"
    + "</td></tr><tr><td style=\"padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;line-height:1.5;\">HEFAMAA Smart Registry Agent - Lagos State health facility regulatory communication.</td></tr>"
    + "</table></td></tr></table></body></html>";
}

function normalizedHtml(input: EmailNotificationInput) {
  return /^\s*</.test(input.html) ? input.html : htmlFromPlainText(input);
}

function gmailSmtpConfig() {
  const user = process.env.GMAIL_SMTP_USER?.trim();
  const pass = process.env.GMAIL_SMTP_APP_PASSWORD?.trim();
  const fromName = process.env.GMAIL_SMTP_FROM_NAME?.trim() || "HEFAMAA";
  const from = process.env.GMAIL_SMTP_FROM?.trim() || (user ? fromName + " <" + user + ">" : "");
  return { configured: Boolean(user && pass), from, pass, user };
}

function activeEmailProvider() {
  return process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "auto";
}

function shouldUseGmailOnly() {
  const provider = activeEmailProvider();
  return provider === "gmail" || provider === "gmail-smtp";
}

function shouldTryGmailFirst() {
  const provider = activeEmailProvider();
  if (provider === "gmail" || provider === "gmail-smtp") return true;
  if (process.env.GMAIL_SMTP_ENABLED === "true") return true;
  const from = process.env.NOTIFICATION_FROM_EMAIL?.trim().toLowerCase() || "";
  return from.includes("@gmail.com") && gmailSmtpConfig().configured;
}

async function getGmailTransport(config: ReturnType<typeof gmailSmtpConfig>) {
  if (gmailTransport) return gmailTransport;
  const nodemailer = await import("nodemailer");
  gmailTransport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
  }) as GmailTransport;
  return gmailTransport;
}

async function sendViaGmailSmtp(input: EmailNotificationInput, html: string, plainText: string): Promise<ProviderSendResult> {
  const config = gmailSmtpConfig();
  if (!config.configured) {
    return { provider: "gmail-smtp", providerResponse: "GMAIL_SMTP_USER or GMAIL_SMTP_APP_PASSWORD is not configured.", status: "pending" };
  }

  try {
    const transport = await getGmailTransport(config);
    const result = await transport.sendMail({ from: config.from, html, subject: input.subject, text: plainText, to: input.to });
    return {
      provider: "gmail-smtp",
      providerResponse: JSON.stringify({ accepted: result.accepted ?? [], messageId: result.messageId ?? null, rejected: result.rejected ?? [], response: result.response ?? null }),
      status: "sent",
    };
  } catch (error) {
    return { provider: "gmail-smtp", providerResponse: error instanceof Error ? error.message : "Unknown Gmail SMTP error", status: "failed" };
  }
}

export async function sendEmailNotification(input: EmailNotificationInput): Promise<ProviderSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NOTIFICATION_FROM_EMAIL?.trim();
  const html = normalizedHtml(input);
  const plainText = /^\s*</.test(input.html) ? textFromHtml(input.html) : input.html;

  if (!input.to) {
    return { provider: "email", providerResponse: "No email address was available for this facility.", status: "skipped" };
  }

  const webhookResult = await sendNotificationWebhook({ channel: "email", destination: input.to, facilityName: input.facilityName, html, message: plainText, notificationType: input.notificationType, subject: input.subject });
  if (webhookResult?.status === "sent" || (webhookResult && (!apiKey || !from) && !gmailSmtpConfig().configured)) return webhookResult;

  const gmailFirst = shouldTryGmailFirst();
  let gmailFirstResult: ProviderSendResult | null = null;
  if (gmailFirst) {
    gmailFirstResult = gmailSmtpConfig().configured
      ? await sendViaGmailSmtp(input, html, plainText)
      : { provider: "gmail-smtp", providerResponse: "Gmail SMTP is the active provider, but GMAIL_SMTP_USER or GMAIL_SMTP_APP_PASSWORD is not configured.", status: "pending" };
    if (gmailFirstResult.status === "sent" || shouldUseGmailOnly()) return gmailFirstResult;
  }

  if (!apiKey || !from) {
    return gmailFirstResult ?? { provider: "resend", providerResponse: "RESEND_API_KEY or NOTIFICATION_FROM_EMAIL is not configured, so the email is pending.", status: "pending" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, html, subject: input.subject, to: input.to }),
  });

  const text = await response.text();
  const prefix = webhookResult?.status === "failed" ? "Webhook failed (" + webhookResult.providerResponse + "); fallback Resend response: " : "";
  const resendResult: ProviderSendResult = { provider: "resend", providerResponse: prefix + (text || String(response.status)), status: response.ok ? "sent" : "failed" };
  if (resendResult.status === "sent") return resendResult;

  if (!gmailFirst && gmailSmtpConfig().configured) {
    const gmailFallback = await sendViaGmailSmtp(input, html, plainText);
    return {
      ...gmailFallback,
      providerResponse: "Resend failed (" + resendResult.providerResponse + "); Gmail SMTP fallback response: " + gmailFallback.providerResponse,
    };
  }

  return gmailFirstResult
    ? { ...gmailFirstResult, providerResponse: "Gmail SMTP failed (" + gmailFirstResult.providerResponse + "); Resend response: " + resendResult.providerResponse }
    : resendResult;
}
