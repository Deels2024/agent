import { requestIdentity } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requestIdentity(request);
  return Response.json({ authenticated: Boolean(identity), user: identity ?? null }, { headers: { "cache-control": "no-store" } });
}
