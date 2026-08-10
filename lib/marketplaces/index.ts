import { safeMessage, rankOffers } from "./common";
import { ozonAdapter } from "./ozon";
import { localSellersAdapter } from "./local-sellers";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, ProviderResult, SearchInput } from "./types";
import { wildberriesAdapter } from "./wildberries";
import { yandexMarketAdapter } from "./yandex-market";

const adapters: MarketplaceAdapter[] = [localSellersAdapter, wildberriesAdapter, ozonAdapter, yandexMarketAdapter];

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

function demoOffers(input: SearchInput): NormalizedOffer[] {
  const seed = Array.from(input.query).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const base = 9000 + (seed % 16000);
  return [0, 1, 2].map((index) => ({
    id: `demo:${index + 1}`,
    provider: "demo" as const,
    providerLabel: "Учебный пример",
    productName: input.query,
    externalId: `demo-${seed}-${index + 1}`,
    sellerName: `Демо-магазин ${index + 1}`,
    price: base + index * 650,
    oldPrice: base + index * 650 + 1800,
    deliveryPrice: index === 0 ? 390 : 0,
    deliveryDays: index + 1,
    inStock: true,
    score: 0,
    matchConfidence: 100,
    verified: false,
  }));
}

export async function searchMarketplaces(input: SearchInput) {
  const providers = await Promise.all(adapters.map((adapter) => runAdapter(adapter, input)));
  const configuredCount = marketplaceStatuses().filter((item) => item.configured).length;
  const externalConfiguredCount = marketplaceStatuses().filter((item) => item.provider !== "local_seller" && item.configured).length;
  const liveOffers = providers.flatMap((provider) => provider.offers);
  const demo = liveOffers.length === 0 && externalConfiguredCount === 0;
  const offers = rankOffers(demo ? demoOffers(input) : liveOffers, input.limit, input);
  return { providers, offers, demo, configuredCount };
}

export type { MarketplaceStatus, NormalizedOffer, ProviderResult, SearchInput } from "./types";
