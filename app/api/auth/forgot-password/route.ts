import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { authMode, requestPasswordReset } from "../../../../lib/standalone-auth";
import { rejectUntrustedMutation } from "../../../../lib/request-security";
import { enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const rejected = rejectUntrustedMutation(request);
  if (rejected) return rejected;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "password-reset-request", 5, 3600);
    if (rate.allowed) {
      const body = await request.json() as { email?: unknown };
      await requestPasswordReset(request, body.email);
    }
    return Response.json({ message: "Если аккаунт существует, письмо со ссылкой уже поставлено в очередь." });
  } catch {
    return Response.json({ message: "Если аккаунт существует, письмо со ссылкой уже поставлено в очередь." });
  }
}
