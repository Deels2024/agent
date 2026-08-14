import { marketplaceStatuses } from "../../../../lib/marketplaces";
import { hasRuntimeValue } from "../../../../lib/runtime";
import { requireAdmin } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  const providers = marketplaceStatuses();
  return Response.json({
    providers,
    configured: providers.filter((provider) => provider.configured).length,
    total: providers.length,
    recognition: {
      label: "OpenAI Vision",
      configured: hasRuntimeValue("OPENAI_API_KEY"),
      missing: hasRuntimeValue("OPENAI_API_KEY") ? [] : ["OPENAI_API_KEY"],
    },
    scopeNotice: "Официальные seller API показывают ассортимент подключённых продавцов. Полный поиск публичного каталога требует отдельного партнёрского доступа каждой площадки.",
  });
}
