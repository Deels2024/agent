import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { notifications, priceAlerts } from "../../../../db/schema";
import { searchMarketplaces } from "../../../../lib/marketplaces";
import { runtimeValue } from "../../../../lib/runtime";

function authorized(request: Request) {
  const expected = runtimeValue("CRON_SECRET");
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && actual && expected === actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Недостаточно прав" }, { status: 401 });
  try {
    await ensureMarketplaceSchema();
    const active = await getDb().select().from(priceAlerts).where(eq(priceAlerts.status, "active")).orderBy(asc(priceAlerts.lastCheckedAt)).limit(20);
    let triggered = 0;
    for (const alert of active) {
      const result = await searchMarketplaces({ query: alert.query, mode: "text", limit: 10 });
      const bestPrice = result.demo ? null : result.offers[0]?.price ?? null;
      await getDb().update(priceAlerts).set({ currentPrice: bestPrice, lastCheckedAt: new Date().toISOString() }).where(eq(priceAlerts.id, alert.id));
      if (bestPrice != null && bestPrice <= alert.targetPrice) {
        triggered += 1;
        await getDb().insert(notifications).values({ recipientEmail: alert.userEmail, channel: alert.channel, template: "price_target_reached", payloadJson: JSON.stringify({ alertId: alert.id, query: alert.query, targetPrice: alert.targetPrice, bestPrice }) });
        await getDb().update(priceAlerts).set({ status: "triggered" }).where(eq(priceAlerts.id, alert.id));
      }
    }
    return Response.json({ checked: active.length, triggered, demoPricesIgnored: true });
  } catch {
    return Response.json({ error: "Не удалось проверить цены" }, { status: 503 });
  }
}
