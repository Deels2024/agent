import { platformModules, platformSummary } from "../../../../lib/platform";

export async function GET() {
  return Response.json({
    generatedAt: new Date().toISOString(),
    summary: platformSummary(),
    modules: platformModules(),
    note: "Статус ready означает, что модуль реализован и его обязательные настройки присутствуют. Внешние договоры не заменяются демонстрационными данными.",
  });
}
