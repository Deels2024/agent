import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { orders, paymentIntents } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { runtimeValue } from "../../../../lib/runtime";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

type GatewayResponse = { externalId?: string; confirmationUrl?: string; status?: string };

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "payment-intent", 12, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток оплаты", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const idempotencyKey = cleanText(body.idempotencyKey, 100) || crypto.randomUUID();
    if (!Number.isInteger(orderId) || orderId <= 0) return Response.json({ error: "Некорректный заказ" }, { status: 400 });
    const [order] = await getDb().select().from(orders).where(and(eq(orders.id, orderId), eq(orders.buyerEmail, identity.email))).limit(1);
    if (!order) return Response.json({ error: "Заказ не найден" }, { status: 404 });
    if (order.isDemo) return Response.json({ error: "Демонстрационный заказ нельзя оплатить", code: "demo_order" }, { status: 409 });
    if (!order.sellerId || !["created", "awaiting_payment"].includes(order.status)) return Response.json({ error: "Заказ пока нельзя оплатить", code: "order_not_payable" }, { status: 409 });
    if (order.saleContractParty !== "seller") return Response.json({ error: "Платёж заблокирован: продавец товара не определён", code: "seller_of_record_required" }, { status: 409 });
    const [existing] = await getDb().select().from(paymentIntents).where(eq(paymentIntents.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) return Response.json({ payment: existing, idempotent: true, moneyMoved: false });

    const provider = runtimeValue("PAYMENT_PROVIDER") ?? "disabled";
    if (provider === "sandbox") {
      const [payment] = await getDb().insert(paymentIntents).values({ orderId, provider, idempotencyKey, amount: order.amount, status: "sandbox_created" }).returning();
      await getDb().update(orders).set({ paymentStatus: "sandbox", status: "awaiting_payment", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
      await writeAudit(request, { actorEmail: identity.email, action: "payment.sandbox_created", entityType: "payment_intent", entityId: payment.id, metadata: { orderId } });
      return Response.json({ payment, moneyMoved: false, warning: "Тестовый режим: деньги не списывались" }, { status: 201 });
    }

    const apiUrl = runtimeValue("PAYMENT_API_URL");
    const apiKey = runtimeValue("PAYMENT_API_KEY");
    const paymentModel = runtimeValue("PAYMENT_MODEL") ?? "disabled";
    if (!["seller_direct", "bank_safe_deal", "split_payment"].includes(paymentModel)) return Response.json({ error: "Не выбрана законная схема расчёта с перечислением продавцу или банковским партнёром", code: "compliant_payment_model_not_configured" }, { status: 503 });
    if (provider !== "webhook" || !apiUrl || !apiKey) {
      return Response.json({ error: "Платёжный партнёр ещё не подключён", code: "payment_provider_not_configured" }, { status: 503 });
    }
    const gatewayResponse = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "idempotency-key": idempotencyKey }, body: JSON.stringify({ orderId: order.publicId, amount: order.amount, currency: order.currency, description: order.productName, returnUrl: runtimeValue("PAYMENT_RETURN_URL"), paymentModel, sellerId: order.sellerId, sellerOfRecord: order.sellerName, saleContractParty: "seller", receiptIssuer: "seller" }) });
    if (!gatewayResponse.ok) return Response.json({ error: "Платёжный шлюз временно недоступен", code: "payment_gateway_error" }, { status: 502 });
    const gateway = await gatewayResponse.json() as GatewayResponse;
    if (!gateway.externalId || !gateway.confirmationUrl) return Response.json({ error: "Платёжный шлюз вернул неполный ответ", code: "payment_gateway_invalid_response" }, { status: 502 });
    const [payment] = await getDb().insert(paymentIntents).values({ orderId, provider, externalId: gateway.externalId, idempotencyKey, amount: order.amount, status: gateway.status ?? "pending", confirmationUrl: gateway.confirmationUrl }).returning();
    await getDb().update(orders).set({ paymentStatus: "pending", status: "awaiting_payment", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    await writeAudit(request, { actorEmail: identity.email, action: "payment.created", entityType: "payment_intent", entityId: payment.id, metadata: { orderId, provider } });
    return Response.json({ payment, moneyMoved: false, paymentModel, legalModel: { saleContractParty: "seller", receiptIssuer: "seller", paymentOperator: provider } }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось подготовить оплату" }, { status: 503 });
  }
}
