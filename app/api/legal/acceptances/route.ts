import { requireRequestIdentity } from "../../../../lib/auth";
import { getLegalStatus, recordLegalAcceptances, revokeMarketingConsent, type LegalScope, type SubmittedAcceptance } from "../../../../lib/legal";
import { writeAudit } from "../../../../lib/audit";

function scopeFromUrl(request: Request): LegalScope {
  return new URL(request.url).searchParams.get("scope") === "seller" ? "seller" : "buyer";
}

export async function GET(request: Request) {
  const identity = await requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    return Response.json({ legal: await getLegalStatus(identity.email, scopeFromUrl(request)) });
  } catch {
    return Response.json({ error: "Не удалось загрузить историю документов" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const identity = await requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    const body = await request.json() as { scope?: LegalScope; acceptances?: SubmittedAcceptance[] };
    const scope: LegalScope = body.scope === "seller" ? "seller" : "buyer";
    const submitted = Array.isArray(body.acceptances) ? body.acceptances : [];
    const recorded = await recordLegalAcceptances(request, { userEmail: identity.email, scope, submitted, source: "document_update" });
    if (!recorded.ok) return Response.json({ error: "Примите все обязательные документы актуальной версии", missing: recorded.validation.missing.map((item) => item.slug) }, { status: 400 });
    await writeAudit(request, { actorEmail: identity.email, action: "legal.documents_accepted", entityType: "legal_bundle", entityId: scope });
    return Response.json({ legal: await getLegalStatus(identity.email, scope) });
  } catch {
    return Response.json({ error: "Не удалось сохранить принятие документов" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const identity = await requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  try {
    await revokeMarketingConsent(request, identity.email);
    await writeAudit(request, { actorEmail: identity.email, action: "marketing.consent_revoked", entityType: "legal_document", entityId: "marketing-consent" });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось отключить рекламные сообщения" }, { status: 503 });
  }
}
