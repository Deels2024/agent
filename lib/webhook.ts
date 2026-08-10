function hexToBytes(value: string) {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export async function verifyHmac(body: string, signatureHeader: string | null, secret: string | undefined) {
  if (!signatureHeader || !secret) return false;
  const signature = hexToBytes(signatureHeader.replace(/^sha256=/i, "").trim());
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(body));
}

export async function webhookEventKey(body: string, suppliedId?: unknown) {
  const normalized = typeof suppliedId === "string" ? suppliedId.trim().slice(0, 180) : "";
  if (normalized) return normalized;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
