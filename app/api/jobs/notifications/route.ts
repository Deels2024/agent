import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { notifications } from "../../../../db/schema";
import { runtimeValue } from "../../../../lib/runtime";

function authorized(request: Request) {
  const expected = runtimeValue("CRON_SECRET");
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected === actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Недостаточно прав" }, { status: 401 });
  const webhookUrl = runtimeValue("NOTIFICATION_WEBHOOK_URL");
  const webhookSecret = runtimeValue("NOTIFICATION_WEBHOOK_SECRET");
  if (!webhookUrl || !webhookSecret) return Response.json({ error: "Шлюз уведомлений не настроен" }, { status: 503 });
  try {
    await ensureMarketplaceSchema();
    const now = new Date().toISOString();
    const queued = await getDb().select().from(notifications).where(and(eq(notifications.status, "queued"), or(isNull(notifications.scheduledAt), lte(notifications.scheduledAt, now)))).orderBy(asc(notifications.createdAt)).limit(20);
    let sent = 0;
    let failed = 0;
    for (const item of queued) {
      const response = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${webhookSecret}` }, body: JSON.stringify({ id: item.id, recipient: item.recipientEmail, channel: item.channel, template: item.template, payload: JSON.parse(item.payloadJson) }) });
      if (response.ok) {
        sent += 1;
        await getDb().update(notifications).set({ status: "sent", sentAt: new Date().toISOString() }).where(eq(notifications.id, item.id));
      } else {
        failed += 1;
        await getDb().update(notifications).set({ status: "failed" }).where(eq(notifications.id, item.id));
      }
    }
    return Response.json({ processed: queued.length, sent, failed });
  } catch {
    return Response.json({ error: "Не удалось обработать очередь" }, { status: 503 });
  }
}
