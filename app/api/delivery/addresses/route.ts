import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { deliveryAddresses } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

function phoneValue(value: unknown) {
  const phone = cleanText(value, 24).replace(/[^\d+() -]/g, "");
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? phone : "";
}

function addressValues(body: Record<string, unknown>) {
  const countryCode = cleanText(body.countryCode, 2).toUpperCase() || "RU";
  return {
    label: cleanText(body.label, 60) || "Основной адрес",
    recipientName: cleanText(body.recipientName, 120),
    phone: phoneValue(body.phone),
    countryCode,
    postalCode: cleanText(body.postalCode, 16) || null,
    region: cleanText(body.region, 100) || null,
    city: cleanText(body.city, 100),
    addressLine: cleanText(body.addressLine, 240),
    apartment: cleanText(body.apartment, 30) || null,
    entrance: cleanText(body.entrance, 30) || null,
    floor: cleanText(body.floor, 20) || null,
    comment: cleanText(body.comment, 300) || null,
    isDefault: body.isDefault !== false,
  };
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const addresses = await getDb().select().from(deliveryAddresses).where(eq(deliveryAddresses.userEmail, identity.email)).orderBy(desc(deliveryAddresses.isDefault), desc(deliveryAddresses.updatedAt)).limit(20);
    return Response.json({ addresses });
  } catch {
    return Response.json({ error: "Адреса временно недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "delivery-address", 20, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const values = addressValues(body);
    if (!/^[A-Z]{2}$/.test(values.countryCode) || values.recipientName.length < 2 || !values.phone || values.city.length < 2 || values.addressLine.length < 5) return Response.json({ error: "Проверьте имя, телефон, город и адрес" }, { status: 400 });
    const id = Number(body.id);
    const db = getDb();
    if (Number.isInteger(id) && id > 0) {
      const [owned] = await db.select({ id: deliveryAddresses.id }).from(deliveryAddresses).where(and(eq(deliveryAddresses.id, id), eq(deliveryAddresses.userEmail, identity.email))).limit(1);
      if (!owned) return Response.json({ error: "Адрес не найден" }, { status: 404 });
    }
    if (values.isDefault) await db.update(deliveryAddresses).set({ isDefault: false, updatedAt: new Date().toISOString() }).where(eq(deliveryAddresses.userEmail, identity.email));
    let address;
    if (Number.isInteger(id) && id > 0) {
      [address] = await db.update(deliveryAddresses).set({ ...values, updatedAt: new Date().toISOString() }).where(and(eq(deliveryAddresses.id, id), eq(deliveryAddresses.userEmail, identity.email))).returning();
    } else {
      [address] = await db.insert(deliveryAddresses).values({ userEmail: identity.email, ...values }).returning();
    }
    await writeAudit(request, { actorEmail: identity.email, action: id ? "delivery_address.updated" : "delivery_address.created", entityType: "delivery_address", entityId: address.id });
    return Response.json({ address }, { status: id ? 200 : 201 });
  } catch {
    return Response.json({ error: "Не удалось сохранить адрес" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Адрес не найден" }, { status: 400 });
    const [removed] = await getDb().delete(deliveryAddresses).where(and(eq(deliveryAddresses.id, id), eq(deliveryAddresses.userEmail, identity.email))).returning({ id: deliveryAddresses.id });
    if (!removed) return Response.json({ error: "Адрес не найден" }, { status: 404 });
    await writeAudit(request, { actorEmail: identity.email, action: "delivery_address.deleted", entityType: "delivery_address", entityId: id });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось удалить адрес" }, { status: 503 });
  }
}
