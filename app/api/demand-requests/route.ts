import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { demandRequests, inventoryItems, notifications, quotes, sellerProposals, sellers } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit } from "../../../lib/audit";
import { matchesOffer } from "../../../lib/marketplaces/common";
import { cleanText, enforceRateLimit } from "../../../lib/security";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const requests = await getDb().select().from(demandRequests).where(eq(demandRequests.buyerEmail, identity.email)).orderBy(desc(demandRequests.createdAt)).limit(50);
    const proposals = requests.length ? await getDb().select({
      id: sellerProposals.id,
      requestId: sellerProposals.requestId,
      sellerId: sellerProposals.sellerId,
      sellerName: sellers.name,
      price: sellerProposals.price,
      deliveryPrice: sellerProposals.deliveryPrice,
      deliveryDays: sellerProposals.deliveryDays,
      warrantyMonths: sellerProposals.warrantyMonths,
      comment: sellerProposals.comment,
      status: sellerProposals.status,
      createdAt: sellerProposals.createdAt,
    }).from(sellerProposals).innerJoin(sellers, eq(sellerProposals.sellerId, sellers.id)).orderBy(desc(sellerProposals.createdAt)).limit(200) : [];
    const ownedIds = new Set(requests.map((item) => item.id));
    return Response.json({ requests, proposals: proposals.filter((item) => ownedIds.has(item.requestId)) });
  } catch {
    return Response.json({ error: "Запросы магазинам временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "demand-request", 8, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много запросов. Дождитесь ответов магазинов.", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const query = cleanText(body.query, 240);
    const barcode = cleanText(body.barcode, 32).replace(/\D/g, "");
    const city = cleanText(body.city, 100);
    const targetPrice = body.targetPrice ? Number(body.targetPrice) : null;
    const quantity = Math.max(1, Math.min(20, Math.floor(Number(body.quantity) || 1)));
    if (query.length < 3 || (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0))) return Response.json({ error: "Укажите точную модель и корректную желаемую цену" }, { status: 400 });
    const publicId = `DR-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const [created] = await getDb().insert(demandRequests).values({ publicId, buyerEmail: identity.email, query, barcode: barcode || null, city: city || null, targetPrice, quantity, expiresAt }).returning();

    const candidates = await getDb().select({ sellerId: sellers.id, ownerEmail: sellers.ownerEmail, productName: inventoryItems.productName, barcode: inventoryItems.barcode }).from(inventoryItems).innerJoin(sellers, eq(inventoryItems.sellerId, sellers.id)).where(and(eq(inventoryItems.status, "active"), eq(sellers.status, "active"), eq(sellers.kycStatus, "verified"))).limit(500);
    const matched = new Map<number, string>();
    for (const item of candidates) if (matchesOffer({ query, barcode: barcode || undefined, mode: barcode ? "barcode" : "text", limit: 10 }, [item.productName, item.barcode])) matched.set(item.sellerId, item.ownerEmail);
    for (const [sellerId, email] of matched) await getDb().insert(notifications).values({ recipientEmail: email, template: "new_demand_request", payloadJson: JSON.stringify({ requestId: created.id, publicId, query, targetPrice, city, sellerId }) });
    await writeAudit(request, { actorEmail: identity.email, action: "demand_request.created", entityType: "demand_request", entityId: created.id, metadata: { matchedSellers: matched.size } });
    return Response.json({ request: created, matchedSellers: matched.size, message: matched.size ? "Запрос отправлен подходящим магазинам" : "Запрос сохранён и будет предложен новым подходящим магазинам" }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось отправить запрос магазинам" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const body = await request.json() as Record<string, unknown>;
    const proposalId = Number(body.proposalId);
    if (!Number.isInteger(proposalId) || proposalId <= 0) return Response.json({ error: "Некорректное предложение" }, { status: 400 });
    const [proposal] = await getDb().select({
      id: sellerProposals.id,
      requestId: sellerProposals.requestId,
      sellerId: sellerProposals.sellerId,
      inventoryItemId: sellerProposals.inventoryItemId,
      price: sellerProposals.price,
      deliveryPrice: sellerProposals.deliveryPrice,
      status: sellerProposals.status,
      query: demandRequests.query,
      buyerEmail: demandRequests.buyerEmail,
      requestStatus: demandRequests.status,
      sellerName: sellers.name,
      sellerEmail: sellers.ownerEmail,
      sellerStatus: sellers.status,
      kycStatus: sellers.kycStatus,
    }).from(sellerProposals).innerJoin(demandRequests, eq(sellerProposals.requestId, demandRequests.id)).innerJoin(sellers, eq(sellerProposals.sellerId, sellers.id)).where(eq(sellerProposals.id, proposalId)).limit(1);
    if (!proposal || proposal.buyerEmail !== identity.email) return Response.json({ error: "Предложение не найдено" }, { status: 404 });
    if (proposal.requestStatus !== "open" || proposal.status !== "active") return Response.json({ error: "Предложение уже закрыто" }, { status: 409 });
    if (proposal.sellerStatus !== "active" || proposal.kycStatus !== "verified") return Response.json({ error: "Продавец временно недоступен" }, { status: 409 });
    const now = new Date().toISOString();
    await getDb().update(demandRequests).set({ status: "accepted", acceptedProposalId: proposal.id, updatedAt: now }).where(eq(demandRequests.id, proposal.requestId));
    await getDb().update(sellerProposals).set({ status: "declined", updatedAt: now }).where(eq(sellerProposals.requestId, proposal.requestId));
    await getDb().update(sellerProposals).set({ status: "accepted", updatedAt: now }).where(eq(sellerProposals.id, proposal.id));
    const quoteId = `Q-${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await getDb().insert(quotes).values({ publicId: quoteId, userEmail: identity.email, sellerId: proposal.sellerId, inventoryItemId: proposal.inventoryItemId, provider: "local_seller", providerLabel: "Малый магазин", sellerName: proposal.sellerName, productName: proposal.query, itemAmount: proposal.price, deliveryAmount: proposal.deliveryPrice, totalAmount: proposal.price + proposal.deliveryPrice, expiresAt });
    await getDb().insert(notifications).values({ recipientEmail: proposal.sellerEmail, template: "proposal_accepted", payloadJson: JSON.stringify({ requestId: proposal.requestId, quoteId }) });
    await writeAudit(request, { actorEmail: identity.email, action: "demand_proposal.accepted", entityType: "seller_proposal", entityId: proposal.id, metadata: { requestId: proposal.requestId, quoteId } });
    return Response.json({ quoteId, expiresAt, next: "create_order" });
  } catch {
    return Response.json({ error: "Не удалось принять предложение" }, { status: 503 });
  }
}
