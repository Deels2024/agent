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
  const normalized = input.query.toLocaleLowerCase("ru");
  const scenario = normalized.includes("iphone 15 pro") && normalized.includes("256")
    ? { productName: "Apple iPhone 15 Pro 256 GB", prices: [94_990, 97_490, 101_990] }
    : normalized.includes("qe65q80d")
      ? { productName: "Samsung QE65Q80D 65″", prices: [109_990, 112_490, 116_990] }
      : normalized.includes("roborock q8 max")
        ? { productName: "Roborock Q8 Max", prices: [34_990, 36_490, 38_990] }
        : normalized.includes("airpods pro")
          ? { productName: "Apple AirPods Pro 2", prices: [19_990, 21_490, 22_990] }
          : { productName: input.query, prices: [49_990, 52_490, 55_990] };

  return scenario.prices.map((price, index) => ({
    id: `demo:${index + 1}`,
    provider: "demo" as const,
    providerLabel: "Учебный пример",
    productName: scenario.productName,
    externalId: `demo-${index + 1}`,
    sellerName: `Демо-магазин ${index + 1}`,
    price,
    deliveryPrice: index === 0 ? 390 : 0,
    deliveryDays: index + 1,
    inStock: true,
    score: 0,
    matchConfidence: 100,
    matchLevel: "exact" as const,
    matchReasons: ["Учебная модель совпадает с выбранным сценарием"],
    updatedAt: new Date().toISOString(),
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
