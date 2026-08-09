import { hasRuntimeValue } from "../../../lib/runtime";
import { marketplaceStatuses } from "../../../lib/marketplaces";

export async function GET() {
  const marketplaces = marketplaceStatuses();
  return Response.json({
    ok: true,
    service: "buyer-agent-backend",
    version: "0.3.0",
    timestamp: new Date().toISOString(),
    capabilities: {
      textSearch: true,
      barcodeSearch: true,
      photoRecognition: hasRuntimeValue("OPENAI_API_KEY"),
      priceHistory: true,
      persistentSearches: true,
    },
    marketplaces,
  });
}
