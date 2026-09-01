import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { buyerMarketplaceConnections, buyerMarketplaceItems } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

const OZON_ACCOUNT_URL = "https://www.ozon.ru/my/main";
const CONNECTION_CONSENT_VERSION = "ozon-external-login-v1";
const PROVIDER = "ozon";

function connectionPayload(connection: typeof buyerMarketplaceConnections.$inferSelect) {
  let scopes: string[] = [];
  try {
    const value = JSON.parse(connection.scopesJson) as unknown;
    if (Array.isArray(value)) scopes = value.filter((item): item is string => typeof item === "string");
  } catch {
    scopes = [];
  }
  return {
    id: connection.id,
    provider: connection.provider,
    accountLabel: connection.accountLabel,
    status: connection.status,
    authMethod: connection.authMethod,
    scopes,
    itemCount: connection.itemCount,
    consentedAt: connection.consentedAt,
    lastSyncAt: connection.lastSyncAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

async function shortHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function parseOzonProductLink(rawValue: unknown) {
  const raw = cleanText(rawValue, 1600);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (hostname !== "ozon.ru" && !hostname.endsWith(".ozon.ru"))) return null;
  if (!url.pathname.startsWith("/product/") && !url.pathname.startsWith("/t/")) return null;
  url.hostname = "www.ozon.ru";
  url.hash = "";
  url.search = "";
  const canonicalUrl = url.toString();
  const productSegment = url.pathname.split("/").filter(Boolean).at(1) ?? "";
  const skuMatch = productSegment.match(/-(\d{5,})$/) ?? url.pathname.match(/\/(\d{5,})(?:\/|$)/);
  const externalId = skuMatch?.[1] ?? `link-${await shortHash(canonicalUrl)}`;
  const nameWithoutSku = skuMatch ? productSegment.replace(/-\d{5,}$/, "") : "";
  let productName = "Товар из Ozon";
  if (nameWithoutSku) {
    try {
      const decoded = decodeURIComponent(nameWithoutSku).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      if (decoded) productName = `${decoded.charAt(0).toLocaleUpperCase("ru-RU")}${decoded.slice(1)}`.slice(0, 240);
    } catch {
      productName = "Товар из Ozon";
    }
  }
  return { canonicalUrl, externalId, productName };
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const connections = await getDb().select().from(buyerMarketplaceConnections).where(eq(buyerMarketplaceConnections.userEmail, identity.email)).orderBy(desc(buyerMarketplaceConnections.updatedAt));
    const items = await getDb().select().from(buyerMarketplaceItems).where(and(eq(buyerMarketplaceItems.userEmail, identity.email), eq(buyerMarketplaceItems.status, "active"))).orderBy(desc(buyerMarketplaceItems.updatedAt)).limit(100);
    return Response.json({
      connections: connections.map(connectionPayload),
      items,
      capabilities: { externalLogin: true, linkImport: true, automaticAccountSync: false, credentialsStored: false },
      authorizationUrl: OZON_ACCOUNT_URL,
    });
  } catch {
    return Response.json({ error: "Подключения покупателя временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "buyer-marketplace", 20, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много действий. Попробуйте позже", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const action = cleanText(body.action, 40);

    if (action === "start") {
      if (body.termsAccepted !== true) return Response.json({ error: "Подтвердите безопасные условия подключения" }, { status: 400 });
      const now = new Date().toISOString();
      const [connection] = await getDb().insert(buyerMarketplaceConnections).values({
        userEmail: identity.email, provider: PROVIDER, accountLabel: "Ozon", status: "login_opened", authMethod: "external_login",
        scopesJson: JSON.stringify(["shared_product_links"]), consentVersion: CONNECTION_CONSENT_VERSION, consentedAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [buyerMarketplaceConnections.userEmail, buyerMarketplaceConnections.provider],
        set: { status: "login_opened", authMethod: "external_login", scopesJson: JSON.stringify(["shared_product_links"]), consentVersion: CONNECTION_CONSENT_VERSION, consentedAt: now, updatedAt: now },
      }).returning();
      await writeAudit(request, { actorEmail: identity.email, action: "buyer_marketplace.login_opened", entityType: "buyer_marketplace_connection", entityId: connection.id, metadata: { provider: PROVIDER, credentialsStored: false } });
      return Response.json({ connection: connectionPayload(connection), authorizationUrl: OZON_ACCOUNT_URL, automaticAccountSync: false, message: "Ozon открыт на официальной странице. Пароль, SMS-код и cookies сервису не передаются." });
    }

    if (action === "import_link") {
      const product = await parseOzonProductLink(body.url);
      if (!product) return Response.json({ error: "Вставьте ссылку на товар Ozon вида ozon.ru/product/… или ozon.ru/t/…" }, { status: 400 });
      const now = new Date().toISOString();
      const [connection] = await getDb().insert(buyerMarketplaceConnections).values({
        userEmail: identity.email, provider: PROVIDER, accountLabel: "Ozon", status: "link_import_ready", authMethod: "external_login",
        scopesJson: JSON.stringify(["shared_product_links"]), updatedAt: now,
      }).onConflictDoUpdate({
        target: [buyerMarketplaceConnections.userEmail, buyerMarketplaceConnections.provider],
        set: { status: "link_import_ready", updatedAt: now, lastSyncAt: now },
      }).returning();
      const [item] = await getDb().insert(buyerMarketplaceItems).values({
        connectionId: connection.id, userEmail: identity.email, provider: PROVIDER, sourceList: "shared_link", externalId: product.externalId,
        productName: product.productName, productUrl: product.canonicalUrl, updatedAt: now,
      }).onConflictDoUpdate({
        target: [buyerMarketplaceItems.connectionId, buyerMarketplaceItems.externalId, buyerMarketplaceItems.sourceList],
        set: { productName: product.productName, productUrl: product.canonicalUrl, status: "active", updatedAt: now },
      }).returning();
      const [total] = await getDb().select({ value: sql<number>`count(*)` }).from(buyerMarketplaceItems).where(and(eq(buyerMarketplaceItems.connectionId, connection.id), eq(buyerMarketplaceItems.status, "active")));
      await getDb().update(buyerMarketplaceConnections).set({ itemCount: Number(total?.value ?? 0), lastSyncAt: now, updatedAt: now }).where(eq(buyerMarketplaceConnections.id, connection.id));
      await writeAudit(request, { actorEmail: identity.email, action: "buyer_marketplace.product_imported", entityType: "buyer_marketplace_item", entityId: item.id, metadata: { provider: PROVIDER, externalId: product.externalId } });
      return Response.json({ item, itemCount: Number(total?.value ?? 0), message: "Товар добавлен. Теперь агент может сравнить его с другими предложениями." }, { status: 201 });
    }
    return Response.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch {
    return Response.json({ error: "Не удалось обновить подключение Ozon" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const [connection] = await getDb().select({ id: buyerMarketplaceConnections.id }).from(buyerMarketplaceConnections).where(and(eq(buyerMarketplaceConnections.userEmail, identity.email), eq(buyerMarketplaceConnections.provider, PROVIDER))).limit(1);
    if (!connection) return Response.json({ ok: true });
    await getDb().delete(buyerMarketplaceItems).where(and(eq(buyerMarketplaceItems.connectionId, connection.id), eq(buyerMarketplaceItems.userEmail, identity.email)));
    await getDb().delete(buyerMarketplaceConnections).where(and(eq(buyerMarketplaceConnections.id, connection.id), eq(buyerMarketplaceConnections.userEmail, identity.email)));
    await writeAudit(request, { actorEmail: identity.email, action: "buyer_marketplace.disconnected", entityType: "buyer_marketplace_connection", entityId: connection.id, metadata: { provider: PROVIDER } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось отключить Ozon" }, { status: 503 });
  }
}
