import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { users } from "../../../../db/schema";
import { requireRequestIdentity } from "../../../../lib/auth";
import { getLegalStatus, registrationDocumentSummary } from "../../../../lib/legal";
import { writeAudit } from "../../../../lib/audit";

export async function POST(request: Request) {
  const identity = requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
    const legal = await getLegalStatus(identity.email, "buyer");
    if (!existing.length || !legal.complete) return Response.json({ error: "Завершите регистрацию и примите актуальные документы", code: "registration_required", registrationRequired: true, documents: registrationDocumentSummary() }, { status: 428 });
    if (existing[0].status === "suspended") return Response.json({ error: "Учётная запись приостановлена. Обратитесь в поддержку.", code: "account_suspended" }, { status: 403 });
    await db.update(users).set({ displayName: identity.displayName, updatedAt: new Date().toISOString() }).where(eq(users.email, identity.email));
    const [profile] = await db.select({ email: users.email, displayName: users.displayName, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.email, identity.email)).limit(1);
    await writeAudit(request, { actorEmail: identity.email, action: "account.opened", entityType: "user", entityId: profile?.email });
    return Response.json({ profile, legal });
  } catch {
    return Response.json({ error: "Не удалось подготовить профиль", code: "profile_unavailable" }, { status: 503 });
  }
}
