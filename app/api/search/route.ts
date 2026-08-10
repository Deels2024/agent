import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { offers as offersTable, quotes, searches } from "../../../db/schema";
import { requestIdentity } from "../../../lib/auth";
import { searchMarketplaces } from "../../../lib/marketplaces";
import type { SearchMode } from "../../../lib/marketplaces/types";
import { enforceRateLimit } from "../../../lib/security";

type SearchPayload = { query?: string; barcode?: string; mode?: SearchMode; limit?: number };

function normalize(payload: SearchPayload) {
  const barcode = payload.barcode?.replace(/\D/g, "").slice(0, 32) || undefined;
  const query = (barcode || payload.query || "").trim().slice(0, 240);
  const allowedModes: SearchMode[] = ["text", "barcode", "photo", "url"];
  const mode = allowedModes.includes(payload.mode as SearchMode) ? payload.mode as SearchMode : barcode ? "barcode" : "text";
  const limit = Math.max(1, Math.min(10, Number(payload.limit) || 10));
  return { query, barcode, mode, limit };
}

async function execute(request: Request, payload: SearchPayload) {
  const input = normalize(payload);
  if (!input.query) return Response.json({ error: "Укажите название товара или штрих‑код" }, { status: 400 });

  let storageReady = false;
  try {
    await ensureMarketplaceSchema();
    storageReady = true;
    const rate = await enforceRateLimit(request, "public-search", 30, 300);
    if (!rate.allowed) return Response.json({ error: "Слишком много поисков. Повторите немного позже.", retryAfter: rate.retryAfter }, { status: 429 });
  } catch {
    storageReady = false;
  }

  const result = await searchMarketplaces(input);
  const identity = requestIdentity(request);
  let searchId: number | null = null;
  let persistence: "saved" | "unavailable" = "saved";
  let responseOffers = result.offers.map((offer) => ({ ...offer, quoteId: null as string | null }));
  try {
    if (!storageReady) throw new Error("storage_unavailable");
    const db = getDb();
    const [saved] = await db.insert(searches).values({
      userEmail: identity?.email ?? null,
      query: input.query,
      searchType: input.mode,
      barcode: input.barcode,
      providerCount: result.configuredCount,
      offerCount: result.offers.length,
      isDemo: result.demo,
    }).returning({ id: searches.id });
    searchId = saved.id;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    responseOffers = [];
    for (const offer of result.offers) {
      const [storedOffer] = await db.insert(offersTable).values({
        searchId: saved.id,
        provider: offer.provider,
        providerLabel: offer.providerLabel,
        externalId: offer.externalId,
        sellerId: offer.sellerId ?? null,
        inventoryItemId: offer.inventoryItemId ?? null,
        productName: offer.productName,
        sellerName: offer.sellerName,
        price: offer.price,
        deliveryPrice: offer.deliveryPrice ?? 0,
        oldPrice: offer.oldPrice,
        deliveryDays: offer.deliveryDays,
        inStock: offer.inStock,
        score: offer.score,
        matchConfidence: offer.matchConfidence ?? 0,
        verified: offer.verified,
        url: offer.url,
      }).returning({ id: offersTable.id });
      const quoteId = `Q-${crypto.randomUUID()}`;
      await db.insert(quotes).values({
        publicId: quoteId,
        userEmail: identity?.email ?? null,
        searchId: saved.id,
        offerId: storedOffer.id,
        sellerId: offer.sellerId ?? null,
        inventoryItemId: offer.inventoryItemId ?? null,
        provider: offer.provider,
        providerLabel: offer.providerLabel,
        sellerName: offer.sellerName,
        productName: offer.productName,
        itemAmount: offer.price,
        deliveryAmount: offer.deliveryPrice ?? 0,
        totalAmount: offer.price + (offer.deliveryPrice ?? 0),
        sourceUrl: offer.url ?? null,
        isDemo: result.demo,
        expiresAt,
      });
      responseOffers.push({ ...offer, quoteId });
    }
  } catch {
    persistence = "unavailable";
  }

  return Response.json({
    searchId,
    query: input.query,
    mode: input.mode,
    demo: result.demo,
    generatedAt: new Date().toISOString(),
    persistence,
    summary: {
      checkedSources: result.providers.length,
      connectedSources: result.configuredCount,
      found: result.offers.length,
      bestPrice: result.offers[0] ? result.offers[0].price + (result.offers[0].deliveryPrice ?? 0) : null,
    },
    providers: result.providers,
    offers: responseOffers,
  });
}

export async function POST(request: Request) {
  let payload: SearchPayload;
  try { payload = await request.json() as SearchPayload; }
  catch { return Response.json({ error: "Некорректный JSON" }, { status: 400 }); }
  return execute(request, payload);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return execute(request, {
    query: url.searchParams.get("q") ?? undefined,
    barcode: url.searchParams.get("barcode") ?? undefined,
    mode: (url.searchParams.get("mode") ?? undefined) as SearchMode | undefined,
    limit: Number(url.searchParams.get("limit") || 10),
  });
}
