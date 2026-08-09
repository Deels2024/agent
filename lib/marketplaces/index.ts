import { safeMessage, rankOffers } from "./common";
import { ozonAdapter } from "./ozon";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, ProviderResult, SearchInput } from "./types";
import { wildberriesAdapter } from "./wildberries";
import { yandexMarketAdapter } from "./yandex-market";

const adapters: MarketplaceAdapter[] = [wildberriesAdapter, ozonAdapter, yandexMarketAdapter];

export function marketplaceStatuses(): MarketplaceStatus[] {
  return adapters.map((adapter) => adapter.status());
}

async function runAdapter(adapter: MarketplaceAdapter, input: SearchInput): Promise<ProviderResult> {
  const current = adapter.status();
  if (!current.configured) {
    return { provider: current.provider, label: current.label, status: "not_configured", latencyMs: 0, offers: [] };
  }
  const started = Date.now();
  try {
    const offers = await adapter.search(input);
    return { provider: current.provider, label: current.label, status: "ok", latencyMs: Date.now() - started, offers };
  } catch (error) {
    return { provider: current.provider, label: current.label, status: "error", latencyMs: Date.now() - started, offers: [], error: safeMessage(error) };
  }
}

const demoOffers: NormalizedOffer[] = [
  { id: "demo:local", provider: "local_seller", providerLabel: "Малый магазин", productName: "Apple AirPods Pro 2 USB‑C", externalId: "local-1042", sellerName: "ТехноДом", price: 20390, oldPrice: 22990, deliveryDays: 1, inStock: true, score: 98, url: undefined, verified: true },
  { id: "demo:yandex", provider: "demo", providerLabel: "Яндекс Маркет", productName: "Apple AirPods Pro 2 USB‑C", externalId: "demo-ym", sellerName: "Проверенный продавец", price: 20490, oldPrice: 23990, deliveryDays: 1, inStock: true, score: 97, url: "https://market.yandex.ru/search?text=AirPods%20Pro%202", verified: true },
  { id: "demo:ozon", provider: "demo", providerLabel: "Ozon", productName: "Apple AirPods Pro 2 USB‑C", externalId: "demo-oz", sellerName: "Проверенный продавец", price: 20790, oldPrice: 23990, deliveryDays: 1, inStock: true, score: 96, url: "https://www.ozon.ru/search/?text=AirPods%20Pro%202", verified: true },
  { id: "demo:wb", provider: "demo", providerLabel: "Wildberries", productName: "Apple AirPods Pro 2 USB‑C", externalId: "demo-wb", sellerName: "Проверенный продавец", price: 21150, oldPrice: 24500, deliveryDays: 2, inStock: true, score: 94, url: "https://www.wildberries.ru/catalog/0/search.aspx?search=AirPods%20Pro%202", verified: true },
];

export async function searchMarketplaces(input: SearchInput) {
  const providers = await Promise.all(adapters.map((adapter) => runAdapter(adapter, input)));
  const configuredCount = marketplaceStatuses().filter((item) => item.configured).length;
  const liveOffers = providers.flatMap((provider) => provider.offers);
  const demo = configuredCount === 0;
  const offers = rankOffers(demo ? demoOffers : liveOffers, input.limit);
  return { providers, offers, demo, configuredCount };
}

export type { MarketplaceStatus, NormalizedOffer, ProviderResult, SearchInput } from "./types";
