import { authMode, resendEmailVerification } from "../../../../lib/standalone-auth";
import { rejectUntrustedMutation } from "../../../../lib/request-security";
import { enforceRateLimit } from "../../../../lib/security";
import { ensureMarketplaceSchema } from "../../../../db/ensure";

export async function POST(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const rejected = rejectUntrustedMutation(request);
  if (rejected) return rejected;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "email-verification-resend", 3, 3600);
    if (!rate.allowed) return Response.json({ error: "Новое письмо можно запросить позже" }, { status: 429 });
    let email: unknown;
    try { email = ((await request.json()) as { email?: unknown }).email; } catch { email = undefined; }
    const result = await resendEmailVerification(request, email);
    return Response.json({ ...result, message: "Если адрес ожидает подтверждения, новое письмо уже поставлено в очередь." });
  } catch {
    return Response.json({ error: "Не удалось отправить письмо повторно" }, { status: 503 });
  }
}
