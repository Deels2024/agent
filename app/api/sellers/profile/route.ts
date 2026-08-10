import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { sellerVerifications, sellers, users } from "../../../../db/schema";
import { requireActiveRequestIdentity } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../../lib/security";
import { getLegalStatus, recordLegalAcceptances, type SubmittedAcceptance } from "../../../../lib/legal";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rows = await getDb().select().from(sellers).where(eq(sellers.ownerEmail, identity.email)).limit(1);
    return Response.json({ seller: rows[0] ?? null });
  } catch {
    return Response.json({ error: "Кабинет продавца временно недоступен" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const limit = await enforceRateLimit(request, "seller-profile", 8, 300);
    if (!limit.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: limit.retryAfter }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
    const body = await request.json() as { name?: unknown; inn?: unknown; sellerAcceptances?: SubmittedAcceptance[] };
    const name = cleanText(body.name, 120);
    const inn = cleanText(body.inn, 12).replace(/\D/g, "");
    if (name.length < 2) return Response.json({ error: "Укажите название магазина" }, { status: 400 });
    if (inn && ![10, 12].includes(inn.length)) return Response.json({ error: "ИНН должен содержать 10 или 12 цифр" }, { status: 400 });
    const currentLegal = await getLegalStatus(identity.email, "seller");
    if (!currentLegal.complete) {
      const recorded = await recordLegalAcceptances(request, { userEmail: identity.email, scope: "seller", submitted: Array.isArray(body.sellerAcceptances) ? body.sellerAcceptances : [], source: "seller_onboarding" });
      if (!recorded.ok) return Response.json({ error: "Отдельно примите договор продавца, стандарты и правила безопасной сделки", code: "seller_legal_acceptance_required", legal: currentLegal }, { status: 428 });
    }
    const db = getDb();
    const [existing] = await db.select().from(sellers).where(eq(sellers.ownerEmail, identity.email)).limit(1);
    let sellerId: number;
    if (existing) {
      sellerId = existing.id;
      await db.update(sellers).set({ name, inn: inn || null, updatedAt: new Date().toISOString() }).where(eq(sellers.id, sellerId));
    } else {
      const [created] = await db.insert(sellers).values({ ownerEmail: identity.email, name, inn: inn || null }).returning({ id: sellers.id });
      sellerId = created.id;
      await db.insert(sellerVerifications).values({ sellerId, status: "pending", comment: "Ожидает первичной проверки" });
    }
    await db.update(users).set({ role: "seller", updatedAt: new Date().toISOString() }).where(eq(users.email, identity.email));
    await writeAudit(request, { actorEmail: identity.email, action: existing ? "seller.updated" : "seller.created", entityType: "seller", entityId: sellerId, metadata: { sellerLegalAccepted: true } });
    const [seller] = await db.select().from(sellers).where(eq(sellers.id, sellerId)).limit(1);
    return Response.json({ seller }, { status: existing ? 200 : 201 });
  } catch {
    return Response.json({ error: "Не удалось сохранить магазин" }, { status: 503 });
  }
}
