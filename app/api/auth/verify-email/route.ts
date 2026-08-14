import { authMode, verifyStandaloneEmail } from "../../../../lib/standalone-auth";
import { rejectUntrustedMutation } from "../../../../lib/request-security";
import { enforceRateLimit } from "../../../../lib/security";
import { ensureMarketplaceSchema } from "../../../../db/ensure";

export async function POST(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const rejected = rejectUntrustedMutation(request);
  if (rejected) return rejected;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "email-verification", 20, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток. Повторите позже." }, { status: 429 });
    const body = await request.json() as { token?: unknown };
    const result = await verifyStandaloneEmail(body.token);
    return result.ok ? Response.json({ ok: true, email: result.email }) : Response.json({ error: result.error }, { status: result.status });
  } catch {
    return Response.json({ error: "Не удалось подтвердить email" }, { status: 503 });
  }
}
