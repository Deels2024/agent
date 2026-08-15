import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { users } from "../../../../db/schema";
import { requestIdentity } from "../../../../lib/auth";

export async function GET(request: Request) {
  const identity = await requestIdentity(request);
  if (!identity) return Response.json({ authenticated: false, user: null }, { headers: { "cache-control": "no-store" } });
  try {
    await ensureMarketplaceSchema();
    const [profile] = await getDb().select({ role: users.role }).from(users).where(eq(users.email, identity.email)).limit(1);
    return Response.json({ authenticated: true, user: { ...identity, role: profile?.role === "seller" ? "seller" : identity.role } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ authenticated: true, user: identity }, { headers: { "cache-control": "no-store" } });
  }
}
