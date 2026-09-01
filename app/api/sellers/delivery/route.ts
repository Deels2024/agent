import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveryConnections, sellerDeliveryProfiles, sellers } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { isDeliveryNetworkConfigured, supportedDeliveryNetwork } from "../../../../lib/delivery";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

async function ownedSeller(email: string) {
  const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, email)).limit(1);
  return seller ?? null;
}

function phoneValue(value: unknown) {
  const phone = cleanText(value, 24).replace(/[^\d+() -]/g, "");
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? phone : "";
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ profile: null, connections: [], network: supportedDeliveryNetwork, platformConfigured: isDeliveryNetworkConfigured() });
    const [profile, connections] = await Promise.all([
      getDb().select().from(sellerDeliveryProfiles).where(eq(sellerDeliveryProfiles.sellerId, seller.id)).limit(1),
      getDb().select({ id: deliveryConnections.id, provider: deliveryConnections.provider, accountLabel: deliveryConnections.accountLabel, status: deliveryConnections.status, lastCheckedAt: deliveryConnections.lastCheckedAt, updatedAt: deliveryConnections.updatedAt }).from(deliveryConnections).where(eq(deliveryConnections.sellerId, seller.id)).limit(10),
    ]);
    return Response.json({ profile: profile[0] ?? null, connections, network: supportedDeliveryNetwork, platformConfigured: isDeliveryNetworkConfigured() });
  } catch {
    return Response.json({ error: "Настройки доставки временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "seller-delivery-profile", 15, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const values = {
      contactName: cleanText(body.contactName, 120),
      phone: phoneValue(body.phone),
      countryCode: cleanText(body.countryCode, 2).toUpperCase() || "RU",
      postalCode: cleanText(body.postalCode, 16) || null,
      region: cleanText(body.region, 100) || null,
      city: cleanText(body.city, 100),
      addressLine: cleanText(body.addressLine, 240),
      comment: cleanText(body.comment, 300) || null,
      updatedAt: new Date().toISOString(),
    };
    if (!/^[A-Z]{2}$/.test(values.countryCode) || values.contactName.length < 2 || !values.phone || values.city.length < 2 || values.addressLine.length < 5) return Response.json({ error: "Проверьте контакт, телефон и адрес отгрузки" }, { status: 400 });
    const [existing] = await getDb().select().from(sellerDeliveryProfiles).where(eq(sellerDeliveryProfiles.sellerId, seller.id)).limit(1);
    const [profile] = existing
      ? await getDb().update(sellerDeliveryProfiles).set(values).where(eq(sellerDeliveryProfiles.sellerId, seller.id)).returning()
      : await getDb().insert(sellerDeliveryProfiles).values({ sellerId: seller.id, ...values }).returning();
    await writeAudit(request, { actorEmail: identity.email, action: "seller_delivery_profile.saved", entityType: "seller", entityId: seller.id });
    return Response.json({ profile }, { status: existing ? 200 : 201 });
  } catch {
    return Response.json({ error: "Не удалось сохранить адрес отгрузки" }, { status: 503 });
  }
}
