import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { orders, paymentIntents, webhookEvents } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { runtimeValue } from "../../../../lib/runtime";
import { cleanText } from "../../../../lib/security";
import { verifyHmac, webhookEventKey } from "../../../../lib/webhook";

const allowedStatuses = new Set(["pending", "succeeded", "cancelled", "refunded"]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!await verifyHmac(rawBody, request.headers.get("x-agent-signature"), runtimeValue("PAYMENT_WEBHOOK_SECRET"))) return Response.json({ error: "Некорректная подпись" }, { status: 401 });
  try {
    await ensureMarketplaceSchema();
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const externalId = cleanText(body.externalId, 150);
    const status = cleanText(body.status, 30);
    if (!externalId || !allowedStatuses.has(status)) return Response.json({ error: "Некорректное событие" }, { status: 400 });
    const [payment] = await getDb().select().from(paymentIntents).where(eq(paymentIntents.externalId, externalId)).limit(1);
    if (!payment) return Response.json({ error: "Платёж не найден" }, { status: 404 });
    const reportedAmount = body.amount == null ? payment.amount : Number(body.amount);
    if (!Number.isFinite(reportedAmount) || Math.abs(reportedAmount - payment.amount) > 0.009) return Response.json({ error: "Сумма события не совпадает с платёжным намерением" }, { status: 409 });
    const transitions: Record<string, string[]> = { created: ["pending", "succeeded", "cancelled"], pending: ["succeeded", "cancelled"], succeeded: ["refunded"], cancelled: [], refunded: [] };
    if (payment.status !== status && !(transitions[payment.status] ?? ["pending", "succeeded", "cancelled", "refunded"]).includes(status)) return Response.json({ error: "Недопустимый переход статуса платежа" }, { status: 409 });
    const eventKey = await webhookEventKey(rawBody, body.eventId);
    const [event] = await getDb().insert(webhookEvents).values({ provider: "payment", eventKey }).onConflictDoNothing().returning({ id: webhookEvents.id });
    if (!event) return Response.json({ ok: true, duplicate: true });
    await getDb().update(paymentIntents).set({ status, updatedAt: new Date().toISOString() }).where(eq(paymentIntents.id, payment.id));
    const orderStatus = status === "succeeded" ? "paid" : status === "refunded" ? "refunded" : status === "cancelled" ? "payment_cancelled" : "awaiting_payment";
    await getDb().update(orders).set({ paymentStatus: status, status: orderStatus, updatedAt: new Date().toISOString() }).where(eq(orders.id, payment.orderId));
    await writeAudit(request, { actorEmail: "payment-webhook", action: `payment.${status}`, entityType: "payment_intent", entityId: payment.id, metadata: { orderId: payment.orderId } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось обработать событие" }, { status: 503 });
  }
}
