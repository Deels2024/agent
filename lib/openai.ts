import { runtimeValue } from "./runtime";

const DEFAULT_ORIGIN = "https://api.openai.com";
const GATEWAY_ORIGIN = "http://openai-gateway:8080";

type OpenAIResult = { ok: boolean; status: number; payload: Record<string, unknown> };

function baseUrl() {
  return (runtimeValue("OPENAI_BASE_URL") || (runtimeValue("OPENAI_API_KEY") ? DEFAULT_ORIGIN : "")).replace(/\/$/, "");
}

export function openAIConfigured() {
  return Boolean(baseUrl() && (runtimeValue("OPENAI_API_KEY") || runtimeValue("OPENAI_GATEWAY_TOKEN")));
}

export function openAITransport() {
  const base = baseUrl();
  if (!base) return "disabled" as const;
  return base === GATEWAY_ORIGIN || base.includes("openai-gateway") ? "proxy-gateway" as const : "direct" as const;
}

export async function openAIResponses(body: Record<string, unknown>, timeoutMs = 95_000): Promise<OpenAIResult> {
  const base = baseUrl();
  if (!base) return { ok: false, status: 503, payload: { error: "OpenAI is not configured" } };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = runtimeValue("OPENAI_API_KEY");
  const gatewayToken = runtimeValue("OPENAI_GATEWAY_TOKEN");
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (gatewayToken) headers["X-OpenAI-Gateway-Token"] = gatewayToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/v1/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; }
    catch { payload = { error: "OpenAI returned a non-JSON response" }; }
    return { ok: response.ok, status: response.status, payload };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, status: timedOut ? 504 : 502, payload: { error: timedOut ? "OpenAI request timed out" : "OpenAI transport unavailable" } };
  } finally {
    clearTimeout(timer);
  }
}
