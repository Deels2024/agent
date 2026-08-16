import { runtimeEnv, runtimeValue } from "./runtime";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptCredentials(credentials: Record<string, string>) {
  const encodedKey = runtimeValue("CREDENTIAL_ENCRYPTION_KEY");
  if (!encodedKey) throw new Error("credential_encryption_not_configured");
  const rawKey = base64ToBytes(encodedKey);
  if (rawKey.byteLength !== 32) throw new Error("credential_encryption_key_invalid");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), iv: bytesToBase64(iv) };
}

export async function decryptCredentials(ciphertext: string | null, encodedIv: string | null) {
  if (!ciphertext || !encodedIv) throw new Error("credential_payload_missing");
  const encodedKey = runtimeValue("CREDENTIAL_ENCRYPTION_KEY");
  if (!encodedKey) throw new Error("credential_encryption_not_configured");
  const rawKey = base64ToBytes(encodedKey);
  if (rawKey.byteLength !== 32) throw new Error("credential_encryption_key_invalid");
  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(encodedIv) }, key, base64ToBytes(ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("credential_payload_invalid");
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (error) {
    if (error instanceof Error && error.message === "credential_payload_invalid") throw error;
    throw new Error("credential_decryption_failed");
  }
}

async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requestFingerprint(request: Request, email?: string) {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
  return digest(`${email ?? "anonymous"}:${forwarded.split(",")[0].trim()}`);
}

export async function enforceRateLimit(request: Request, scope: string, limit = 30, windowSeconds = 60) {
  const env = runtimeEnv() as { DB?: D1Database };
  if (!env.DB) return { allowed: false, retryAfter: windowSeconds, reason: "storage_unavailable" };
  const key = `${scope}:${await requestFingerprint(request)}`;
  const now = Math.floor(Date.now() / 1000);
  const resetBefore = now - windowSeconds;
  await env.DB.prepare(`INSERT INTO rate_limits (key, window_started_at, count, blocked_until)
    VALUES (?, ?, 1, NULL)
    ON CONFLICT(key) DO UPDATE SET
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END,
      count = CASE WHEN window_started_at <= ? THEN 1 ELSE count + 1 END,
      blocked_until = CASE WHEN blocked_until IS NOT NULL AND blocked_until <= ? THEN NULL ELSE blocked_until END`)
    .bind(key, now, resetBefore, resetBefore, now).run();
  const row = await env.DB.prepare("SELECT window_started_at, count, blocked_until FROM rate_limits WHERE key = ?").bind(key).first<{ window_started_at: number; count: number; blocked_until: number | null }>();
  if (!row) return { allowed: false, retryAfter: windowSeconds, reason: "rate_limit_unavailable" };
  if ((row.blocked_until ?? 0) > now) return { allowed: false, retryAfter: row.blocked_until! - now, reason: "blocked" };
  if (row.count > limit) {
    const blockedUntil = row.window_started_at + windowSeconds;
    await env.DB.prepare("UPDATE rate_limits SET blocked_until = ? WHERE key = ?").bind(blockedUntil, key).run();
    return { allowed: false, retryAfter: Math.max(1, blockedUntil - now), reason: "limit_exceeded" };
  }
  return { allowed: true, retryAfter: 0, reason: null };
}

export function cleanText(value: unknown, maxLength = 240) {
  return typeof value === "string" ? value.trim().replace(/[\u0000-\u001f]/g, " ").slice(0, maxLength) : "";
}
