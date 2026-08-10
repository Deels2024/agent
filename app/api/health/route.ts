import { ensureMarketplaceSchema } from "../../../db/ensure";
import { hasRuntimeValue, runtimeEnv } from "../../../lib/runtime";
import { marketplaceStatuses } from "../../../lib/marketplaces";
import { platformSummary } from "../../../lib/platform";

export async function GET() {
  const marketplaces = marketplaceStatuses();
  const databaseReady = await databaseIsReady();
  return Response.json({
    ok: true,
    service: "buyer-agent-backend",
    version: "0.6.0",
    timestamp: new Date().toISOString(),
    runtime: {
      database: databaseReady ? "ready" : "unavailable",
      databaseRequiredFor: ["registration", "account", "seller", "orders", "admin"],
    },
    capabilities: {
      textSearch: true,
      barcodeSearch: true,
      photoRecognition: hasRuntimeValue("OPENAI_API_KEY"),
      priceHistory: true,
      persistentSearches: databaseReady,
      accounts: databaseReady,
      sellerCabinet: databaseReady,
      ordersAndDisputes: databaseReady,
      encryptedSellerCredentials: hasRuntimeValue("CREDENTIAL_ENCRYPTION_KEY"),
      paymentGateway: hasRuntimeValue("PAYMENT_PROVIDER") && hasRuntimeValue("PAYMENT_API_KEY"),
      notifications: hasRuntimeValue("NOTIFICATION_WEBHOOK_URL") && hasRuntimeValue("NOTIFICATION_WEBHOOK_SECRET"),
    },
    marketplaces,
    platform: platformSummary(),
  });
}

async function databaseIsReady() {
  const database = (runtimeEnv() as { DB?: D1Database }).DB;
  if (!database) return false;
  try {
    await ensureMarketplaceSchema();
    const result = await database.prepare("SELECT 1 AS ready").first<{ ready: number }>();
    return result?.ready === 1;
  } catch {
    return false;
  }
}
