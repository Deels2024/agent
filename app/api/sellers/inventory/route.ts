import { and, desc, eq } from "drizzle-orm";
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

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request, "seller");
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const seller = await ownedSeller(identity.email);
    if (!seller) return Response.json({ error: "Сначала создайте профиль магазина" }, { status: 404 });
    const items = await getDb().select().from(inventoryItems).where(and(eq(inventoryItems.sellerId, seller.id), eq(inventoryItems.status, "active"))).orderBy(desc(inventoryItems.updatedAt)).limit(200);
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
    const productName = cleanText(body.productName, 240);
    const barcode = cleanText(body.barcode, 32).replace(/\D/g, "");
    const externalId = cleanText(body.externalId, 100);
    const price = Number(body.price);
    const stock = Math.floor(Number(body.stock));
    if (productName.length < 3 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0) {
      return Response.json({ error: "Проверьте название, цену и остаток" }, { status: 400 });
    }
    const [item] = await getDb().insert(inventoryItems).values({ sellerId: seller.id, productName, barcode: barcode || null, externalId: externalId || null, price: Math.round(price * 100) / 100, stock }).returning();
    await writeAudit(request, { actorEmail: identity.email, action: "inventory.created", entityType: "inventory_item", entityId: item.id, metadata: { sellerId: seller.id } });
    return Response.json({ item }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось добавить товар" }, { status: 503 });
  }
}
