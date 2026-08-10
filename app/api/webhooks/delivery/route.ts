import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveries, notifications, orders, webhookEvents } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { runtimeValue } from "../../../../lib/runtime";
import { cleanText } from "../../../../lib/security";
import { verifyHmac, webhookEventKey } from "../../../../lib/webhook";

const allowedStatuses = new Set(["created", "accepted", "in_transit", "ready_for_pickup", "delivered", "cancelled", "lost"]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!await verifyHmac(rawBody, request.headers.get("x-agent-signature"), runtimeValue("DELIVERY_WEBHOOK_SECRET"))) return Response.json({ error: "Некорректная подпись" }, { status: 401 });
  try {
    await ensureMarketplaceSchema();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const externalId = cleanText(body.externalId, 150);
    const status = cleanText(body.status, 30);
    const eta = cleanText(body.eta, 80);
    const trackingUrl = cleanText(body.trackingUrl, 500);
    if (!externalId || !allowedStatuses.has(status)) return Response.json({ error: "Некорректное событие" }, { status: 400 });
    const [delivery] = await getDb().select().from(deliveries).where(eq(deliveries.externalId, externalId)).limit(1);
    if (!delivery) return Response.json({ error: "Отправление не найдено" }, { status: 404 });
    const eventKey = await webhookEventKey(rawBody, body.eventId);
    const [event] = await getDb().insert(webhookEvents).values({ provider: "delivery", eventKey }).onConflictDoNothing().returning({ id: webhookEvents.id });
    if (!event) return Response.json({ ok: true, duplicate: true });
    await getDb().update(deliveries).set({ status, eta: eta || delivery.eta, trackingUrl: trackingUrl || delivery.trackingUrl, updatedAt: new Date().toISOString() }).where(eq(deliveries.id, delivery.id));
    const [order] = await getDb().select().from(orders).where(eq(orders.id, delivery.orderId)).limit(1);
    if (order) {
      await getDb().update(orders).set({ deliveryStatus: status, status: status === "delivered" ? "delivered" : order.status, updatedAt: new Date().toISOString() }).where(eq(orders.id, order.id));
      await getDb().insert(notifications).values({ recipientEmail: order.buyerEmail, template: "delivery_status_changed", payloadJson: JSON.stringify({ orderId: order.publicId, status, eta, trackingUrl }) });
    }
    await writeAudit(request, { actorEmail: "delivery-webhook", action: `delivery.${status}`, entityType: "delivery", entityId: delivery.id, metadata: { orderId: delivery.orderId } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось обработать событие" }, { status: 503 });
  }
}
