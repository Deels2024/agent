import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { productFeedback, searches } from "../../../db/schema";
import { requestIdentity } from "../../../lib/auth";
import { cleanText, enforceRateLimit } from "../../../lib/security";

const allowedReasons = new Set(["good_price", "clear_comparison", "trusted_seller", "wrong_product", "few_offers", "price_unclear", "other"]);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "Некорректный JSON" }, { status: 400 }); }

  const searchId = Number(body.searchId);
  const sentiment = cleanText(body.sentiment, 20);
  const reason = cleanText(body.reason, 40);
  if (!Number.isInteger(searchId) || searchId <= 0 || !["helpful", "not_helpful"].includes(sentiment) || (reason && !allowedReasons.has(reason))) {
    return Response.json({ error: "Проверьте оценку поиска" }, { status: 400 });
  }

  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "search-feedback", 12, 3600);
    if (!rate.allowed) return Response.json({ error: "Спасибо, отзыв уже учтён" }, { status: 429 });
    const identity = await requestIdentity(request);
    const [search] = await getDb().select({ id: searches.id, userEmail: searches.userEmail }).from(searches).where(eq(searches.id, searchId)).limit(1);
    if (!search || (search.userEmail && search.userEmail !== identity?.email)) return Response.json({ error: "Поиск не найден" }, { status: 404 });
    await getDb().insert(productFeedback).values({ searchId, userEmail: identity?.email ?? null, sentiment, reason: reason || null });
    return Response.json({ saved: true, message: "Спасибо — используем оценку для улучшения результатов" }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось сохранить оценку" }, { status: 503 });
  }
}
