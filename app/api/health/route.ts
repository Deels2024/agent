import { hasRuntimeBinding, hasRuntimeValue } from "../../../lib/runtime";
import { marketplaceStatuses } from "../../../lib/marketplaces";
import { platformSummary } from "../../../lib/platform";

export async function GET() {
  const marketplaces = marketplaceStatuses();
  return Response.json({
    ok: true,
    service: "buyer-agent-backend",
    version: "0.5.0",
    timestamp: new Date().toISOString(),
    capabilities: {
      textSearch: true,
      barcodeSearch: true,
      photoRecognition: hasRuntimeValue("OPENAI_API_KEY"),
      priceHistory: true,
      persistentSearches: hasRuntimeBinding("DB"),
      accounts: true,
      sellerCabinet: hasRuntimeBinding("DB"),
      ordersAndDisputes: hasRuntimeBinding("DB"),
      encryptedSellerCredentials: hasRuntimeValue("CREDENTIAL_ENCRYPTION_KEY"),
      paymentGateway: hasRuntimeValue("PAYMENT_PROVIDER") && hasRuntimeValue("PAYMENT_API_KEY"),
      notifications: hasRuntimeValue("NOTIFICATION_WEBHOOK_URL") && hasRuntimeValue("NOTIFICATION_WEBHOOK_SECRET"),
    },
    marketplaces,
    platform: platformSummary(),
  });
}
