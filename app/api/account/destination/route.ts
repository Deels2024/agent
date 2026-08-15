import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { users } from "../../../../db/schema";
import { requireRequestIdentity } from "../../../../lib/auth";
import { getLegalStatus } from "../../../../lib/legal";
import { safeRelativeReturnPath } from "../../../chatgpt-auth";

function allowedDestination(value: string) {
  return ["/account", "/seller", "/live-search"].some((path) => value === path || value.startsWith(path + "?") || value.startsWith(path + "#"));
}

function registrationDestination(role: "buyer" | "seller", returnTo: string) {
  return "/register?role=" + role + "&return_to=" + encodeURIComponent(returnTo);
}

export async function GET(request: Request) {
  const identity = await requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const requestedValue = new URL(request.url).searchParams.get("return_to") ?? "/account";
    const safeRequested = safeRelativeReturnPath(requestedValue);
    const requested = allowedDestination(safeRequested) ? safeRequested : "/account";
    const [profile] = await getDb().select({ role: users.role, status: users.status }).from(users).where(eq(users.email, identity.email)).limit(1);
    const inferredRole = requested.startsWith("/seller") ? "seller" : "buyer";
    const role = profile?.role === "seller" ? "seller" : inferredRole;
    const destination = requested === "/account" ? (role === "seller" ? "/seller" : "/account") : requested;

    if (!profile) return Response.json({ destination: registrationDestination(role, destination), role, registrationRequired: true });
    if (profile.status === "suspended") return Response.json({ error: "Учётная запись приостановлена", code: "account_suspended" }, { status: 403 });
    const legal = await getLegalStatus(identity.email, "buyer");
    if (!legal.complete) return Response.json({ destination: registrationDestination(role, destination), role, registrationRequired: true });
    return Response.json({ destination, role, registrationRequired: false }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Не удалось определить кабинет", code: "destination_unavailable" }, { status: 503 });
  }
}
