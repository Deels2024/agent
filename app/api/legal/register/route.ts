import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { notifications, subscriptions, users } from "../../../../db/schema";
import { requireRequestIdentity } from "../../../../lib/auth";
import { getLegalStatus, recordLegalAcceptances, recordOptionalMarketingChoice, registrationDocumentSummary, type SubmittedAcceptance } from "../../../../lib/legal";
import { writeAudit } from "../../../../lib/audit";
import { enforceRateLimit } from "../../../../lib/security";

export async function POST(request: Request) {
  const identity = requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "legal-registration", 8, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много попыток регистрации", retryAfter: rate.retryAfter }, { status: 429 });
    const db = getDb();
    const [existing] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
    if (existing?.status === "suspended") return Response.json({ error: "Учётная запись приостановлена", code: "account_suspended" }, { status: 403 });
    const body = await request.json() as { acceptances?: SubmittedAcceptance[]; marketingAccepted?: boolean };
    const submitted = Array.isArray(body.acceptances) ? body.acceptances.filter((item): item is SubmittedAcceptance => Boolean(item && typeof item.slug === "string" && typeof item.version === "string")) : [];
    const recorded = await recordLegalAcceptances(request, { userEmail: identity.email, scope: "buyer", submitted, source: "registration" });
    if (!recorded.ok) return Response.json({ error: "Нужно отдельно принять все обязательные документы в актуальной версии", code: "required_legal_acceptances_missing", documents: registrationDocumentSummary(), missing: recorded.validation.missing.map((item) => item.slug) }, { status: 400 });

    if (existing) {
      await db.update(users).set({ displayName: identity.displayName, updatedAt: new Date().toISOString() }).where(eq(users.email, identity.email));
    } else {
      await db.insert(users).values({ email: identity.email, displayName: identity.displayName, role: identity.role });
    }
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.userEmail, identity.email)).orderBy(desc(subscriptions.createdAt)).limit(1);
    if (!subscription) await db.insert(subscriptions).values({ userEmail: identity.email, plan: "free", status: "active" });
    if (!existing) await db.insert(notifications).values({ recipientEmail: identity.email, template: "welcome", payloadJson: JSON.stringify({ name: identity.displayName }) });
    await recordOptionalMarketingChoice(request, { userEmail: identity.email, accepted: body.marketingAccepted === true });
    await writeAudit(request, { actorEmail: identity.email, action: existing ? "legal.registration_renewed" : "account.registered", entityType: "user", entityId: identity.email, metadata: { legalScope: "buyer", marketingAccepted: body.marketingAccepted === true } });
    const [profile] = await db.select({ email: users.email, displayName: users.displayName, role: users.role, status: users.status, createdAt: users.createdAt }).from(users).where(eq(users.email, identity.email)).limit(1);
    return Response.json({ profile, legal: await getLegalStatus(identity.email, "buyer"), marketingAccepted: body.marketingAccepted === true }, { status: existing ? 200 : 201 });
  } catch {
    return Response.json({ error: "Не удалось завершить регистрацию", code: "registration_unavailable" }, { status: 503 });
  }
}
