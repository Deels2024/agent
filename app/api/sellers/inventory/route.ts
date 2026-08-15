import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { inventoryItems, sellers } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

async function ownedSeller(email: string) {
  const [seller] = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, email)).limit(1);
  return seller ?? null;
}

function parseInventoryItem(raw: unknown, row: number) {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const productName = cleanText(value.productName, 240);
  const barcode = cleanText(value.barcode, 32).replace(/\D/g, "");
  const externalId = cleanText(value.externalId, 100);
  const price = Number(value.price);
  const stockValue = Number(value.stock);
  const stock = Math.floor(stockValue);
  const problems = [
    productName.length < 3 ? "название должно содержать минимум 3 символа" : "",
    !Number.isFinite(price) || price <= 0 || price > 10_000_000 ? "цена должна быть от 1 до 10 000 000 ₽" : "",
    !Number.isFinite(stockValue) || !Number.isInteger(stockValue) || stock < 0 || stock > 1_000_000 ? "остаток должен быть целым числом от 0 до 1 000 000" : "",
    barcode && (barcode.length < 8 || barcode.length > 14) ? "штрих-код должен содержать 8–14 цифр" : "",
  ].filter(Boolean);
  if (problems.length) return { error: "Строка " + row + ": " + problems.join(", ") };
  return {
    item: {
      productName,
      barcode: barcode || null,
      externalId: externalId || null,
      price: Math.round(price * 100) / 100,
      stock,
    },
  };
}

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const items = await getDb().select().from(inventoryItems).where(and(eq(inventoryItems.sellerId, seller.id), ne(inventoryItems.status, "archived"))).orderBy(desc(inventoryItems.updatedAt)).limit(500);
    return Response.json({ seller: { id: seller.id, name: seller.name, status: seller.status }, items });
  } catch {
    return Response.json({ error: "Ассортимент временно недоступен" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "inventory-write", 60, 300);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (!rawItems.length || rawItems.length > 100) {
      return Response.json({ error: "За один раз можно добавить от 1 до 100 товаров" }, { status: 400 });
    }
    const parsed = rawItems.map((raw, index) => parseInventoryItem(raw, index + 1));
    const errors = parsed.flatMap((entry) => entry.error ? [entry.error] : []);
    if (errors.length) return Response.json({ error: errors.slice(0, 5).join("; "), errors }, { status: 400 });
    const values = parsed.map((entry) => ({ sellerId: seller.id, ...entry.item! }));
    const created = await getDb().insert(inventoryItems).values(values).returning();
    await writeAudit(request, { actorEmail: identity.email, action: "inventory.created", entityType: "inventory_item", entityId: created[0]?.id, metadata: { sellerId: seller.id, count: created.length } });
    return Response.json({ item: created[0], items: created, createdCount: created.length }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось добавить товар" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "inventory-write", 60, 300);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Товар не найден" }, { status: 400 });
    const [existing] = await getDb().select().from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.sellerId, seller.id))).limit(1);
    if (!existing) return Response.json({ error: "Товар не найден" }, { status: 404 });

    const updates: { price?: number; stock?: number; status?: string; updatedAt: string } = { updatedAt: new Date().toISOString() };
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return Response.json({ error: "Цена должна быть от 1 до 10 000 000 ₽" }, { status: 400 });
      updates.price = Math.round(price * 100) / 100;
    }
    if (body.stock !== undefined) {
      const stock = Number(body.stock);
      if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) return Response.json({ error: "Остаток должен быть целым числом от 0 до 1 000 000" }, { status: 400 });
      updates.stock = stock;
    }
    if (body.status !== undefined) {
      const status = cleanText(body.status, 20);
      if (!["active", "paused"].includes(status)) return Response.json({ error: "Недопустимый статус товара" }, { status: 400 });
      updates.status = status;
    }
    if (Object.keys(updates).length === 1) return Response.json({ error: "Нет изменений для сохранения" }, { status: 400 });

    const [item] = await getDb().update(inventoryItems).set(updates).where(and(eq(inventoryItems.id, id), eq(inventoryItems.sellerId, seller.id))).returning();
    await writeAudit(request, { actorEmail: identity.email, action: "inventory.updated", entityType: "inventory_item", entityId: id, metadata: { sellerId: seller.id, fields: Object.keys(updates).filter((field) => field !== "updatedAt") } });
    return Response.json({ item });
  } catch {
    return Response.json({ error: "Не удалось обновить товар" }, { status: 503 });
  }
}
