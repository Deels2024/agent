import { runtimeEnv } from "../runtime";
import { matchConfidence, matchesOffer } from "./common";
import type { MarketplaceAdapter, MarketplaceStatus, NormalizedOffer, SearchInput } from "./types";

type LocalRow = {
  item_id: number;
  seller_id: number;
  product_name: string;
  barcode: string | null;
  price: number;
  stock: number;
  seller_name: string;
};

function status(): MarketplaceStatus {
  const configured = Boolean((runtimeEnv() as { DB?: D1Database }).DB);
  return {
    provider: "local_seller",
    label: "Малые магазины",
    configured,
    mode: "local-catalog",
    missing: configured ? [] : ["DB"],
    coverage: "Проверенные товары и остатки подключённых малых магазинов",
  };
}

async function search(input: SearchInput): Promise<NormalizedOffer[]> {
  const db = (runtimeEnv() as { DB?: D1Database }).DB;
  if (!db) return [];
  const rows = await db.prepare(`SELECT i.id AS item_id, i.seller_id, i.product_name, i.barcode, i.price, i.stock, s.name AS seller_name
    FROM inventory_items i
    INNER JOIN sellers s ON s.id = i.seller_id
    WHERE i.status = 'active' AND i.stock > 0 AND s.status = 'active' AND s.kyc_status = 'verified'
    ORDER BY i.updated_at DESC LIMIT 500`).all<LocalRow>();

  return rows.results
    .filter((row) => matchesOffer(input, [row.product_name, row.barcode]))
    .map((row): NormalizedOffer => {
      const base: NormalizedOffer = {
        id: `local_seller:${row.item_id}`,
        provider: "local_seller",
        providerLabel: "Малый магазин",
        productName: row.product_name,
        externalId: String(row.item_id),
        sellerName: row.seller_name,
        sellerId: row.seller_id,
        inventoryItemId: row.item_id,
        price: Number(row.price),
        deliveryPrice: 0,
        deliveryDays: 1,
        inStock: row.stock > 0,
        score: 0,
        barcode: row.barcode ?? undefined,
        verified: true,
      };
      return { ...base, matchConfidence: matchConfidence(input, base) };
    })
    .slice(0, input.limit * 2);
}

export const localSellersAdapter: MarketplaceAdapter = { status, search };
