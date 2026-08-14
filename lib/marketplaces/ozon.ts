import { runtimeValue } from "../runtime";
import { fetchJson, matchesOffer, numberFrom } from "./common";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, SearchInput } from "./types";

function status(): MarketplaceStatus {
  const missing = [
    !runtimeValue("OZON_CLIENT_ID") && "OZON_CLIENT_ID",
    !runtimeValue("OZON_API_KEY") && "OZON_API_KEY",
  ].filter(Boolean) as string[];
  return {
    provider: "ozon",
    label: "Ozon",
    configured: missing.length === 0,
    mode: "seller-api",
    missing,
    coverage: "Товары, цены и наличие подключённых продавцов Ozon",
  };
}

async function search(input: SearchInput): Promise<NormalizedOffer[]> {
  const clientId = runtimeValue("OZON_CLIENT_ID");
  const apiKey = runtimeValue("OZON_API_KEY");
  if (!clientId || !apiKey) return [];
  const headers = { "Content-Type": "application/json", "Client-Id": clientId, "Api-Key": apiKey };
  const listPayload = await fetchJson("https://api-seller.ozon.ru/v3/product/list", {
    method: "POST",
    headers,
    body: JSON.stringify({ filter: { visibility: "ALL" }, last_id: "", limit: 500 }),
  });
  const result = (listPayload.result ?? {}) as Record<string, unknown>;
  const listItems = Array.isArray(result.items) ? result.items as Array<Record<string, unknown>> : [];
  const productIds = listItems.map((item) => item.product_id).filter(Boolean).slice(0, 500);
  if (!productIds.length) return [];

  const infoPayload = await fetchJson("https://api-seller.ozon.ru/v3/product/info/list", {
    method: "POST",
    headers,
    body: JSON.stringify({ product_id: productIds }),
  });
  const infoItems = Array.isArray(infoPayload.items) ? infoPayload.items as Array<Record<string, unknown>> : [];
  const stockById = new Map(listItems.map((item) => [String(item.product_id), Boolean(item.has_fbo_stocks || item.has_fbs_stocks)]));

  return infoItems.filter((item) => {
    const barcodes = Array.isArray(item.barcodes) ? item.barcodes : [];
    return matchesOffer(input, [item.name, item.offer_id, item.id, item.sku, ...barcodes]);
  }).slice(0, input.limit * 2).map((item): NormalizedOffer => {
    const productId = String(item.id ?? item.product_id ?? item.offer_id ?? crypto.randomUUID());
    const barcodes = Array.isArray(item.barcodes) ? item.barcodes.map(String) : [];
    const images = Array.isArray(item.images) ? item.images.map(String) : [];
    const price = numberFrom(item.marketing_price || item.price || item.min_price);
    const oldPrice = numberFrom(item.old_price);
    return {
      id: `ozon:${productId}`,
      provider: "ozon",
      providerLabel: "Ozon",
      productName: String(item.name || input.query),
      externalId: productId,
      sellerName: "Подключённый продавец Ozon",
      price,
      oldPrice: oldPrice > price ? oldPrice : undefined,
      deliveryDays: 1,
      inStock: stockById.get(productId) ?? true,
      score: 0,
      url: `https://www.ozon.ru/search/?text=${encodeURIComponent(String(item.name || input.query))}`,
      barcode: barcodes[0],
      model: String(item.name || "") || undefined,
      mpn: String(item.offer_id || "") || undefined,
      imageUrl: String(item.primary_image || images[0] || "") || undefined,
      updatedAt: new Date().toISOString(),
      verified: true,
    };
  });
}

export const ozonAdapter: MarketplaceAdapter = { status, search };
