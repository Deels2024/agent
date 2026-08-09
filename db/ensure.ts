import { runtimeEnv } from "../lib/runtime";

let initialized: Promise<void> | null = null;

export function ensureMarketplaceSchema() {
  if (initialized) return initialized;
  const runtime = runtimeEnv() as { DB?: D1Database };
  if (!runtime.DB) throw new Error("D1 binding DB is not configured");

  initialized = runtime.DB.batch([
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      search_type TEXT NOT NULL DEFAULT 'text',
      recognized_name TEXT,
      barcode TEXT,
      provider_count INTEGER NOT NULL DEFAULT 0,
      offer_count INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS searches_created_at_idx ON searches (created_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      price REAL NOT NULL,
      old_price REAL,
      delivery_days INTEGER,
      in_stock INTEGER NOT NULL DEFAULT 1,
      score INTEGER NOT NULL DEFAULT 0,
      url TEXT,
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS offers_search_id_idx ON offers (search_id)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS offers_provider_external_idx ON offers (provider, external_id)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS recognitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      barcode TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS marketplace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS marketplace_events_provider_idx ON marketplace_events (provider, created_at)"),
  ]).then(() => undefined).catch((error) => {
    initialized = null;
    throw error;
  });

  return initialized;
}
