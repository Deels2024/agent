import { runtimeValue } from "./runtime";

type NotificationPayload = Record<string, unknown>;

type SendEmailInput = {
  id: number | string;
  recipient: string;
  template: string;
  payload: NotificationPayload;
};

type SendEmailResult = {
  ok: boolean;
  status: number;
  retryable: boolean;
  provider: "resend";
};

const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";

export function directEmailConfigured() {
  return Boolean(runtimeValue("RESEND_API_KEY") && runtimeValue("EMAIL_FROM"));
}

export function webhookNotificationsConfigured() {
  return Boolean(runtimeValue("NOTIFICATION_WEBHOOK_URL") && runtimeValue("NOTIFICATION_WEBHOOK_SECRET"));
}

export function notificationDeliveryConfigured() {
  return directEmailConfigured() || webhookNotificationsConfigured();
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeLink(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function renderTransactionalEmail(template: string, payload: NotificationPayload) {
  const link = safeLink(payload.link);
  if (template === "password_reset") {
    const expiresMinutes = Number(payload.expiresMinutes) || 60;
    return {
      subject: "Восстановление пароля — Агент покупок",
      text: link
        ? `Вы запросили восстановление пароля. Откройте ссылку в течение ${expiresMinutes} минут: ${link}\n\nЕсли это были не вы, просто проигнорируйте письмо.`
        : "Вы запросили восстановление пароля. Повторите запрос на сайте Агента покупок.",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h2>Восстановление пароля</h2><p>Вы запросили восстановление доступа к <b>Агенту покупок</b>.</p>${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Сменить пароль</a></p><p style="color:#666">Ссылка действует ${expiresMinutes} минут.</p>` : ""}<p style="color:#666">Если это были не вы, ничего делать не нужно.</p></div>`,
    };
  }

  if (template === "verify_email") {
    const expiresHours = Number(payload.expiresHours) || 24;
    return {
      subject: "Подтвердите email — Агент покупок",
      text: link
        ? `Подтвердите email для Агента покупок. Ссылка действует ${expiresHours} ч.: ${link}`
        : "Повторите запрос подтверждения email в Агенте покупок.",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h2>Подтвердите email</h2><p>Подтвердите адрес для аккаунта в <b>Агенте покупок</b>.</p>${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px">Подтвердить email</a></p><p style="color:#666">Ссылка действует ${expiresHours} ч.</p>` : ""}</div>`,
    };
  }

  return {
    subject: "Уведомление — Агент покупок",
    text: "У вас новое уведомление в Агенте покупок.",
    html: "<div style=\"font-family:Arial,sans-serif\"><p>У вас новое уведомление в <b>Агенте покупок</b>.</p></div>",
  };
}

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = runtimeValue("RESEND_API_KEY");
  const from = runtimeValue("EMAIL_FROM");
  if (!apiKey || !from) return { ok: false, status: 503, retryable: false, provider: "resend" };

  const email = renderTransactionalEmail(input.template, input.payload);
  const response = await fetch(runtimeValue("RESEND_API_URL") || DEFAULT_RESEND_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "Idempotency-Key": `agent-${input.template}-${input.id}`.slice(0, 250),
    },
    body: JSON.stringify({
      from,
      to: [input.recipient],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  return {
    ok: response.ok,
    status: response.status,
    retryable: response.status === 429 || response.status >= 500,
    provider: "resend",
  };
}
