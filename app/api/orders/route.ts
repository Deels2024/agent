import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { inventoryItems, notifications, orders, quotes, sellers } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit, writeRiskEvent } from "../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../lib/security";
import { LEGAL_BUNDLE_VERSION, TRANSACTION_CONFIRMATION_VERSION } from "../../../lib/legal-documents";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select().from(orders).where(eq(orders.buyerEmail, identity.email)).orderBy(desc(orders.createdAt)).limit(100);
    return Response.json({ orders: rows });
  } catch {
    return Response.json({ error: "Заказы временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  let claimedQuoteDbId: number | null = null;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "order-create", 10, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много заказов", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const quoteId = cleanText(body.quoteId, 100);
    const termsAccepted = body.termsAccepted === true;
    const sellerRoleAccepted = body.sellerRoleAccepted === true;
    const transactionVersion = cleanText(body.transactionConfirmationVersion, 40);
    if (!quoteId || !termsAccepted || !sellerRoleAccepted || transactionVersion !== TRANSACTION_CONFIRMATION_VERSION) return Response.json({ error: "Подтвердите товар, продавца, итоговую сумму и правила сделки", code: "transaction_confirmation_required", transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION }, { status: 400 });
    const [quote] = await getDb().select().from(quotes).where(eq(quotes.publicId, quoteId)).limit(1);
    if (!quote) return Response.json({ error: "Предложение не найдено. Выполните поиск ещё раз.", code: "quote_not_found" }, { status: 404 });
    if (quote.userEmail && quote.userEmail !== identity.email) return Response.json({ error: "Это предложение принадлежит другому пользователю", code: "quote_owner_mismatch" }, { status: 403 });
    if (quote.status !== "active") return Response.json({ error: "Предложение уже использовано или больше не действует", code: "quote_not_active" }, { status: 409 });
    if (Date.parse(quote.expiresAt) <= Date.now()) {
      await getDb().update(quotes).set({ status: "expired" }).where(eq(quotes.id, quote.id));
      return Response.json({ error: "Цена устарела. Обновите поиск перед оформлением.", code: "quote_expired" }, { status: 409 });
    }
    if (!quote.isDemo && quote.provider !== "local_seller") return Response.json({ error: "Это предложение оплачивается непосредственно на площадке", code: "external_checkout" }, { status: 409 });
    if (quote.sellerId) {
      const [seller] = await getDb().select().from(sellers).where(and(eq(sellers.id, quote.sellerId), eq(sellers.status, "active"), eq(sellers.kycStatus, "verified"))).limit(1);
      if (!seller) return Response.json({ error: "Продавец временно недоступен для безопасной сделки", code: "seller_not_verified" }, { status: 409 });
    }
    if (quote.inventoryItemId) {
      const [item] = await getDb().select().from(inventoryItems).where(and(eq(inventoryItems.id, quote.inventoryItemId), eq(inventoryItems.status, "active"))).limit(1);
      if (!item || item.stock < 1) return Response.json({ error: "Товар закончился у продавца", code: "out_of_stock" }, { status: 409 });
      if (quote.offerId && Math.abs(item.price - quote.itemAmount) > 0.009) return Response.json({ error: "Цена у продавца изменилась. Обновите поиск.", code: "price_changed", currentPrice: item.price }, { status: 409 });
    }
    const claimedAt = new Date().toISOString();
    const claim = await getDb().update(quotes).set({ status: "claimed", userEmail: identity.email }).where(and(eq(quotes.id, quote.id), eq(quotes.status, "active")));
    if (!claim.meta.changes) return Response.json({ error: "Предложение уже оформляется", code: "quote_claimed" }, { status: 409 });
    claimedQuoteDbId = quote.id;
    const publicId = `BA-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const [order] = await getDb().insert(orders).values({ publicId, buyerEmail: identity.email, sellerId: quote.sellerId, quotePublicId: quote.publicId, provider: quote.provider, sellerName: quote.sellerName, productName: quote.productName, itemAmount: quote.itemAmount, deliveryAmount: quote.deliveryAmount, amount: quote.totalAmount, paymentStatus: quote.isDemo ? "demo" : "not_started", isDemo: quote.isDemo, termsAcceptedAt: claimedAt, legalBundleVersion: LEGAL_BUNDLE_VERSION, transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION, saleContractParty: "seller", paymentModel: quote.isDemo ? "demo" : "seller_or_payment_partner" }).returning();
    await getDb().insert(notifications).values({ recipientEmail: identity.email, template: quote.isDemo ? "demo_order_created" : "order_created", payloadJson: JSON.stringify({ publicId, productName: quote.productName, amount: quote.totalAmount }) });
    if (quote.totalAmount >= 500_000) await writeRiskEvent({ actorEmail: identity.email, eventType: "high_value_order", score: 40, details: { orderId: order.id, amount: quote.totalAmount } });
    await writeAudit(request, { actorEmail: identity.email, action: "order.created_from_quote", entityType: "order", entityId: order.id, metadata: { publicId, sellerId: quote.sellerId, quoteId: quote.publicId, demo: quote.isDemo, sellerOfRecord: quote.sellerName, legalBundleVersion: LEGAL_BUNDLE_VERSION, transactionConfirmationVersion: TRANSACTION_CONFIRMATION_VERSION } });
    return Response.json({ order, next: quote.isDemo ? "review_demo_order" : "create_partner_payment", moneyMoved: false, legalModel: { sellerOfRecord: quote.sellerName, saleContractParty: "seller", receiptIssuer: "seller", paymentRecipient: "seller_or_payment_partner" } }, { status: 201 });
  } catch {
    if (claimedQuoteDbId) {
      try { await getDb().update(quotes).set({ status: "active" }).where(eq(quotes.id, claimedQuoteDbId)); }
      catch { /* Срок котировки всё равно ограничит повторное использование. */ }
    }
    return Response.json({ error: "Не удалось создать заказ" }, { status: 503 });
  }
}
