import { runtimeEnv } from "../lib/runtime";

let initialized: Promise<void> | null = null;

export function ensureMarketplaceSchema() {
  if (initialized) return initialized;
  const runtime = runtimeEnv() as { DB?: D1Database };
  if (!runtime.DB) throw new Error("D1 binding DB is not configured");

  initialized = (async () => {
    await runtime.DB.batch([
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT,
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
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS searches_user_created_idx ON searches (user_email, created_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_label TEXT NOT NULL DEFAULT 'Источник',
      external_id TEXT NOT NULL,
      seller_id INTEGER,
      inventory_item_id INTEGER,
      product_name TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      price REAL NOT NULL,
      delivery_price REAL NOT NULL DEFAULT 0,
      old_price REAL,
      delivery_days INTEGER,
      in_stock INTEGER NOT NULL DEFAULT 1,
      score INTEGER NOT NULL DEFAULT 0,
      match_confidence INTEGER NOT NULL DEFAULT 0,
      verified INTEGER NOT NULL DEFAULT 0,
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
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'buyer',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS users_role_status_idx ON users (role, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_credentials (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      email_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS auth_credentials_status_idx ON auth_credentials (status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      user_agent_hash TEXT
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_email, created_at)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens (user_email, purpose, created_at)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS auth_tokens_expires_idx ON auth_tokens (expires_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS legal_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      document_slug TEXT NOT NULL,
      document_version TEXT NOT NULL,
      role_scope TEXT NOT NULL DEFAULT 'buyer',
      status TEXT NOT NULL DEFAULT 'accepted',
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      ip_hash TEXT,
      user_agent_hash TEXT,
      evidence_json TEXT NOT NULL DEFAULT '{}'
    )`),
    runtime.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS legal_acceptances_user_doc_version_scope_uidx ON legal_acceptances (user_email, document_slug, document_version, role_scope)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS legal_acceptances_user_status_idx ON legal_acceptances (user_email, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_email TEXT NOT NULL,
      name TEXT NOT NULL,
      inn TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      kyc_status TEXT NOT NULL DEFAULT 'not_started',
      risk_score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS sellers_owner_email_idx ON sellers (owner_email)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS sellers_status_idx ON sellers (status, kyc_status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS seller_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'manual',
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      comment TEXT,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS seller_verifications_seller_idx ON seller_verifications (seller_id, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS marketplace_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      account_label TEXT NOT NULL,
      secret_ciphertext TEXT,
      secret_iv TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS marketplace_connections_seller_idx ON marketplace_connections (seller_id, provider)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      external_id TEXT,
      product_name TEXT NOT NULL,
      barcode TEXT,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS inventory_seller_status_idx ON inventory_items (seller_id, status)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS inventory_barcode_idx ON inventory_items (barcode)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      user_email TEXT,
      search_id INTEGER REFERENCES searches(id) ON DELETE SET NULL,
      offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
      seller_id INTEGER REFERENCES sellers(id) ON DELETE SET NULL,
      inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      provider_label TEXT NOT NULL,
      seller_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      item_amount REAL NOT NULL,
      delivery_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      source_url TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS quotes_user_status_idx ON quotes (user_email, status)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS quotes_expires_idx ON quotes (expires_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      buyer_email TEXT NOT NULL,
      seller_id INTEGER REFERENCES sellers(id) ON DELETE SET NULL,
      quote_public_id TEXT,
      provider TEXT NOT NULL DEFAULT 'local_seller',
      seller_name TEXT,
      product_name TEXT NOT NULL,
      item_amount REAL NOT NULL DEFAULT 0,
      delivery_amount REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'RUB',
      status TEXT NOT NULL DEFAULT 'created',
      payment_status TEXT NOT NULL DEFAULT 'not_started',
      delivery_status TEXT NOT NULL DEFAULT 'not_started',
      protection_until TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      terms_accepted_at TEXT,
      legal_bundle_version TEXT,
      transaction_confirmation_version TEXT,
      sale_contract_party TEXT NOT NULL DEFAULT 'seller',
      payment_model TEXT NOT NULL DEFAULT 'seller_or_payment_partner',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS orders_buyer_created_idx ON orders (buyer_email, created_at)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS orders_seller_status_idx ON orders (seller_id, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS demand_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      buyer_email TEXT NOT NULL,
      query TEXT NOT NULL,
      barcode TEXT,
      target_price REAL,
      city TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'open',
      expires_at TEXT NOT NULL,
      accepted_proposal_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS demand_requests_buyer_idx ON demand_requests (buyer_email, created_at)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS demand_requests_status_idx ON demand_requests (status, expires_at)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS demand_requests_barcode_idx ON demand_requests (barcode)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS seller_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES demand_requests(id) ON DELETE CASCADE,
      seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
      price REAL NOT NULL,
      delivery_price REAL NOT NULL DEFAULT 0,
      delivery_days INTEGER NOT NULL DEFAULT 1,
      warranty_months INTEGER NOT NULL DEFAULT 12,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS seller_proposals_request_idx ON seller_proposals (request_id, status)"),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS seller_proposals_seller_idx ON seller_proposals (seller_id, created_at)"),
    runtime.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS seller_proposals_request_seller_uidx ON seller_proposals (request_id, seller_id)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS payment_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      confirmation_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS payment_intents_order_idx ON payment_intents (order_id, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      eta TEXT,
      tracking_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS deliveries_order_idx ON deliveries (order_id, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'plus',
      provider TEXT NOT NULL DEFAULT 'internal',
      external_id TEXT,
      status TEXT NOT NULL DEFAULT 'trial',
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx ON subscriptions (user_email, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS price_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      query TEXT NOT NULL,
      target_price REAL NOT NULL,
      current_price REAL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      status TEXT NOT NULL DEFAULT 'active',
      last_checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS price_alerts_user_status_idx ON price_alerts (user_email, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_email TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      template TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      scheduled_at TEXT,
      sent_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS notifications_recipient_status_idx ON notifications (recipient_email, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      opened_by_email TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS disputes_order_status_idx ON disputes (order_id, status)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS risk_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_email TEXT,
      event_type TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS risk_events_status_score_idx ON risk_events (status, score)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      ip_hash TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at)"),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER
    )`),
    runtime.DB.prepare(`CREATE TABLE IF NOT EXISTS webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      event_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    runtime.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_provider_key_uidx ON webhook_events (provider, event_key)"),
    ]);
    const verificationColumnAdded = await ensureColumn(runtime.DB, "auth_credentials", "email_verified_at", "TEXT");
    if (verificationColumnAdded) await runtime.DB.prepare("UPDATE auth_credentials SET email_verified_at = COALESCE(email_verified_at, updated_at)").run();
    await ensureColumn(runtime.DB, "notifications", "read_at", "TEXT");
  })().catch((error) => {
    initialized = null;
    throw error;
  });

  return initialized;
}

async function ensureColumn(database: D1Database, table: string, column: string, definition: string) {
  const info = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  if (!info.results.some((item) => item.name === column)) {
    await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    return true;
  }
  return false;
}
