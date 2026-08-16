import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveries, deliveryAddresses, deliveryQuotes, notifications, orders } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { findPickupPoints } from "../../../../lib/delivery";
import { deliveryTokenForSeller } from "../../../../lib/delivery/storage";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const limit = await enforceRateLimit(request, "delivery-select", 20, 600);
    if (!limit.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: limit.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const quotePublicId = cleanText(body.quotePublicId, 100);
    const addressId = Number(body.addressId);
    const pickupPointId = cleanText(body.pickupPointId, 100);
    const db = getDb();
    const [quote] = await db.select().from(deliveryQuotes).where(and(eq(deliveryQuotes.publicId, quotePublicId), eq(deliveryQuotes.buyerEmail, identity.email), eq(deliveryQuotes.status, "active"))).limit(1);
    if (!quote || Date.parse(quote.expiresAt) <= Date.now()) return Response.json({ error: "Цена доставки устарела. Выполните расчёт ещё раз.", code: "delivery_quote_expired" }, { status: 409 });
    const [order] = await db.select().from(orders).where(and(eq(orders.id, quote.orderId), eq(orders.buyerEmail, identity.email))).limit(1);
    const [address] = await db.select().from(deliveryAddresses).where(and(eq(deliveryAddresses.id, addressId), eq(deliveryAddresses.userEmail, identity.email))).limit(1);
    if (!order || !address) return Response.json({ error: "Заказ или адрес не найден" }, { status: 404 });
    if (!order.isDemo && order.paymentStatus !== "not_started") return Response.json({ error: "Доставку уже нельзя изменить после создания платежа", code: "delivery_locked" }, { status: 409 });
    let pickupPoint: Record<string, unknown> | null = null;
    if (quote.method === "pickup") {
      if (!pickupPointId) return Response.json({ error: "Выберите пункт выдачи" }, { status: 400 });
      const allowedIds = JSON.parse(quote.pickupPointIdsJson) as string[];
      const points = await findPickupPoints({ token: await deliveryTokenForSeller(order.sellerId), provider: quote.provider, city: address.city, allowedIds, demo: quote.isDemo });
      pickupPoint = points.find((point) => point.id === pickupPointId) ?? null;
      if (!pickupPoint) return Response.json({ error: "Пункт выдачи больше недоступен. Выберите другой." }, { status: 409 });
    }
    const recipient = { recipientName: address.recipientName, phone: address.phone, countryCode: address.countryCode, postalCode: address.postalCode, region: address.region, city: address.city, addressLine: address.addressLine, apartment: address.apartment, entrance: address.entrance, floor: address.floor, comment: address.comment };
    const [existing] = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).limit(1);
    const values = { provider: quote.provider, quotePublicId: quote.publicId, addressId: address.id, method: quote.method, serviceName: quote.serviceName, tariffId: quote.tariffId, amount: quote.amount, daysMin: quote.daysMin, daysMax: quote.daysMax, pickupPointId: pickupPointId || null, pickupPointJson: pickupPoint ? JSON.stringify(pickupPoint) : null, recipientJson: JSON.stringify(recipient), status: "selected", isDemo: quote.isDemo, updatedAt: new Date().toISOString() };
    const [delivery] = existing
      ? await db.update(deliveries).set(values).where(eq(deliveries.id, existing.id)).returning()
      : await db.insert(deliveries).values({ orderId: order.id, ...values }).returning();
    await db.update(orders).set({ deliveryAmount: quote.amount, amount: Math.round((order.itemAmount + quote.amount) * 100) / 100, deliveryStatus: "selected", updatedAt: new Date().toISOString() }).where(eq(orders.id, order.id));
    await db.update(deliveryQuotes).set({ status: "expired" }).where(and(eq(deliveryQuotes.orderId, order.id), ne(deliveryQuotes.id, quote.id)));
    await db.update(deliveryQuotes).set({ status: "selected" }).where(eq(deliveryQuotes.id, quote.id));
    await db.insert(notifications).values({ recipientEmail: identity.email, template: "delivery_selected", payloadJson: JSON.stringify({ orderId: order.publicId, provider: quote.providerLabel, service: quote.serviceName, amount: quote.amount, pickupPoint }) });
    await writeAudit(request, { actorEmail: identity.email, action: "delivery.selected", entityType: "delivery", entityId: delivery.id, metadata: { orderId: order.id, provider: quote.provider, method: quote.method, amount: quote.amount } });
    return Response.json({ delivery, order: { id: order.id, amount: order.itemAmount + quote.amount, deliveryAmount: quote.amount, deliveryStatus: "selected" } });
  } catch {
    return Response.json({ error: "Не удалось сохранить способ доставки" }, { status: 503 });
  }
}
