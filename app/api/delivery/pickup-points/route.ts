import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveryAddresses, deliveryQuotes, orders } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { findPickupPoints } from "../../../../lib/delivery";
import { deliveryTokenForSeller } from "../../../../lib/delivery/storage";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const limit = await enforceRateLimit(request, "pickup-points", 40, 600);
    if (!limit.allowed) return Response.json({ error: "Слишком много запросов", retryAfter: limit.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const quotePublicId = cleanText(body.quotePublicId, 100);
    const addressId = Number(body.addressId);
    const db = getDb();
    const [quote] = await db.select().from(deliveryQuotes).where(and(eq(deliveryQuotes.publicId, quotePublicId), eq(deliveryQuotes.buyerEmail, identity.email), eq(deliveryQuotes.status, "active"))).limit(1);
    if (!quote || Date.parse(quote.expiresAt) <= Date.now()) return Response.json({ error: "Расчёт устарел. Обновите варианты.", code: "delivery_quote_expired" }, { status: 409 });
    if (quote.method !== "pickup") return Response.json({ error: "Для этого тарифа ПВЗ не нужен" }, { status: 400 });
    const [address] = await db.select().from(deliveryAddresses).where(and(eq(deliveryAddresses.id, addressId), eq(deliveryAddresses.userEmail, identity.email))).limit(1);
    const [order] = await db.select().from(orders).where(and(eq(orders.id, quote.orderId), eq(orders.buyerEmail, identity.email))).limit(1);
    if (!address || !order) return Response.json({ error: "Заказ или адрес не найден" }, { status: 404 });
    const allowedIds = JSON.parse(quote.pickupPointIdsJson) as string[];
    const points = await findPickupPoints({ token: await deliveryTokenForSeller(order.sellerId), provider: quote.provider, city: address.city, allowedIds, demo: quote.isDemo });
    return Response.json({ points: points.slice(0, 50), provider: quote.provider, city: address.city });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("delivery_provider_")) return Response.json({ error: "Не удалось загрузить ПВЗ. Попробуйте курьерскую доставку." }, { status: 502 });
    return Response.json({ error: "Пункты выдачи временно недоступны" }, { status: 503 });
  }
}
