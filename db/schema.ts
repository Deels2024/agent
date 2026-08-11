import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const searches = sqliteTable("searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email"),
  query: text("query").notNull(),
  searchType: text("search_type").notNull().default("text"),
  recognizedName: text("recognized_name"),
  barcode: text("barcode"),
  providerCount: integer("provider_count").notNull().default(0),
  offerCount: integer("offer_count").notNull().default(0),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("searches_created_at_idx").on(table.createdAt),
  index("searches_user_created_idx").on(table.userEmail, table.createdAt),
]);

export const offers = sqliteTable("offers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerLabel: text("provider_label").notNull().default("Источник"),
  externalId: text("external_id").notNull(),
  sellerId: integer("seller_id"),
  inventoryItemId: integer("inventory_item_id"),
  productName: text("product_name").notNull(),
  sellerName: text("seller_name").notNull(),
  price: real("price").notNull(),
  deliveryPrice: real("delivery_price").notNull().default(0),
  oldPrice: real("old_price"),
  deliveryDays: integer("delivery_days"),
  inStock: integer("in_stock", { mode: "boolean" }).notNull().default(true),
  score: integer("score").notNull().default(0),
  matchConfidence: integer("match_confidence").notNull().default(0),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  url: text("url"),
  fetchedAt: text("fetched_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("offers_search_id_idx").on(table.searchId),
  index("offers_provider_external_idx").on(table.provider, table.externalId),
]);

export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  userEmail: text("user_email"),
  searchId: integer("search_id").references(() => searches.id, { onDelete: "set null" }),
  offerId: integer("offer_id").references(() => offers.id, { onDelete: "set null" }),
  sellerId: integer("seller_id").references(() => sellers.id, { onDelete: "set null" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  providerLabel: text("provider_label").notNull(),
  sellerName: text("seller_name").notNull(),
  productName: text("product_name").notNull(),
  itemAmount: real("item_amount").notNull(),
  deliveryAmount: real("delivery_amount").notNull().default(0),
  totalAmount: real("total_amount").notNull(),
  currency: text("currency").notNull().default("RUB"),
  sourceUrl: text("source_url"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("quotes_user_status_idx").on(table.userEmail, table.status),
  index("quotes_expires_idx").on(table.expiresAt),
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

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  role: text("role").notNull().default("buyer"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("users_role_status_idx").on(table.role, table.status)]);

export const authCredentials = sqliteTable("auth_credentials", {
  email: text("email").primaryKey(),
  displayName: text("display_name").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("auth_credentials_status_idx").on(table.status)]);

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userEmail: text("user_email").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  userAgentHash: text("user_agent_hash"),
}, (table) => [
  index("auth_sessions_user_idx").on(table.userEmail, table.createdAt),
  index("auth_sessions_expires_idx").on(table.expiresAt),
]);

export const legalAcceptances = sqliteTable("legal_acceptances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  documentSlug: text("document_slug").notNull(),
  documentVersion: text("document_version").notNull(),
  roleScope: text("role_scope").notNull().default("buyer"),
  status: text("status").notNull().default("accepted"),
  acceptedAt: text("accepted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: text("revoked_at"),
  ipHash: text("ip_hash"),
  userAgentHash: text("user_agent_hash"),
  evidenceJson: text("evidence_json").notNull().default("{}"),
}, (table) => [
  uniqueIndex("legal_acceptances_user_doc_version_scope_uidx").on(table.userEmail, table.documentSlug, table.documentVersion, table.roleScope),
  index("legal_acceptances_user_status_idx").on(table.userEmail, table.status),
]);

export const sellers = sqliteTable("sellers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  inn: text("inn"),
  status: text("status").notNull().default("draft"),
  kycStatus: text("kyc_status").notNull().default("not_started"),
  riskScore: integer("risk_score").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("sellers_owner_email_idx").on(table.ownerEmail),
  index("sellers_status_idx").on(table.status, table.kycStatus),
]);

export const sellerVerifications = sqliteTable("seller_verifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sellerId: integer("seller_id").notNull().references(() => sellers.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("manual"),
  externalId: text("external_id"),
  status: text("status").notNull().default("pending"),
  comment: text("comment"),
  checkedAt: text("checked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("seller_verifications_seller_idx").on(table.sellerId, table.status)]);

export const marketplaceConnections = sqliteTable("marketplace_connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sellerId: integer("seller_id").notNull().references(() => sellers.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  accountLabel: text("account_label").notNull(),
  secretCiphertext: text("secret_ciphertext"),
  secretIv: text("secret_iv"),
  status: text("status").notNull().default("pending"),
  lastSyncAt: text("last_sync_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("marketplace_connections_seller_idx").on(table.sellerId, table.provider)]);

export const inventoryItems = sqliteTable("inventory_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sellerId: integer("seller_id").notNull().references(() => sellers.id, { onDelete: "cascade" }),
  externalId: text("external_id"),
  productName: text("product_name").notNull(),
  barcode: text("barcode"),
  price: real("price").notNull(),
  stock: integer("stock").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("inventory_seller_status_idx").on(table.sellerId, table.status),
  index("inventory_barcode_idx").on(table.barcode),
]);

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  buyerEmail: text("buyer_email").notNull(),
  sellerId: integer("seller_id").references(() => sellers.id, { onDelete: "set null" }),
  quotePublicId: text("quote_public_id"),
  provider: text("provider").notNull().default("local_seller"),
  sellerName: text("seller_name"),
  productName: text("product_name").notNull(),
  itemAmount: real("item_amount").notNull().default(0),
  deliveryAmount: real("delivery_amount").notNull().default(0),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("RUB"),
  status: text("status").notNull().default("created"),
  paymentStatus: text("payment_status").notNull().default("not_started"),
  deliveryStatus: text("delivery_status").notNull().default("not_started"),
  protectionUntil: text("protection_until"),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  termsAcceptedAt: text("terms_accepted_at"),
  legalBundleVersion: text("legal_bundle_version"),
  transactionConfirmationVersion: text("transaction_confirmation_version"),
  saleContractParty: text("sale_contract_party").notNull().default("seller"),
  paymentModel: text("payment_model").notNull().default("seller_or_payment_partner"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("orders_buyer_created_idx").on(table.buyerEmail, table.createdAt),
  index("orders_seller_status_idx").on(table.sellerId, table.status),
]);

export const demandRequests = sqliteTable("demand_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicId: text("public_id").notNull().unique(),
  buyerEmail: text("buyer_email").notNull(),
  query: text("query").notNull(),
  barcode: text("barcode"),
  targetPrice: real("target_price"),
  city: text("city"),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("open"),
  expiresAt: text("expires_at").notNull(),
  acceptedProposalId: integer("accepted_proposal_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("demand_requests_buyer_idx").on(table.buyerEmail, table.createdAt),
  index("demand_requests_status_idx").on(table.status, table.expiresAt),
  index("demand_requests_barcode_idx").on(table.barcode),
]);

export const sellerProposals = sqliteTable("seller_proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id").notNull().references(() => demandRequests.id, { onDelete: "cascade" }),
  sellerId: integer("seller_id").notNull().references(() => sellers.id, { onDelete: "cascade" }),
  inventoryItemId: integer("inventory_item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
  price: real("price").notNull(),
  deliveryPrice: real("delivery_price").notNull().default(0),
  deliveryDays: integer("delivery_days").notNull().default(1),
  warrantyMonths: integer("warranty_months").notNull().default(12),
  comment: text("comment"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("seller_proposals_request_idx").on(table.requestId, table.status),
  index("seller_proposals_seller_idx").on(table.sellerId, table.createdAt),
  uniqueIndex("seller_proposals_request_seller_uidx").on(table.requestId, table.sellerId),
]);

export const webhookEvents = sqliteTable("webhook_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  eventKey: text("event_key").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("webhook_events_provider_key_uidx").on(table.provider, table.eventKey)]);

export const paymentIntents = sqliteTable("payment_intents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("created"),
  confirmationUrl: text("confirmation_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("payment_intents_order_idx").on(table.orderId, table.status)]);

export const deliveries = sqliteTable("deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id"),
  status: text("status").notNull().default("created"),
  eta: text("eta"),
  trackingUrl: text("tracking_url"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("deliveries_order_idx").on(table.orderId, table.status)]);

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  plan: text("plan").notNull().default("plus"),
  provider: text("provider").notNull().default("internal"),
  externalId: text("external_id"),
  status: text("status").notNull().default("trial"),
  currentPeriodEnd: text("current_period_end"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("subscriptions_user_status_idx").on(table.userEmail, table.status)]);

export const priceAlerts = sqliteTable("price_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userEmail: text("user_email").notNull(),
  query: text("query").notNull(),
  targetPrice: real("target_price").notNull(),
  currentPrice: real("current_price"),
  channel: text("channel").notNull().default("in_app"),
  status: text("status").notNull().default("active"),
  lastCheckedAt: text("last_checked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("price_alerts_user_status_idx").on(table.userEmail, table.status)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientEmail: text("recipient_email").notNull(),
  channel: text("channel").notNull().default("in_app"),
  template: text("template").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  status: text("status").notNull().default("queued"),
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("notifications_recipient_status_idx").on(table.recipientEmail, table.status)]);

export const disputes = sqliteTable("disputes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  openedByEmail: text("opened_by_email").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  resolution: text("resolution"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("disputes_order_status_idx").on(table.orderId, table.status)]);

export const riskEvents = sqliteTable("risk_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email"),
  eventType: text("event_type").notNull(),
  score: integer("score").notNull().default(0),
  status: text("status").notNull().default("open"),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("risk_events_status_score_idx").on(table.status, table.score)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  ipHash: text("ip_hash"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_logs_created_idx").on(table.createdAt)]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  count: integer("count").notNull().default(0),
  blockedUntil: integer("blocked_until"),
});
