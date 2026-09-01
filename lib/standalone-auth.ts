import { ensureMarketplaceSchema } from "../db/ensure";
import { runtimeEnv, runtimeValue } from "./runtime";

const SESSION_COOKIE = "buyer_agent_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 310_000;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 128;
const VERIFY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const RESET_TOKEN_TTL_SECONDS = 60 * 60;
const encoder = new TextEncoder();

export type AuthMode = "chatgpt" | "standalone";
export type AuthenticatedUser = {
  displayName: string;
  email: string;
  fullName: string | null;
  provider: AuthMode;
  emailVerified: boolean;
};

type CredentialRow = {
  email: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  status: string;
  email_verified_at: string | null;
};

export function authMode(): AuthMode {
  return runtimeValue("AUTH_MODE")?.toLowerCase() === "chatgpt" ? "chatgpt" : "standalone";
}

export function normalizeAuthEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function normalizeDisplayName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").slice(0, 80);
  return name.length >= 2 ? name : null;
}

export function validatePassword(value: unknown) {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    return { ok: false as const, error: `Пароль должен содержать от ${MIN_PASSWORD_LENGTH} до ${MAX_PASSWORD_LENGTH} символов` };
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(value) || !/\d/.test(value)) {
    return { ok: false as const, error: "Добавьте в пароль хотя бы одну букву и одну цифру" };
  }
  return { ok: true as const, password: value };
}

export async function registerStandaloneUser(request: Request, input: { email: unknown; displayName: unknown; password: unknown }) {
  const email = normalizeAuthEmail(input.email);
  const displayName = normalizeDisplayName(input.displayName);
  const password = validatePassword(input.password);
  if (!email) return { ok: false as const, status: 400, error: "Укажите корректный email" };
  if (!displayName) return { ok: false as const, status: 400, error: "Укажите имя — минимум 2 символа" };
  if (!password.ok) return { ok: false as const, status: 400, error: password.error };

  const database = await standaloneDatabase();
  const existing = await database.prepare("SELECT email FROM auth_credentials WHERE email = ?").bind(email).first<{ email: string }>();
  if (existing) return { ok: false as const, status: 409, error: "Аккаунт с таким email уже существует. Используйте вход." };

  const salt = randomToken(16);
  const passwordHash = await derivePasswordHash(password.password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO auth_credentials
    (email, display_name, password_salt, password_hash, password_iterations, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
    .bind(email, displayName, salt, passwordHash, PASSWORD_ITERATIONS, now, now).run();

  let verificationQueued = false;
  try {
    verificationQueued = (await queueEmailVerification(database, request, email)).queued;
  } catch {
    // Account creation remains successful; the user can request a new letter from the profile.
  }

  const session = await createSession(database, request, email);
  return { ok: true as const, status: 201, user: { email, displayName, fullName: displayName, provider: "standalone" as const, emailVerified: false }, cookie: session.cookie, verificationQueued };
}

export async function loginStandaloneUser(request: Request, input: { email: unknown; password: unknown }) {
  const database = await standaloneDatabase();
  const email = normalizeAuthEmail(input.email);
  const suppliedPassword = typeof input.password === "string" ? input.password : "";
  const credential = email
    ? await database.prepare(`SELECT email, display_name, password_salt, password_hash, password_iterations, status, email_verified_at
        FROM auth_credentials WHERE email = ?`).bind(email).first<CredentialRow>()
    : null;

  const salt = credential?.password_salt ?? "AAAAAAAAAAAAAAAAAAAAAA";
  const iterations = credential?.password_iterations ?? PASSWORD_ITERATIONS;
  const expected = credential?.password_hash ?? "0".repeat(64);
  const calculated = await derivePasswordHash(suppliedPassword.slice(0, MAX_PASSWORD_LENGTH), salt, iterations);
  if (!credential || credential.status !== "active" || !constantTimeEqual(calculated, expected)) {
    return { ok: false as const, status: 401, error: "Неверный email или пароль" };
  }
  if (runtimeValue("EMAIL_VERIFICATION_REQUIRED") === "true" && !credential.email_verified_at) {
    return { ok: false as const, status: 403, error: "Подтвердите email по ссылке из письма", code: "email_verification_required" };
  }

  const session = await createSession(database, request, credential.email);
  return {
    ok: true as const,
    status: 200,
    user: { email: credential.email, displayName: credential.display_name, fullName: credential.display_name, provider: "standalone" as const, emailVerified: Boolean(credential.email_verified_at) },
    cookie: session.cookie,
  };
}

export async function standaloneUserFromHeaders(requestHeaders: Headers): Promise<AuthenticatedUser | null> {
  if (authMode() !== "standalone") return null;
  const token = cookieValue(requestHeaders.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const database = (runtimeEnv() as { DB?: D1Database }).DB;
  if (!database) return null;
  try {
    await ensureMarketplaceSchema();
    const tokenHash = await sha256(token);
    const row = await database.prepare(`SELECT c.email, c.display_name, c.email_verified_at
      FROM auth_sessions s JOIN auth_credentials c ON c.email = s.user_email
      WHERE s.token_hash = ? AND s.expires_at > ? AND c.status = 'active'`)
      .bind(tokenHash, new Date().toISOString()).first<{ email: string; display_name: string; email_verified_at: string | null }>();
    return row ? { email: row.email, displayName: row.display_name, fullName: row.display_name, provider: "standalone", emailVerified: Boolean(row.email_verified_at) } : null;
  } catch {
    return null;
  }
}

export async function closeStandaloneSession(request: Request) {
  const database = (runtimeEnv() as { DB?: D1Database }).DB;
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (database && token) {
    try {
      await ensureMarketplaceSchema();
      await database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    } catch {
      // Cookie is still cleared when storage is temporarily unavailable.
    }
  }
  return clearSessionCookie(request);
}

export async function requestPasswordReset(request: Request, emailValue: unknown) {
  const database = await standaloneDatabase();
  const email = normalizeAuthEmail(emailValue);
  if (!email) return;
  const credential = await database.prepare("SELECT email FROM auth_credentials WHERE email = ? AND status = 'active'").bind(email).first<{ email: string }>();
  if (!credential) return;
  const token = await createOneTimeToken(database, email, "password_reset", RESET_TOKEN_TTL_SECONDS);
  const link = new URL(`/reset-password?token=${encodeURIComponent(token)}`, publicBaseUrl(request)).toString();
  await queueEmail(database, email, "password_reset", { link, expiresMinutes: 60 });
}

export async function resetStandalonePassword(tokenValue: unknown, passwordValue: unknown) {
  const database = await standaloneDatabase();
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  const password = validatePassword(passwordValue);
  if (!token || !password.ok) return { ok: false as const, status: 400, error: password.ok ? "Ссылка восстановления некорректна" : password.error };
  const tokenHash = await sha256(token);
  const row = await database.prepare(`SELECT user_email FROM auth_tokens
    WHERE token_hash = ? AND purpose = 'password_reset' AND used_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, new Date().toISOString()).first<{ user_email: string }>();
  if (!row) return { ok: false as const, status: 400, error: "Ссылка устарела или уже использована" };
  const salt = randomToken(16);
  const passwordHash = await derivePasswordHash(password.password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE auth_credentials SET password_salt = ?, password_hash = ?, password_iterations = ?, updated_at = ? WHERE email = ?")
      .bind(salt, passwordHash, PASSWORD_ITERATIONS, now, row.user_email),
    database.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?").bind(now, tokenHash),
    database.prepare("DELETE FROM auth_sessions WHERE user_email = ?").bind(row.user_email),
  ]);
  return { ok: true as const };
}

export async function verifyStandaloneEmail(tokenValue: unknown) {
  const database = await standaloneDatabase();
  const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (!token) return { ok: false as const, status: 400, error: "Ссылка подтверждения некорректна" };
  const tokenHash = await sha256(token);
  const row = await database.prepare(`SELECT user_email FROM auth_tokens
    WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > ?`)
    .bind(tokenHash, new Date().toISOString()).first<{ user_email: string }>();
  if (!row) return { ok: false as const, status: 400, error: "Ссылка устарела или уже использована" };
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE auth_credentials SET email_verified_at = ?, updated_at = ? WHERE email = ?").bind(now, now, row.user_email),
    database.prepare("UPDATE auth_tokens SET used_at = ? WHERE token_hash = ?").bind(now, tokenHash),
  ]);
  return { ok: true as const, email: row.user_email };
}

export async function resendEmailVerification(request: Request, emailValue?: unknown) {
  const user = await standaloneUserFromHeaders(request.headers);
  const email = user?.email ?? normalizeAuthEmail(emailValue);
  if (!email) return { ok: true as const, queued: true };
  const database = await standaloneDatabase();
  const credential = await database.prepare("SELECT email_verified_at FROM auth_credentials WHERE email = ? AND status = 'active'").bind(email).first<{ email_verified_at: string | null }>();
  if (!credential || credential.email_verified_at) return { ok: true as const, queued: true };
  await queueEmailVerification(database, request, email);
  return { ok: true as const, queued: true };
}

async function standaloneDatabase() {
  if (authMode() !== "standalone") throw new Error("standalone_auth_disabled");
  await ensureMarketplaceSchema();
  const database = (runtimeEnv() as { DB?: D1Database }).DB;
  if (!database) throw new Error("database_unavailable");
  return database;
}

async function queueEmailVerification(database: D1Database, request: Request, email: string) {
  const token = await createOneTimeToken(database, email, "verify_email", VERIFY_TOKEN_TTL_SECONDS);
  const link = new URL(`/verify-email?token=${encodeURIComponent(token)}`, publicBaseUrl(request)).toString();
  await queueEmail(database, email, "verify_email", { link, expiresHours: 24 });
  return { queued: true };
}

async function createOneTimeToken(database: D1Database, email: string, purpose: "verify_email" | "password_reset", ttlSeconds: number) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  await database.batch([
    database.prepare("DELETE FROM auth_tokens WHERE user_email = ? AND purpose = ? AND used_at IS NULL").bind(email, purpose),
    database.prepare("DELETE FROM auth_tokens WHERE expires_at <= ?").bind(now.toISOString()),
    database.prepare(`INSERT INTO auth_tokens (token_hash, user_email, purpose, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(tokenHash, email, purpose, expiresAt, now.toISOString()),
  ]);
  return token;
}

async function queueEmail(database: D1Database, email: string, template: string, payload: Record<string, unknown>) {
  await database.prepare(`INSERT INTO notifications (recipient_email, channel, template, payload_json, status, created_at)
    VALUES (?, 'email', ?, ?, 'queued', ?)`)
    .bind(email, template, JSON.stringify(payload), new Date().toISOString()).run();
}

function publicBaseUrl(request: Request) {
  const configured = runtimeValue("PUBLIC_APP_URL");
  if (configured) {
    try { return new URL(configured).origin; }
    catch { /* fall through to the canonical request origin */ }
  }
  return new URL(request.url).origin;
}

async function createSession(database: D1Database, request: Request, email: string) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const userAgentHash = await sha256(request.headers.get("user-agent") ?? "unknown");
  await database.batch([
    database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now.toISOString()),
    database.prepare(`INSERT INTO auth_sessions (token_hash, user_email, created_at, expires_at, user_agent_hash)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(tokenHash, email, now.toISOString(), expires.toISOString(), userAgentHash),
  ]);
  return { cookie: sessionCookie(request, token, SESSION_TTL_SECONDS) };
}

async function derivePasswordHash(password: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function randomToken(length: number) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookie(request: Request, token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureRequest(request) ? "; Secure" : ""}`;
}

function clearSessionCookie(request: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(request) ? "; Secure" : ""}`;
}

function secureRequest(request: Request) {
  return new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}
