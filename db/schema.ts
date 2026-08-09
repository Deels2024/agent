import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const searches = sqliteTable("searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  query: text("query").notNull(),
  searchType: text("search_type").notNull().default("text"),
  recognizedName: text("recognized_name"),
  barcode: text("barcode"),
  providerCount: integer("provider_count").notNull().default(0),
  offerCount: integer("offer_count").notNull().default(0),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("searches_created_at_idx").on(table.createdAt)]);

export const offers = sqliteTable("offers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  productName: text("product_name").notNull(),
  sellerName: text("seller_name").notNull(),
  price: real("price").notNull(),
  oldPrice: real("old_price"),
  deliveryDays: integer("delivery_days"),
  inStock: integer("in_stock", { mode: "boolean" }).notNull().default(true),
  score: integer("score").notNull().default(0),
  url: text("url"),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("offers_search_id_idx").on(table.searchId),
  index("offers_provider_external_idx").on(table.provider, table.externalId),
]);

export const recognitions = sqliteTable("recognitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productName: text("product_name").notNull(),
  brand: text("brand"),
  model: text("model"),
  barcode: text("barcode"),
  confidence: real("confidence").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const marketplaceEvents = sqliteTable("marketplace_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  message: text("message"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("marketplace_events_provider_idx").on(table.provider, table.createdAt)]);
