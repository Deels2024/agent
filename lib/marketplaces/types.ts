export type MarketplaceId = "wildberries" | "ozon" | "yandex_market";
export type SearchMode = "text" | "barcode" | "photo" | "url";

export type MarketplaceStatus = {
  provider: MarketplaceId;
  label: string;
  configured: boolean;
  mode: "seller-api";
  missing: string[];
  coverage: string;
};

export type SearchInput = {
  query: string;
  barcode?: string;
  mode: SearchMode;
  limit: number;
};

export type NormalizedOffer = {
  id: string;
  provider: MarketplaceId | "local_seller" | "demo";
  providerLabel: string;
  productName: string;
  externalId: string;
  sellerName: string;
  price: number;
  oldPrice?: number;
  deliveryDays?: number;
  inStock: boolean;
  score: number;
  url?: string;
  barcode?: string;
  verified: boolean;
};

export type ProviderResult = {
  provider: MarketplaceId;
  label: string;
  status: "ok" | "not_configured" | "error";
  latencyMs: number;
  offers: NormalizedOffer[];
  error?: string;
};

export type MarketplaceAdapter = {
  status: () => MarketplaceStatus;
  search: (input: SearchInput) => Promise<NormalizedOffer[]>;
};
