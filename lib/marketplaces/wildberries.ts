import { runtimeValue } from "../runtime";
import { fetchJson, matchesOffer, numberFrom } from "./common";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, SearchInput } from "./types";

function status(): MarketplaceStatus {
  const missing = [
    !runtimeValue("WB_API_TOKEN") && "WB_API_TOKEN",
    !runtimeValue("WB_CLIENT_SECRET") && "WB_CLIENT_SECRET",
  ].filter(Boolean) as string[];
  return {
    provider: "wildberries",
    label: "Wildberries",
    configured: missing.length === 0,
    mode: "seller-api",
    missing,
    coverage: "Карточки и цены подключённых продавцов Wildberries",
  };
}

async function search(input: SearchInput): Promise<NormalizedOffer[]> {
  const token = runtimeValue("WB_API_TOKEN");
  const clientSecret = runtimeValue("WB_CLIENT_SECRET");
  if (!token || !clientSecret) return [];
  const headers = {
    Authorization: token,
    "X-Client-Secret": clientSecret,
    "Content-Type": "application/json",
    "User-Agent": "BuyerAgent/1.0",
  };
  const cardsPayload = await fetchJson("https://content-api.wildberries.ru/content/v2/get/cards/list?locale=ru", {
    method: "POST",
    headers,
    body: JSON.stringify({
      settings: {
        sort: { ascending: false },
        filter: { textSearch: input.barcode || input.query, withPhoto: -1 },
        cursor: { limit: 100 },
      },
    }),
  });
  const data = (cardsPayload.cards ? cardsPayload : cardsPayload.data ?? {}) as Record<string, unknown>;
  const cards = Array.isArray(data.cards) ? data.cards as Array<Record<string, unknown>> : [];
  const nmIds = cards.map((card) => numberFrom(card.nmID)).filter(Boolean);
  let priceByNm = new Map<number, Record<string, unknown>>();
  if (nmIds.length) {
    const pricePayload = await fetchJson("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter", {
      method: "POST",
      headers,
      body: JSON.stringify({ nmList: nmIds }),
    });
    const priceData = (pricePayload.data ?? {}) as Record<string, unknown>;
    const prices = Array.isArray(priceData.listGoods) ? priceData.listGoods as Array<Record<string, unknown>> : [];
    priceByNm = new Map(prices.map((price) => [numberFrom(price.nmID), price]));
  }

  return cards.filter((card) => {
    const sizes = Array.isArray(card.sizes) ? card.sizes as Array<Record<string, unknown>> : [];
    const skus = sizes.flatMap((size) => Array.isArray(size.skus) ? size.skus : []);
    return matchesOffer(input, [card.title, card.brand, card.vendorCode, card.nmID, ...skus]);
  }).slice(0, input.limit * 2).map((card): NormalizedOffer => {
    const nmId = numberFrom(card.nmID);
    const priceInfo = priceByNm.get(nmId) ?? {};
    const price = numberFrom(priceInfo.discountedPrice || priceInfo.clubDiscountedPrice || priceInfo.price);
    const sizes = Array.isArray(card.sizes) ? card.sizes as Array<Record<string, unknown>> : [];
    const barcode = sizes.flatMap((size) => Array.isArray(size.skus) ? size.skus.map(String) : [])[0];
    const photos = Array.isArray(card.photos) ? card.photos as Array<Record<string, unknown>> : [];
    return {
      id: `wildberries:${nmId}`,
      provider: "wildberries",
      providerLabel: "Wildberries",
      productName: [card.brand, card.title].filter(Boolean).join(" ") || input.query,
      externalId: String(nmId),
      sellerName: "Подключённый продавец Wildberries",
      price,
      oldPrice: numberFrom(priceInfo.price) > price ? numberFrom(priceInfo.price) : undefined,
      deliveryDays: 1,
      inStock: true,
      score: 0,
      url: `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`,
      barcode,
      brand: String(card.brand || "") || undefined,
      model: String(card.title || "") || undefined,
      mpn: String(card.vendorCode || "") || undefined,
      imageUrl: String(photos[0]?.big || photos[0]?.c516x688 || "") || undefined,
      updatedAt: new Date().toISOString(),
      verified: true,
    };
  });
}

export const wildberriesAdapter: MarketplaceAdapter = { status, search };
