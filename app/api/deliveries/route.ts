import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { deliveries, notifications, orders, sellers } from "../../../db/schema";
import { adminEmails, requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit } from "../../../lib/audit";
import { createDeliveryShipment, type ShipmentParty } from "../../../lib/delivery";
import { deliveryTokenForSeller, packageForOrder, senderForSeller } from "../../../lib/delivery/storage";
import { getLegalStatus } from "../../../lib/legal";
import { cleanText, enforceRateLimit } from "../../../lib/security";

type StoredRecipient = {
  recipientName?: string;
  phone?: string;
  countryCode?: string;
  postalCode?: string | null;
  region?: string | null;
  city?: string;
  addressLine?: string;
};

function parseRecipient(raw: string | null, email: string): ShipmentParty | null {
  try {
    const value = JSON.parse(raw ?? "{}") as StoredRecipient;
    if (!value.recipientName || !value.phone || !value.city || !value.addressLine) return null;
    return { contactName: value.recipientName, phone: value.phone, email, countryCode: value.countryCode || "RU", postalCode: value.postalCode, region: value.region, city: value.city, addressLine: value.addressLine };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select({
      id: deliveries.id,
      orderId: deliveries.orderId,
      provider: deliveries.provider,
      externalId: deliveries.externalId,
      method: deliveries.method,
      serviceName: deliveries.serviceName,
      amount: deliveries.amount,
      daysMin: deliveries.daysMin,
      daysMax: deliveries.daysMax,
      pickupPointJson: deliveries.pickupPointJson,
      trackingNumber: deliveries.trackingNumber,
      status: deliveries.status,
      eta: deliveries.eta,
      trackingUrl: deliveries.trackingUrl,
      isDemo: deliveries.isDemo,
      updatedAt: deliveries.updatedAt,
    }).from(deliveries).innerJoin(orders, eq(deliveries.orderId, orders.id)).where(eq(orders.buyerEmail, identity.email)).orderBy(desc(deliveries.updatedAt)).limit(100);
    return Response.json({ deliveries: rows });
  } catch {
    return Response.json({ error: "Доставка временно недоступна" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "delivery-create", 20, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const manualTrackingNumber = cleanText(body.trackingNumber, 120);
    if (!Number.isInteger(orderId)) return Response.json({ error: "Проверьте заказ" }, { status: 400 });
    const db = getDb();
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return Response.json({ error: "Заказ не найден" }, { status: 404 });
    const [seller] = order.sellerId ? await db.select().from(sellers).where(and(eq(sellers.id, order.sellerId), eq(sellers.ownerEmail, identity.email))).limit(1) : [];
    if (!seller && !adminEmails().has(identity.email)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    if (seller && !adminEmails().has(identity.email) && !(await getLegalStatus(identity.email, "seller")).complete) return Response.json({ error: "Примите актуальные документы продавца", code: "seller_legal_acceptance_required" }, { status: 428 });
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).limit(1);
    if (!delivery || delivery.status !== "selected") return Response.json({ error: "Покупатель ещё не выбрал способ доставки", code: "delivery_not_selected" }, { status: 409 });
    if (delivery.externalId) return Response.json({ delivery, duplicate: true });
    if (!order.isDemo && !["succeeded", "paid"].includes(order.paymentStatus)) return Response.json({ error: "Отправление создаётся только после подтверждённой оплаты", code: "payment_required" }, { status: 409 });
    const recipient = parseRecipient(delivery.recipientJson, order.buyerEmail);
    if (!recipient) return Response.json({ error: "Покупателю нужно уточнить адрес и телефон" }, { status: 409 });
    const sender = await senderForSeller(order.sellerId);
    if (!sender) return Response.json({ error: "Заполните адрес отгрузки в разделе доставки", code: "sender_profile_required" }, { status: 409 });
    const packageSpec = await packageForOrder(order.quotePublicId, order.isDemo);
    if (!packageSpec) return Response.json({ error: "Укажите вес и габариты товара в каталоге", code: "package_dimensions_required" }, { status: 409 });
    const shipment = await createDeliveryShipment({
      token: await deliveryTokenForSeller(order.sellerId),
      demo: order.isDemo,
      orderNumber: order.publicId,
      provider: delivery.provider,
      tariffId: delivery.tariffId ?? "seller",
      method: delivery.method as "courier" | "pickup" | "seller" | "self_pickup",
      pickupPointId: delivery.pickupPointId,
      sender,
      recipient,
      package: packageSpec,
      itemName: order.productName,
      itemCost: order.itemAmount,
      deliveryCost: delivery.amount,
    });
    const trackingNumber = shipment.trackingNumber || manualTrackingNumber || null;
    const [updated] = await db.update(deliveries).set({ externalId: shipment.externalId, trackingNumber, trackingUrl: shipment.trackingUrl, status: shipment.status, updatedAt: new Date().toISOString() }).where(eq(deliveries.id, delivery.id)).returning();
    await db.update(orders).set({ deliveryStatus: shipment.status, status: "processing", updatedAt: new Date().toISOString() }).where(eq(orders.id, order.id));
    await db.insert(notifications).values({ recipientEmail: order.buyerEmail, template: "delivery_created", payloadJson: JSON.stringify({ orderId: order.publicId, provider: delivery.provider, service: delivery.serviceName, trackingNumber, status: shipment.status }) });
    await writeAudit(request, { actorEmail: identity.email, action: "delivery.created", entityType: "delivery", entityId: delivery.id, metadata: { orderId, provider: delivery.provider, externalId: shipment.externalId } });
    return Response.json({ delivery: updated }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "";
    if (code === "delivery_provider_not_configured") return Response.json({ error: "Подключите ApiShip или выберите доставку продавца", code }, { status: 503 });
    if (code.startsWith("delivery_provider_")) return Response.json({ error: "Перевозчик не принял отправление. Проверьте адрес, габариты и тариф.", code }, { status: 502 });
    return Response.json({ error: "Не удалось создать отправление" }, { status: 503 });
  }
}
