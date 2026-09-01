import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { ensureMarketplaceSchema } from "../../../../../db/ensure";
import { deliveryConnections, sellers } from "../../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../../lib/auth";
import { writeAudit } from "../../../../../lib/audit";
import { cleanText, encryptCredentials, enforceRateLimit } from "../../../../../lib/security";

async function ownedSeller(email: string) {
  const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, email)).limit(1);
  return seller ?? null;
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "seller-delivery-connection", 8, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток подключения", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const provider = cleanText(body.provider, 30);
    const accountLabel = cleanText(body.accountLabel, 100);
    const apiToken = cleanText(body.apiToken, 4000);
    if (provider !== "apiship" || accountLabel.length < 2 || apiToken.length < 12) return Response.json({ error: "Проверьте название подключения и API-токен ApiShip" }, { status: 400 });
    const encrypted = await encryptCredentials({ apiToken });
    const [existing] = await getDb().select().from(deliveryConnections).where(and(eq(deliveryConnections.sellerId, seller.id), eq(deliveryConnections.provider, provider))).limit(1);
    const values = { accountLabel, secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, status: "encrypted", lastCheckedAt: null, updatedAt: new Date().toISOString() };
    const [connection] = existing
      ? await getDb().update(deliveryConnections).set(values).where(eq(deliveryConnections.id, existing.id)).returning({ id: deliveryConnections.id, provider: deliveryConnections.provider, accountLabel: deliveryConnections.accountLabel, status: deliveryConnections.status })
      : await getDb().insert(deliveryConnections).values({ sellerId: seller.id, provider, ...values }).returning({ id: deliveryConnections.id, provider: deliveryConnections.provider, accountLabel: deliveryConnections.accountLabel, status: deliveryConnections.status });
    await writeAudit(request, { actorEmail: identity.email, action: existing ? "delivery_connection.rotated" : "delivery_connection.created", entityType: "delivery_connection", entityId: connection.id, metadata: { sellerId: seller.id, provider } });
    return Response.json({ connection, message: "Ключ зашифрован. Подключение проверится при первом расчёте." }, { status: existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("credential_encryption")) return Response.json({ error: "На сервере ещё не настроено шифрование ключей", code: error.message }, { status: 503 });
    return Response.json({ error: "Не удалось сохранить подключение доставки" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!seller || !Number.isInteger(id)) return Response.json({ error: "Подключение не найдено" }, { status: 404 });
    const [removed] = await getDb().delete(deliveryConnections).where(and(eq(deliveryConnections.id, id), eq(deliveryConnections.sellerId, seller.id))).returning({ id: deliveryConnections.id });
    if (!removed) return Response.json({ error: "Подключение не найдено" }, { status: 404 });
    await writeAudit(request, { actorEmail: identity.email, action: "delivery_connection.deleted", entityType: "delivery_connection", entityId: id, metadata: { sellerId: seller.id } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось отключить доставку" }, { status: 503 });
  }
}
