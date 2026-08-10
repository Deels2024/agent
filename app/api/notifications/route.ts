import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { notifications } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const items = await getDb().select({ id: notifications.id, channel: notifications.channel, template: notifications.template, payloadJson: notifications.payloadJson, status: notifications.status, sentAt: notifications.sentAt, createdAt: notifications.createdAt }).from(notifications).where(eq(notifications.recipientEmail, identity.email)).orderBy(desc(notifications.createdAt)).limit(100);
    return Response.json({ notifications: items.map((item) => ({ ...item, payload: JSON.parse(item.payloadJson), payloadJson: undefined })) });
  } catch {
    return Response.json({ error: "Уведомления временно недоступны" }, { status: 503 });
  }
}
