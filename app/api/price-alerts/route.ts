import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { authCredentials, notifications, priceAlerts } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit } from "../../../lib/audit";
import { cleanText, enforceRateLimit } from "../../../lib/security";
import { hasRuntimeValue } from "../../../lib/runtime";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const alerts = await getDb().select().from(priceAlerts).where(eq(priceAlerts.userEmail, identity.email)).orderBy(desc(priceAlerts.createdAt)).limit(100);
    return Response.json({ alerts });
  } catch {
    return Response.json({ error: "Уведомления о цене недоступны" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "price-alert", 20, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много правил", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    const query = cleanText(body.query, 240);
    const targetPrice = Number(body.targetPrice);
    const channel = ["in_app", "email", "sms", "push"].includes(String(body.channel)) ? String(body.channel) : "in_app";
    if (query.length < 2 || !Number.isFinite(targetPrice) || targetPrice <= 0) return Response.json({ error: "Укажите товар и целевую цену" }, { status: 400 });
    if (channel !== "in_app" && !hasRuntimeValue("NOTIFICATION_WEBHOOK_URL")) return Response.json({ error: "Внешняя отправка ещё не подключена. Выберите уведомление в личном кабинете." }, { status: 503 });
    if (channel === "email") {
      const [credential] = await getDb().select({ emailVerifiedAt: authCredentials.emailVerifiedAt }).from(authCredentials).where(eq(authCredentials.email, identity.email)).limit(1);
      if (credential && !credential.emailVerifiedAt) return Response.json({ error: "Сначала подтвердите email в профиле" }, { status: 400 });
    }
    const [alert] = await getDb().insert(priceAlerts).values({ userEmail: identity.email, query, targetPrice: Math.round(targetPrice * 100) / 100, channel }).returning();
    await getDb().insert(notifications).values({ recipientEmail: identity.email, channel: "in_app", template: "price_alert_created", payloadJson: JSON.stringify({ alertId: alert.id, query, targetPrice }) });
    await writeAudit(request, { actorEmail: identity.email, action: "price_alert.created", entityType: "price_alert", entityId: alert.id });
    return Response.json({ alert }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось сохранить правило цены" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Некорректный идентификатор" }, { status: 400 });
    await getDb().update(priceAlerts).set({ status: "cancelled" }).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userEmail, identity.email)));
    await writeAudit(request, { actorEmail: identity.email, action: "price_alert.cancelled", entityType: "price_alert", entityId: id });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось отключить правило" }, { status: 503 });
  }
}
