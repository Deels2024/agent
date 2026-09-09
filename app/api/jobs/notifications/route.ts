import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { notifications } from "../../../../db/schema";
import { directEmailConfigured, sendTransactionalEmail, webhookNotificationsConfigured } from "../../../../lib/email";
import { runtimeValue } from "../../../../lib/runtime";

function authorized(request: Request) {
  const expected = runtimeValue("CRON_SECRET");
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected === actual);
}

async function sendViaWebhook(item: { id: number; recipientEmail: string; channel: string; template: string; payloadJson: string }) {
  const webhookUrl = runtimeValue("NOTIFICATION_WEBHOOK_URL");
  const webhookSecret = runtimeValue("NOTIFICATION_WEBHOOK_SECRET");
  if (!webhookUrl || !webhookSecret) return { ok: false, retryable: false, status: 503 };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${webhookSecret}` },
    body: JSON.stringify({ id: item.id, recipient: item.recipientEmail, channel: item.channel, template: item.template, payload: JSON.parse(item.payloadJson) }),
  });
  return { ok: response.ok, retryable: response.status === 429 || response.status >= 500, status: response.status };
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Недостаточно прав" }, { status: 401 });
  const emailReady = directEmailConfigured();
  const webhookReady = webhookNotificationsConfigured();
  if (!emailReady && !webhookReady) return Response.json({ error: "Шлюз уведомлений не настроен" }, { status: 503 });

  try {
    await ensureMarketplaceSchema();
    const now = new Date().toISOString();
    const queued = await getDb().select().from(notifications)
      .where(and(eq(notifications.status, "queued"), or(isNull(notifications.scheduledAt), lte(notifications.scheduledAt, now))))
      .orderBy(asc(notifications.createdAt)).limit(20);

    let sent = 0;
    let failed = 0;
    let deferred = 0;
    let skipped = 0;

    for (const item of queued) {
      const payload = JSON.parse(item.payloadJson) as Record<string, unknown>;
      let result: { ok: boolean; retryable: boolean; status: number } | null = null;

      if (item.channel === "email" && emailReady) {
        result = await sendTransactionalEmail({ id: item.id, recipient: item.recipientEmail, template: item.template, payload });
        if (!result.ok && webhookReady) result = await sendViaWebhook(item);
      } else if (webhookReady) {
        result = await sendViaWebhook(item);
      }

      if (!result) {
        skipped += 1;
        continue;
      }

      if (result.ok) {
        sent += 1;
        await getDb().update(notifications).set({ status: "sent", sentAt: new Date().toISOString() }).where(eq(notifications.id, item.id));
      } else if (result.retryable) {
        deferred += 1;
      } else {
        failed += 1;
        await getDb().update(notifications).set({ status: "failed" }).where(eq(notifications.id, item.id));
      }
    }

    return Response.json({ processed: queued.length, sent, failed, deferred, skipped, directEmail: emailReady, webhook: webhookReady });
  } catch {
    return Response.json({ error: "Не удалось обработать очередь" }, { status: 503 });
  }
}
