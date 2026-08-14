import { authMode, resetStandalonePassword } from "../../../../lib/standalone-auth";
import { rejectUntrustedMutation } from "../../../../lib/request-security";
import { enforceRateLimit } from "../../../../lib/security";
import { ensureMarketplaceSchema } from "../../../../db/ensure";

export async function POST(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const rejected = rejectUntrustedMutation(request);
  if (rejected) return rejected;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "password-reset", 10, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток. Повторите позже." }, { status: 429 });
    const body = await request.json() as { token?: unknown; password?: unknown };
    const result = await resetStandalonePassword(body.token, body.password);
    return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
  } catch {
    return Response.json({ error: "Не удалось изменить пароль" }, { status: 503 });
  }
}
