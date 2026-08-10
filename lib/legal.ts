import { ensureMarketplaceSchema } from "../db/ensure";
import {
  buyerRegistrationDocuments,
  getLegalDocument,
  legalDocuments,
  optionalRegistrationDocuments,
  sellerRequiredDocuments,
} from "./legal-documents";
import { runtimeEnv } from "./runtime";
import { requestFingerprint } from "./security";

export type LegalScope = "buyer" | "seller";
export type SubmittedAcceptance = { slug: string; version: string };

type AcceptanceRow = {
  document_slug: string;
  document_version: string;
  role_scope: string;
  status: string;
  accepted_at: string;
  revoked_at: string | null;
};

function db() {
  const database = (runtimeEnv() as { DB?: D1Database }).DB;
  if (!database) throw new Error("D1 binding DB is not configured");
  return database;
}

export function requiredDocumentsForScope(scope: LegalScope) {
  return scope === "seller" ? sellerRequiredDocuments : buyerRegistrationDocuments;
}

export function publicDocumentSummary(document: (typeof legalDocuments)[number]) {
  return {
    slug: document.slug,
    title: document.shortTitle,
    summary: document.summary,
    version: document.version,
    href: `/legal/${document.slug}`,
    optional: Boolean(document.optional),
  };
}

export function registrationDocumentSummary() {
  return {
    required: buyerRegistrationDocuments.map(publicDocumentSummary),
    optional: optionalRegistrationDocuments.map(publicDocumentSummary),
  };
}

export async function getLegalStatus(userEmail: string, scope: LegalScope) {
  await ensureMarketplaceSchema();
  const result = await db().prepare(`SELECT document_slug, document_version, role_scope, status, accepted_at, revoked_at
    FROM legal_acceptances WHERE user_email = ? AND role_scope = ? ORDER BY accepted_at DESC`)
    .bind(userEmail.toLowerCase(), scope).all<AcceptanceRow>();
  const accepted = result.results ?? [];
  const current = new Map(accepted.filter((row) => row.status === "accepted" && !row.revoked_at).map((row) => [`${row.document_slug}:${row.document_version}`, row]));
  const required = requiredDocumentsForScope(scope);
  const missing = required.filter((document) => !current.has(`${document.slug}:${document.version}`));
  return {
    scope,
    complete: missing.length === 0,
    required: required.map(publicDocumentSummary),
    missing: missing.map(publicDocumentSummary),
    accepted: accepted.map((row) => ({ slug: row.document_slug, version: row.document_version, status: row.status, acceptedAt: row.accepted_at, revokedAt: row.revoked_at })),
  };
}

export async function hasCurrentLegalAcceptances(userEmail: string, scope: LegalScope) {
  return (await getLegalStatus(userEmail, scope)).complete;
}

export function validateAcceptanceSet(submitted: SubmittedAcceptance[], scope: LegalScope) {
  const unique = new Map(submitted.map((item) => [item.slug, item.version]));
  const required = requiredDocumentsForScope(scope);
  const allowed = new Set(required.map((document) => document.slug));
  const invalid = submitted.filter((item) => {
    const document = getLegalDocument(item.slug);
    return !document || !allowed.has(item.slug) || document.version !== item.version;
  });
  const missing = required.filter((document) => unique.get(document.slug) !== document.version);
  return { valid: invalid.length === 0 && missing.length === 0, invalid, missing };
}

async function hashUserAgent(request: Request) {
  const value = request.headers.get("user-agent") ?? "unknown";
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordLegalAcceptances(request: Request, input: {
  userEmail: string;
  scope: LegalScope;
  submitted: SubmittedAcceptance[];
  source: "registration" | "seller_onboarding" | "document_update";
}) {
  await ensureMarketplaceSchema();
  const validation = validateAcceptanceSet(input.submitted, input.scope);
  if (!validation.valid) return { ok: false as const, validation };
  const now = new Date().toISOString();
  const ipHash = await requestFingerprint(request, input.userEmail);
  const userAgentHash = await hashUserAgent(request);
  const statements = input.submitted.map((item) => db().prepare(`INSERT INTO legal_acceptances
    (user_email, document_slug, document_version, role_scope, status, accepted_at, revoked_at, ip_hash, user_agent_hash, evidence_json)
    VALUES (?, ?, ?, ?, 'accepted', ?, NULL, ?, ?, ?)
    ON CONFLICT(user_email, document_slug, document_version, role_scope) DO UPDATE SET
      status = 'accepted', accepted_at = excluded.accepted_at, revoked_at = NULL,
      ip_hash = excluded.ip_hash, user_agent_hash = excluded.user_agent_hash, evidence_json = excluded.evidence_json`)
    .bind(input.userEmail.toLowerCase(), item.slug, item.version, input.scope, now, ipHash, userAgentHash, JSON.stringify({
      source: input.source,
      action: "separate_checkbox_not_prechecked",
      authenticated: true,
      documentHref: `/legal/${item.slug}`,
    })));
  await db().batch(statements);
  return { ok: true as const, acceptedAt: now };
}

export async function recordOptionalMarketingChoice(request: Request, input: { userEmail: string; accepted: boolean }) {
  await ensureMarketplaceSchema();
  const document = optionalRegistrationDocuments.find((item) => item.slug === "marketing-consent");
  if (!document) return;
  const now = new Date().toISOString();
  const ipHash = await requestFingerprint(request, input.userEmail);
  const userAgentHash = await hashUserAgent(request);
  await db().prepare(`INSERT INTO legal_acceptances
    (user_email, document_slug, document_version, role_scope, status, accepted_at, revoked_at, ip_hash, user_agent_hash, evidence_json)
    VALUES (?, ?, ?, 'buyer', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_email, document_slug, document_version, role_scope) DO UPDATE SET
      status = excluded.status, accepted_at = excluded.accepted_at, revoked_at = excluded.revoked_at,
      ip_hash = excluded.ip_hash, user_agent_hash = excluded.user_agent_hash, evidence_json = excluded.evidence_json`)
    .bind(input.userEmail.toLowerCase(), document.slug, document.version, input.accepted ? "accepted" : "declined", now, input.accepted ? null : now, ipHash, userAgentHash, JSON.stringify({ source: "registration", optional: true, action: "explicit_checkbox_choice" })).run();
}

export async function revokeMarketingConsent(request: Request, userEmail: string) {
  await ensureMarketplaceSchema();
  const document = getLegalDocument("marketing-consent");
  if (!document) return;
  const now = new Date().toISOString();
  await db().prepare(`UPDATE legal_acceptances SET status = 'revoked', revoked_at = ?, evidence_json = ?
    WHERE user_email = ? AND document_slug = ? AND document_version = ? AND role_scope = 'buyer'`)
    .bind(now, JSON.stringify({ source: "profile", action: "revoked", ipHash: await requestFingerprint(request, userEmail) }), userEmail.toLowerCase(), document.slug, document.version).run();
}
