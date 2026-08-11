import { requestIdentity } from "../../../../lib/auth";
import { authMode } from "../../../../lib/standalone-auth";

export async function GET(request: Request) {
  if (authMode() !== "standalone") return Response.json({ error: "Маршрут недоступен" }, { status: 404 });
  const identity = await requestIdentity(request);
  return Response.json({ authenticated: Boolean(identity), user: identity ?? null }, { headers: { "cache-control": "no-store" } });
}
