export type MarketplaceId = "wildberries" | "ozon" | "yandex_market" | "local_seller";
export type SearchMode = "text" | "barcode" | "photo" | "url";

export type MarketplaceStatus = {
  provider: MarketplaceId;
  label: string;
  configured: boolean;
  mode: "seller-api" | "local-catalog";
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
  provider: MarketplaceId | "demo";
  providerLabel: string;
  productName: string;
  externalId: string;
  sellerName: string;
  price: number;
  oldPrice?: number;
  deliveryDays?: number;
  deliveryPrice?: number;
  inStock: boolean;
  score: number;
  matchConfidence?: number;
  sellerId?: number;
  inventoryItemId?: number;
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
