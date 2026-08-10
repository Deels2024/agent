import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { notifications, subscriptions } from "../../../db/schema";
import { requireActiveRequestIdentity } from "../../../lib/auth";
import { writeAudit } from "../../../lib/audit";
import { enforceRateLimit } from "../../../lib/security";

export async function GET(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const [subscription] = await getDb().select().from(subscriptions).where(eq(subscriptions.userEmail, identity.email)).orderBy(desc(subscriptions.createdAt)).limit(1);
    return Response.json({ subscription: subscription ?? null });
  } catch {
    return Response.json({ error: "Подписка временно недоступна" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireActiveRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "subscription-trial", 3, 86400);
    if (!rate.allowed) return Response.json({ error: "Повторите позже", retryAfter: rate.retryAfter }, { status: 429 });
    const existing = await getDb().select().from(subscriptions).where(eq(subscriptions.userEmail, identity.email)).orderBy(desc(subscriptions.createdAt)).limit(20);
    if (existing.some((item) => item.plan === "plus" && ["trial", "active"].includes(item.status))) return Response.json({ error: "Plus уже подключён" }, { status: 409 });
    const end = new Date(Date.now() + 7 * 86400 * 1000).toISOString();
    const [subscription] = await getDb().insert(subscriptions).values({ userEmail: identity.email, plan: "plus", status: "trial", provider: "internal", currentPeriodEnd: end }).returning();
    await getDb().insert(notifications).values({ recipientEmail: identity.email, template: "plus_trial_started", payloadJson: JSON.stringify({ currentPeriodEnd: end }) });
    await writeAudit(request, { actorEmail: identity.email, action: "subscription.trial_started", entityType: "subscription", entityId: subscription.id });
    return Response.json({ subscription, moneyMoved: false, warning: "Пробный период бесплатный; автоматическое списание не включено" }, { status: 201 });
  } catch {
    return Response.json({ error: "Не удалось включить пробный период" }, { status: 503 });
  }
}
