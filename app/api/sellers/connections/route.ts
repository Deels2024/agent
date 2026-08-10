import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { marketplaceConnections, sellers } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, encryptCredentials, enforceRateLimit } from "../../../../lib/security";

const allowedProviders = new Set(["wildberries", "ozon", "yandex_market", "custom_feed"]);

async function ownedSeller(email: string) {
  const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, email)).limit(1);
  return seller ?? null;
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ connections: [] });
    const connections = await getDb().select({ id: marketplaceConnections.id, provider: marketplaceConnections.provider, accountLabel: marketplaceConnections.accountLabel, status: marketplaceConnections.status, lastSyncAt: marketplaceConnections.lastSyncAt, createdAt: marketplaceConnections.createdAt }).from(marketplaceConnections).where(eq(marketplaceConnections.sellerId, seller.id)).orderBy(desc(marketplaceConnections.createdAt));
    return Response.json({ connections });
  } catch {
    return Response.json({ error: "Подключения временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "seller-connection", 10, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток подключения", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const body = await request.json() as { provider?: unknown; accountLabel?: unknown; credentials?: unknown };
    const provider = cleanText(body.provider, 40);
    const accountLabel = cleanText(body.accountLabel, 100);
    if (!allowedProviders.has(provider) || accountLabel.length < 2 || !body.credentials || typeof body.credentials !== "object" || Array.isArray(body.credentials)) {
      return Response.json({ error: "Проверьте площадку, название кабинета и ключи" }, { status: 400 });
    }
    const credentials = Object.fromEntries(Object.entries(body.credentials as Record<string, unknown>).filter(([, value]) => typeof value === "string" && value.trim()).slice(0, 10).map(([key, value]) => [cleanText(key, 50), cleanText(value, 4000)]));
    if (!Object.keys(credentials).length) return Response.json({ error: "Не переданы ключи подключения" }, { status: 400 });
    const encrypted = await encryptCredentials(credentials);
    const [connection] = await getDb().insert(marketplaceConnections).values({ sellerId: seller.id, provider, accountLabel, secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, status: "encrypted" }).returning({ id: marketplaceConnections.id, provider: marketplaceConnections.provider, accountLabel: marketplaceConnections.accountLabel, status: marketplaceConnections.status, createdAt: marketplaceConnections.createdAt });
    await writeAudit(request, { actorEmail: identity.email, action: "marketplace_connection.created", entityType: "marketplace_connection", entityId: connection.id, metadata: { provider, sellerId: seller.id } });
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("credential_encryption")) return Response.json({ error: "На сервере ещё не настроено шифрование ключей", code: error.message }, { status: 503 });
    return Response.json({ error: "Не удалось сохранить подключение" }, { status: 503 });
  }
}
