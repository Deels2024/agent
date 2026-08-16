import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveryAddresses, deliveryQuotes, orders } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { calculateDeliveryRates } from "../../../../lib/delivery";
import { deliveryTokenForSeller, packageForOrder, publicAddress, senderForSeller } from "../../../../lib/delivery/storage";
import { enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const limit = await enforceRateLimit(request, "delivery-options", 30, 600);
    if (!limit.allowed) return Response.json({ error: "Слишком много расчётов", retryAfter: limit.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const addressId = Number(body.addressId);
    if (!Number.isInteger(orderId) || !Number.isInteger(addressId)) return Response.json({ error: "Выберите заказ и адрес" }, { status: 400 });
    const db = getDb();
    const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerEmail, identity.email))).limit(1);
    if (!order) return Response.json({ error: "Заказ не найден" }, { status: 404 });
    if (!order.isDemo && order.paymentStatus !== "not_started") return Response.json({ error: "Доставку можно изменить только до создания платежа", code: "delivery_locked" }, { status: 409 });
    const [address] = await db.select().from(deliveryAddresses).where(and(eq(deliveryAddresses.id, addressId), eq(deliveryAddresses.userEmail, identity.email))).limit(1);
    if (!address) return Response.json({ error: "Адрес не найден" }, { status: 404 });
    const packageSpec = await packageForOrder(order.quotePublicId, order.isDemo);
    if (!packageSpec) return Response.json({ error: "Продавцу нужно указать вес и габариты товара", code: "package_dimensions_required" }, { status: 409 });
    const sender = await senderForSeller(order.sellerId);
    const token = sender ? await deliveryTokenForSeller(order.sellerId) : undefined;
    const calculation = {
      from: sender ?? { countryCode: "RU", city: address.city, addressLine: address.addressLine },
      to: publicAddress(address),
      package: packageSpec,
      assessedCost: order.itemAmount,
      currentSellerPrice: order.deliveryAmount,
      demo: order.isDemo,
    };
    let externalNetwork = Boolean(sender && token);
    let providerWarning: string | null = null;
    let rates;
    try {
      rates = await calculateDeliveryRates({ ...calculation, token: sender ? token : "" });
    } catch (error) {
      if (order.isDemo) throw error;
      externalNetwork = false;
      providerWarning = "Внешняя сеть временно не ответила — показываем доставку продавца.";
      rates = await calculateDeliveryRates({ ...calculation, token: "" });
    }
    if (!rates.length) return Response.json({ error: "По этому адресу пока нет доступной доставки", code: "no_delivery_rates" }, { status: 422 });
    await db.update(deliveryQuotes).set({ status: "expired" }).where(and(eq(deliveryQuotes.orderId, order.id), eq(deliveryQuotes.status, "active")));
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const quoteRows = rates.map((rate) => ({ publicId: `DLV-${crypto.randomUUID()}`, orderId: order.id, buyerEmail: identity.email, provider: rate.provider, providerLabel: rate.providerLabel, serviceName: rate.serviceName, method: rate.method, tariffId: rate.tariffId, amount: rate.price, daysMin: rate.daysMin, daysMax: rate.daysMax, pickupPointIdsJson: JSON.stringify(rate.pickupPointIds), isDemo: rate.isDemo, expiresAt }));
    const saved = await db.insert(deliveryQuotes).values(quoteRows).returning();
    await writeAudit(request, { actorEmail: identity.email, action: "delivery.rates_calculated", entityType: "order", entityId: order.id, metadata: { addressId, rateCount: saved.length, externalNetwork, providerWarning, demo: order.isDemo } });
    return Response.json({ rates: saved, expiresAt, package: packageSpec, externalNetwork, providerWarning, fallbackAvailable: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("delivery_provider_")) return Response.json({ error: "Служба доставки не ответила. Доставка продавца остаётся доступна.", code: message.split(":")[0] }, { status: 502 });
    return Response.json({ error: "Не удалось рассчитать доставку" }, { status: 503 });
  }
}
