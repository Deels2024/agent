import { ensureMarketplaceSchema } from "../db/ensure";
import { runtimeEnv, runtimeValue } from "./runtime";
import { getLegalStatus, type LegalScope } from "./legal";

export type AppRole = "buyer" | "seller" | "admin";

export type RequestIdentity = {
  email: string;
  displayName: string;
  role: AppRole;
};

function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : null;
}

function decodeName(request: Request) {
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (!encoded || request.headers.get("oai-authenticated-user-full-name-encoding") !== "percent-encoded-utf-8") return null;
  try { return decodeURIComponent(encoded); }
  catch { return null; }
}

export function adminEmails() {
  return new Set((runtimeValue("ADMIN_EMAILS") ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function requestIdentity(request: Request): RequestIdentity | null {
  const forwardedEmail = normalizeEmail(request.headers.get("oai-authenticated-user-email"));
  const developmentEmail = process.env.NODE_ENV === "production" ? null : normalizeEmail(runtimeValue("DEV_USER_EMAIL"));
  const email = forwardedEmail ?? developmentEmail;
  if (!email) return null;
  const role: AppRole = adminEmails().has(email) ? "admin" : "buyer";
  return { email, displayName: decodeName(request) ?? email.split("@")[0], role };
}

export function requireRequestIdentity(request: Request): RequestIdentity | Response {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "Запрос отклонён защитой источника", code: "untrusted_origin" }, { status: 403 });
      } catch {
        return Response.json({ error: "Некорректный источник запроса", code: "untrusted_origin" }, { status: 403 });
      }
    }
    if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return Response.json({ error: "Запрос с другого сайта запрещён", code: "cross_site_request" }, { status: 403 });
  }
  const identity = requestIdentity(request);
  if (identity) return identity;
  return Response.json({ error: "Нужно войти в аккаунт", code: "authentication_required" }, { status: 401 });
}

export async function requireActiveRequestIdentity(request: Request, legalScope: LegalScope = "buyer"): Promise<RequestIdentity | Response> {
  const identity = requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  const env = runtimeEnv() as { DB?: D1Database };
  if (!env.DB) return identity;
  try {
    await ensureMarketplaceSchema();
    const profile = await env.DB.prepare("SELECT status FROM users WHERE email = ?").bind(identity.email).first<{ status: string }>();
    if (!profile) return Response.json({ error: "Завершите регистрацию и примите документы", code: "registration_required" }, { status: 428 });
    if (profile?.status === "suspended") {
      return Response.json({ error: "Учётная запись приостановлена. Обратитесь в поддержку.", code: "account_suspended" }, { status: 403 });
    }
    const legal = await getLegalStatus(identity.email, legalScope);
    if (!legal.complete) return Response.json({ error: legalScope === "seller" ? "Примите документы продавца" : "Примите актуальные документы сервиса", code: "legal_acceptance_required", legal }, { status: 428 });
    return identity;
  } catch {
    return Response.json({ error: "Не удалось проверить состояние учётной записи", code: "account_status_unavailable" }, { status: 503 });
  }
}

export function requireAdmin(request: Request): RequestIdentity | Response {
  const identity = requireRequestIdentity(request);
  if (identity instanceof Response) return identity;
  if (!adminEmails().has(identity.email)) {
    return Response.json({ error: "Недостаточно прав", code: "admin_required" }, { status: 403 });
  }
  return { ...identity, role: "admin" };
}
