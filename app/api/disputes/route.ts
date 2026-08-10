import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { disputes, notifications, orders } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit, writeRiskEvent } from "../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../lib/security";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select({ id: disputes.id, orderId: disputes.orderId, reason: disputes.reason, status: disputes.status, resolution: disputes.resolution, createdAt: disputes.createdAt }).from(disputes).where(eq(disputes.openedByEmail, identity.email)).orderBy(desc(disputes.createdAt)).limit(100);
    return Response.json({ disputes: rows });
  } catch {
    return Response.json({ error: "Обращения временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "dispute-create", 5, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много обращений", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const reason = cleanText(body.reason, 1000);
    if (!Number.isInteger(orderId) || reason.length < 10) return Response.json({ error: "Опишите проблему подробнее" }, { status: 400 });
    const [order] = await getDb().select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerEmail, identity.email))).limit(1);
    if (!order) return Response.json({ error: "Заказ не найден" }, { status: 404 });
    const [dispute] = await getDb().insert(disputes).values({ orderId, openedByEmail: identity.email, reason }).returning();
    await getDb().update(orders).set({ status: "disputed", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    await getDb().insert(notifications).values({ recipientEmail: identity.email, template: "dispute_opened", payloadJson: JSON.stringify({ disputeId: dispute.id, orderId: order.publicId }) });
    await writeRiskEvent({ actorEmail: identity.email, eventType: "dispute_opened", score: 15, details: { orderId, disputeId: dispute.id } });
    await writeAudit(request, { actorEmail: identity.email, action: "dispute.created", entityType: "dispute", entityId: dispute.id, metadata: { orderId } });
    return Response.json({ dispute }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось открыть обращение" }, { status: 503 });
  }
}
