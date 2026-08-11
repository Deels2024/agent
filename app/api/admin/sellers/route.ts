import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { sellerVerifications, sellers } from "../../../../db/schema";
import { requireAdmin } from "../../../../lib/auth";
import { writeAudit } from "../../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const items = await getDb().select().from(sellers).orderBy(desc(sellers.createdAt)).limit(200);
    return Response.json({ sellers: items });
  } catch {
    return Response.json({ error: "Список продавцов недоступен" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "admin-seller-review", 60, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const sellerId = Number(body.sellerId);
    const status = cleanText(body.status, 30);
    const kycStatus = cleanText(body.kycStatus, 30);
    const comment = cleanText(body.comment, 500);
    const riskScore = Math.max(0, Math.min(100, Number(body.riskScore) || 0));
    if (!Number.isInteger(sellerId) || !["draft", "review", "active", "suspended", "rejected"].includes(status) || !["not_started", "pending", "verified", "rejected"].includes(kycStatus)) return Response.json({ error: "Некорректный статус проверки" }, { status: 400 });
    const now = new Date().toISOString();
    await getDb().update(sellers).set({ status, kycStatus, riskScore, updatedAt: now }).where(eq(sellers.id, sellerId));
    await getDb().insert(sellerVerifications).values({ sellerId, provider: "manual", status: kycStatus, comment: comment || null, checkedAt: now });
    await writeAudit(request, { actorEmail: identity.email, action: "seller.reviewed", entityType: "seller", entityId: sellerId, metadata: { status, kycStatus, riskScore } });
    const [seller] = await getDb().select().from(sellers).where(eq(sellers.id, sellerId)).limit(1);
    return Response.json({ seller });
  } catch {
    return Response.json({ error: "Не удалось сохранить решение" }, { status: 503 });
  }
}
