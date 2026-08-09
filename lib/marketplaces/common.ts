import type { NormalizedOffer, SearchInput } from "./types";

export async function fetchJson(url: string, init: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
      throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 350)}`);
    }
    return payload as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export function numberFrom(value: unknown) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function matchesOffer(input: SearchInput, values: unknown[]) {
  const needle = (input.barcode || input.query).toLocaleLowerCase("ru").replace(/\s+/g, " ").trim();
  if (!needle) return true;
  return values.some((value) => String(value ?? "").toLocaleLowerCase("ru").includes(needle));
}

export function rankOffers(offers: NormalizedOffer[], limit: number) {
  const available = offers.filter((offer) => offer.inStock && offer.price > 0);
  const lowest = Math.min(...available.map((offer) => offer.price), Infinity);
  return available
    .map((offer) => ({
      ...offer,
      score: Math.max(1, Math.min(100, Math.round(
        70 + (lowest / offer.price) * 20 + (offer.verified ? 8 : 0) + (offer.deliveryDays === 0 ? 2 : 0)
      ))),
    }))
    .sort((a, b) => a.price - b.price || b.score - a.score)
    .slice(0, limit);
}

export function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[скрыто]").slice(0, 420);
}
