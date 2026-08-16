import { runtimeEnv } from "../../../../lib/runtime";
import { requireAdmin } from "../../../../lib/auth";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { platformModules, platformSummary } from "../../../../lib/platform";

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const env = runtimeEnv() as { DB?: D1Database };
    if (!env.DB) throw new Error("database_unavailable");
    const [users, sellers, orders, demand, disputes, risks, notifications, recentSearches, matchedSearches, recentDemand, recentAlerts, recentOrders, feedbackTotal, feedbackHelpful] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM sellers").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM orders").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM demand_requests WHERE status = 'open'").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM disputes WHERE status = 'open'").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM risk_events WHERE status = 'open' AND score >= 40").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM notifications WHERE status = 'failed'").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM searches WHERE created_at >= datetime('now', '-30 days')").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM searches WHERE created_at >= datetime('now', '-30 days') AND offer_count > 0").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM demand_requests WHERE created_at >= datetime('now', '-30 days')").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM price_alerts WHERE created_at >= datetime('now', '-30 days')").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM orders WHERE created_at >= datetime('now', '-30 days')").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM product_feedback WHERE created_at >= datetime('now', '-30 days')").first<{ count: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM product_feedback WHERE created_at >= datetime('now', '-30 days') AND sentiment = 'helpful'").first<{ count: number }>(),
    ]);
    const feedbackCount = feedbackTotal?.count ?? 0;
    const helpfulCount = feedbackHelpful?.count ?? 0;
    return Response.json({
      actor: { email: identity.email, role: identity.role },
      metrics: { users: users?.count ?? 0, sellers: sellers?.count ?? 0, orders: orders?.count ?? 0, openDemand: demand?.count ?? 0, openDisputes: disputes?.count ?? 0, elevatedRisks: risks?.count ?? 0, failedNotifications: notifications?.count ?? 0 },
      funnel: {
        periodDays: 30,
        searches: recentSearches?.count ?? 0,
        matched: matchedSearches?.count ?? 0,
        buyerActions: (recentDemand?.count ?? 0) + (recentAlerts?.count ?? 0),
        orders: recentOrders?.count ?? 0,
        feedbackCount,
        helpfulCount,
        helpfulRate: feedbackCount ? Math.round((helpfulCount / feedbackCount) * 100) : null,
      },
      platform: { summary: platformSummary(), modules: platformModules() },
    });
  } catch {
    return Response.json({ error: "Административная статистика недоступна" }, { status: 503 });
  }
}
