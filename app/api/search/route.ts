import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { offers as offersTable, searches } from "../../../db/schema";
import { searchMarketplaces } from "../../../lib/marketplaces";
import type { SearchMode } from "../../../lib/marketplaces/types";

type SearchPayload = { query?: string; barcode?: string; mode?: SearchMode; limit?: number };

function normalize(payload: SearchPayload) {
  const barcode = payload.barcode?.replace(/\D/g, "").slice(0, 32) || undefined;
  const query = (barcode || payload.query || "").trim().slice(0, 240);
  const allowedModes: SearchMode[] = ["text", "barcode", "photo", "url"];
  const mode = allowedModes.includes(payload.mode as SearchMode) ? payload.mode as SearchMode : barcode ? "barcode" : "text";
  const limit = Math.max(1, Math.min(10, Number(payload.limit) || 10));
  return { query, barcode, mode, limit };
}

async function execute(payload: SearchPayload) {
  const input = normalize(payload);
  if (!input.query) return Response.json({ error: "Укажите название товара или штрих‑код" }, { status: 400 });

  const result = await searchMarketplaces(input);
  let searchId: number | null = null;
  let persistence: "saved" | "unavailable" = "saved";
  try {
    await ensureMarketplaceSchema();
    const db = getDb();
    const [saved] = await db.insert(searches).values({
      query: input.query,
      searchType: input.mode,
      barcode: input.barcode,
      providerCount: result.configuredCount,
      offerCount: result.offers.length,
      isDemo: result.demo,
    }).returning({ id: searches.id });
    searchId = saved.id;
    if (result.offers.length) {
      await db.insert(offersTable).values(result.offers.map((offer) => ({
        searchId: saved.id,
        provider: offer.provider,
        externalId: offer.externalId,
        productName: offer.productName,
        sellerName: offer.sellerName,
        price: offer.price,
        oldPrice: offer.oldPrice,
        deliveryDays: offer.deliveryDays,
        inStock: offer.inStock,
        score: offer.score,
        url: offer.url,
      })));
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
      bestPrice: result.offers[0]?.price ?? null,
    },
    providers: result.providers,
    offers: result.offers,
  });
}

export async function POST(request: Request) {
  let payload: SearchPayload;
  try { payload = await request.json() as SearchPayload; }
  catch { return Response.json({ error: "Некорректный JSON" }, { status: 400 }); }
  return execute(payload);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return execute({
    query: url.searchParams.get("q") ?? undefined,
    barcode: url.searchParams.get("barcode") ?? undefined,
    mode: (url.searchParams.get("mode") ?? undefined) as SearchMode | undefined,
    limit: Number(url.searchParams.get("limit") || 10),
  });
}
