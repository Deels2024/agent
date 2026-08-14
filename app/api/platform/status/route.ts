import { platformModules, platformSummary } from "../../../../lib/platform";
import { requireAdmin } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  return Response.json({
    generatedAt: new Date().toISOString(),
    summary: platformSummary(),
    modules: platformModules(),
    note: "Статус ready означает, что модуль реализован и его обязательные настройки присутствуют. Внешние договоры не заменяются демонстрационными данными.",
  });
}
