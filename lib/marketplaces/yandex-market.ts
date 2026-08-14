import { runtimeValue } from "../runtime";
import { fetchJson, matchesOffer, numberFrom } from "./common";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, SearchInput } from "./types";

function status(): MarketplaceStatus {
  const missing = [
    !runtimeValue("YANDEX_MARKET_API_KEY") && "YANDEX_MARKET_API_KEY",
    !runtimeValue("YANDEX_MARKET_BUSINESS_ID") && "YANDEX_MARKET_BUSINESS_ID",
  ].filter(Boolean) as string[];
  return {
    provider: "yandex_market",
    label: "Яндекс Маркет",
    configured: missing.length === 0,
    mode: "seller-api",
    missing,
    coverage: "Каталог и базовые цены подключённых кабинетов Яндекс Маркета",
  };
}

async function search(input: SearchInput): Promise<NormalizedOffer[]> {
  const apiKey = runtimeValue("YANDEX_MARKET_API_KEY");
  const businessId = runtimeValue("YANDEX_MARKET_BUSINESS_ID");
  if (!apiKey || !businessId) return [];
  const payload = await fetchJson(`https://api.partner.market.yandex.ru/v2/businesses/${encodeURIComponent(businessId)}/offer-mappings`, {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 200 }),
  });
  const result = (payload.result ?? {}) as Record<string, unknown>;
  const mappings = Array.isArray(result.offerMappings) ? result.offerMappings as Array<Record<string, unknown>> : [];
  return mappings.map((mapping) => (mapping.offer ?? mapping) as Record<string, unknown>).filter((offer) => {
    const barcodes = Array.isArray(offer.barcodes) ? offer.barcodes : [];
    return matchesOffer(input, [offer.name, offer.offerId, offer.marketSku, ...barcodes]);
  }).slice(0, input.limit * 2).map((offer): NormalizedOffer => {
    const offerId = String(offer.offerId ?? offer.marketSku ?? crypto.randomUUID());
    const basicPrice = (offer.basicPrice ?? offer.price ?? {}) as Record<string, unknown>;
    const price = numberFrom(basicPrice.value ?? offer.price);
    const oldPrice = numberFrom(basicPrice.discountBase ?? offer.oldPrice);
    const barcodes = Array.isArray(offer.barcodes) ? offer.barcodes.map(String) : [];
    const pictures = Array.isArray(offer.pictures) ? offer.pictures.map(String) : [];
    return {
      id: `yandex_market:${offerId}`,
      provider: "yandex_market",
      providerLabel: "Яндекс Маркет",
      productName: String(offer.name || input.query),
      externalId: offerId,
      sellerName: "Подключённый продавец Яндекс Маркета",
      price,
      oldPrice: oldPrice > price ? oldPrice : undefined,
      deliveryDays: 1,
      inStock: true,
      score: 0,
      url: `https://market.yandex.ru/search?text=${encodeURIComponent(String(offer.name || input.query))}`,
      barcode: barcodes[0],
      brand: String(offer.vendor || "") || undefined,
      model: String(offer.name || "") || undefined,
      mpn: String(offer.vendorCode || offer.offerId || "") || undefined,
      imageUrl: pictures[0],
      updatedAt: new Date().toISOString(),
      verified: true,
    };
  });
}

export const yandexMarketAdapter: MarketplaceAdapter = { status, search };
