import { requireAdmin } from "../../../../lib/auth";
import { marketplaceStatuses } from "../../../../lib/marketplaces";
import { openAIConfigured, openAITransport } from "../../../../lib/openai";

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  const providers = marketplaceStatuses();
  const recognitionConfigured = openAIConfigured();
  return Response.json({
    providers,
    configured: providers.filter((provider) => provider.configured).length,
    total: providers.length,
    recognition: {
      label: "OpenAI Vision",
      configured: recognitionConfigured,
      transport: openAITransport(),
      missing: recognitionConfigured ? [] : ["OpenAI server configuration"],
    },
    scopeNotice: "Официальные seller API показывают ассортимент подключённых продавцов. Полный поиск публичного каталога требует отдельного партнёрского доступа каждой площадки.",
  });
}
