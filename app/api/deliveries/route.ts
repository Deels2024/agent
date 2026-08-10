import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { deliveries, orders, sellers } from "../../../db/schema";
import { adminEmails, requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit } from "../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../lib/security";
import { getLegalStatus } from "../../../lib/legal";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select({ id: deliveries.id, orderId: deliveries.orderId, provider: deliveries.provider, externalId: deliveries.externalId, status: deliveries.status, eta: deliveries.eta, trackingUrl: deliveries.trackingUrl, updatedAt: deliveries.updatedAt }).from(deliveries).innerJoin(orders, eq(deliveries.orderId, orders.id)).where(eq(orders.buyerEmail, identity.email)).orderBy(desc(deliveries.updatedAt)).limit(100);
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
    const rate = await enforceRateLimit(request, "delivery-create", 30, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const provider = cleanText(body.provider, 60);
    const externalId = cleanText(body.externalId, 120);
    const eta = cleanText(body.eta, 80);
    const trackingUrl = cleanText(body.trackingUrl, 500);
    if (!Number.isInteger(orderId) || provider.length < 2) return Response.json({ error: "Проверьте заказ и перевозчика" }, { status: 400 });
    const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId)).limit(1);
    if (!order) return Response.json({ error: "Заказ не найден" }, { status: 404 });
    const [seller] = order.sellerId ? await getDb().select().from(sellers).where(and(eq(sellers.id, order.sellerId), eq(sellers.ownerEmail, identity.email))).limit(1) : [];
    if (!seller && !adminEmails().has(identity.email)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    if (seller && !adminEmails().has(identity.email) && !(await getLegalStatus(identity.email, "seller")).complete) return Response.json({ error: "Примите актуальные документы продавца", code: "seller_legal_acceptance_required" }, { status: 428 });
    const [delivery] = await getDb().insert(deliveries).values({ orderId, provider, externalId: externalId || null, eta: eta || null, trackingUrl: trackingUrl || null }).returning();
    await getDb().update(orders).set({ deliveryStatus: "created", status: "processing", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    await writeAudit(request, { actorEmail: identity.email, action: "delivery.created", entityType: "delivery", entityId: delivery.id, metadata: { orderId, provider } });
    return Response.json({ delivery }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось создать отправление" }, { status: 503 });
  }
}
