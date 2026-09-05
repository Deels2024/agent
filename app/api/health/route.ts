import { ensureMarketplaceSchema } from "../../../db/ensure";
import { openAIReadiness, openAITransport } from "../../../lib/openai";
import { hasRuntimeValue, runtimeEnv, runtimeValue } from "../../../lib/runtime";
import { authMode } from "../../../lib/standalone-auth";

const compliantPaymentModels = new Set(["seller_direct", "bank_safe_deal", "split_payment"]);

export async function GET() {
  const [databaseReady, ai] = await Promise.all([databaseIsReady(), openAIReadiness()]);
  const deliveryConfigured = hasRuntimeValue("APISHIP_API_TOKEN") || hasRuntimeValue("DELIVERY_API_KEY");
  const notificationsConfigured = hasRuntimeValue("NOTIFICATION_WEBHOOK_URL") && hasRuntimeValue("NOTIFICATION_WEBHOOK_SECRET");
  const paymentConfigured = runtimeValue("PAYMENT_PROVIDER") === "webhook"
    && compliantPaymentModels.has(runtimeValue("PAYMENT_MODEL") ?? "")
    && hasRuntimeValue("PAYMENT_API_URL")
    && hasRuntimeValue("PAYMENT_API_KEY");
  return Response.json({
    ok: true,
    service: "buyer-agent-backend",
    version: "0.8.1",
    timestamp: new Date().toISOString(),
    runtime: {
      database: databaseReady ? "ready" : "unavailable",
      authentication: authMode(),
      aiTransport: openAITransport(),
      aiUpstream: ai.ready ? "ready" : "unavailable",
      aiDiagnostic: ai.diagnostic ?? null,
      databaseRequiredFor: ["registration", "account", "seller", "orders", "admin"],
    },
    capabilities: {
      textSearch: true,
      barcodeSearch: true,
      photoRecognition: ai.ready,
      priceHistory: true,
      persistentSearches: databaseReady,
      accounts: databaseReady,
      sellerCabinet: databaseReady,
      ordersAndDisputes: databaseReady,
      backgroundAutomation: databaseReady && hasRuntimeValue("CRON_SECRET"),
      deliveryPlanner: databaseReady,
      deliveryNetwork: deliveryConfigured,
      pickupPoints: deliveryConfigured,
      encryptedSellerCredentials: hasRuntimeValue("CREDENTIAL_ENCRYPTION_KEY"),
      paymentGateway: paymentConfigured,
      notifications: notificationsConfigured,
    },
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
