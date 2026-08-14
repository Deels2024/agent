import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { notifications } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const items = await getDb().select({ id: notifications.id, channel: notifications.channel, template: notifications.template, payloadJson: notifications.payloadJson, status: notifications.status, sentAt: notifications.sentAt, readAt: notifications.readAt, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.recipientEmail, identity.email)).orderBy(desc(notifications.createdAt)).limit(100);
    return Response.json({ notifications: items.map((item) => ({ ...item, payload: ["verify_email", "password_reset"].includes(item.template) ? {} : JSON.parse(item.payloadJson), payloadJson: undefined })) });
  } catch {
    return Response.json({ error: "Уведомления временно недоступны" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const readAt = new Date().toISOString();
    await getDb().update(notifications).set({ readAt }).where(and(eq(notifications.recipientEmail, identity.email), isNull(notifications.readAt)));
    return Response.json({ ok: true, readAt });
  } catch {
    return Response.json({ error: "Не удалось отметить уведомления прочитанными" }, { status: 503 });
  }
}
