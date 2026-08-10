import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { demandRequests, inventoryItems, notifications, sellerProposals, sellers } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { matchesOffer } from "../../../../lib/marketplaces/common";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

async function ownedSeller(email: string) {
  const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, email)).limit(1);
  return seller ?? null;
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ requests: [], proposals: [], eligibility: "profile_required" });
    const [items, openRequests, proposals] = await Promise.all([
      getDb().select().from(inventoryItems).where(and(eq(inventoryItems.sellerId, seller.id), eq(inventoryItems.status, "active"))).limit(500),
      getDb().select().from(demandRequests).where(eq(demandRequests.status, "open")).orderBy(desc(demandRequests.createdAt)).limit(100),
      getDb().select().from(sellerProposals).where(eq(sellerProposals.sellerId, seller.id)).orderBy(desc(sellerProposals.createdAt)).limit(100),
    ]);
    const now = Date.now();
    const matched = openRequests.filter((requestItem) => Date.parse(requestItem.expiresAt) > now && items.some((item) => item.stock > 0 && matchesOffer({ query: requestItem.query, barcode: requestItem.barcode ?? undefined, mode: requestItem.barcode ? "barcode" : "text", limit: 10 }, [item.productName, item.barcode])));
    return Response.json({ seller: { id: seller.id, status: seller.status, kycStatus: seller.kycStatus }, requests: matched, proposals, items, eligibility: seller.status === "active" && seller.kycStatus === "verified" ? "eligible" : "verification_required" });
  } catch {
    return Response.json({ error: "Входящий спрос временно недоступен" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "seller-proposal", 30, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много предложений. Повторите позже.", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller || seller.status !== "active" || seller.kycStatus !== "verified") return Response.json({ error: "Предлагать цену могут только проверенные магазины", code: "seller_not_verified" }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const requestId = Number(body.requestId);
    const inventoryItemId = Number(body.inventoryItemId);
    const price = Number(body.price);
    const deliveryPrice = Math.max(0, Number(body.deliveryPrice) || 0);
    const deliveryDays = Math.max(0, Math.min(30, Math.floor(Number(body.deliveryDays) || 1)));
    const warrantyMonths = Math.max(0, Math.min(60, Math.floor(Number(body.warrantyMonths) || 12)));
    const comment = cleanText(body.comment, 500);
    if (!Number.isInteger(requestId) || !Number.isInteger(inventoryItemId) || !Number.isFinite(price) || price <= 0 || price > 10_000_000) return Response.json({ error: "Проверьте товар, цену и доставку" }, { status: 400 });
    const [requestItem] = await getDb().select().from(demandRequests).where(and(eq(demandRequests.id, requestId), eq(demandRequests.status, "open"))).limit(1);
    const [item] = await getDb().select().from(inventoryItems).where(and(eq(inventoryItems.id, inventoryItemId), eq(inventoryItems.sellerId, seller.id), eq(inventoryItems.status, "active"))).limit(1);
    if (!requestItem || Date.parse(requestItem.expiresAt) <= Date.now()) return Response.json({ error: "Запрос уже закрыт" }, { status: 409 });
    if (!item || item.stock < requestItem.quantity) return Response.json({ error: "Недостаточно товара в наличии" }, { status: 409 });
    if (!matchesOffer({ query: requestItem.query, barcode: requestItem.barcode ?? undefined, mode: requestItem.barcode ? "barcode" : "text", limit: 10 }, [item.productName, item.barcode])) return Response.json({ error: "Выбранный товар не совпадает с запросом покупателя" }, { status: 409 });
    await getDb().insert(sellerProposals).values({ requestId, sellerId: seller.id, inventoryItemId, price: Math.round(price * 100) / 100, deliveryPrice: Math.round(deliveryPrice * 100) / 100, deliveryDays, warrantyMonths, comment: comment || null }).onConflictDoUpdate({ target: [sellerProposals.requestId, sellerProposals.sellerId], set: { inventoryItemId, price: Math.round(price * 100) / 100, deliveryPrice: Math.round(deliveryPrice * 100) / 100, deliveryDays, warrantyMonths, comment: comment || null, status: "active", updatedAt: new Date().toISOString() } });
    await getDb().insert(notifications).values({ recipientEmail: requestItem.buyerEmail, template: "seller_proposal_received", payloadJson: JSON.stringify({ requestId, sellerName: seller.name, price, deliveryPrice, deliveryDays }) });
    await writeAudit(request, { actorEmail: identity.email, action: "seller_proposal.saved", entityType: "demand_request", entityId: requestId, metadata: { sellerId: seller.id, inventoryItemId } });
    return Response.json({ ok: true, message: "Предложение отправлено покупателю" }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось отправить предложение" }, { status: 503 });
  }
}
