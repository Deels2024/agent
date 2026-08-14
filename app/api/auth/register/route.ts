import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { authMode, registerStandaloneUser } from "../../../../lib/standalone-auth";
import { rejectUntrustedMutation } from "../../../../lib/request-security";
import { enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const rejected = rejectUntrustedMutation(request);
  if (rejected) return rejected;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "standalone-register", 5, 3600);
    if (!rate.allowed) return Response.json({ error: "Слишком много регистраций. Повторите позже.", retryAfter: rate.retryAfter }, { status: 429 });
    const body = await request.json() as { email?: unknown; displayName?: unknown; password?: unknown };
    const result = await registerStandaloneUser(request, body);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ user: result.user, verificationQueued: result.verificationQueued }, { status: result.status, headers: { "set-cookie": result.cookie, "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Регистрация временно недоступна. Повторите немного позже." }, { status: 503 });
  }
}
