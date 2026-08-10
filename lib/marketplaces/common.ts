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
  if (input.barcode) return values.some((value) => String(value ?? "").replace(/\D/g, "") === input.barcode);
  const tokens = tokenize(input.query);
  if (!tokens.length) return true;
  const haystack = tokenize(values.map((value) => String(value ?? "")).join(" "));
  const matched = tokens.filter((token) => haystack.some((value) => value === token || value.includes(token) || token.includes(value)));
  return matched.length / tokens.length >= (tokens.length <= 2 ? 1 : 0.7);
}

export function tokenize(value: string) {
  return value.toLocaleLowerCase("ru")
    .replace(/[ё]/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function matchConfidence(input: SearchInput, offer: Pick<NormalizedOffer, "productName" | "barcode">) {
  if (input.barcode) return offer.barcode === input.barcode ? 100 : 0;
  const queryTokens = tokenize(input.query);
  const offerTokens = tokenize(offer.productName);
  if (!queryTokens.length) return 0;
  const matched = queryTokens.filter((token) => offerTokens.some((value) => value === token || value.includes(token) || token.includes(value)));
  return Math.max(0, Math.min(100, Math.round((matched.length / queryTokens.length) * 100)));
}

export function rankOffers(offers: NormalizedOffer[], limit: number, input?: SearchInput) {
  const available = offers.filter((offer) => offer.inStock && offer.price > 0);
  const total = (offer: NormalizedOffer) => offer.price + (offer.deliveryPrice ?? 0);
  const lowest = Math.min(...available.map(total), Infinity);
  return available
    .map((offer) => {
      const confidence = offer.matchConfidence ?? (input ? matchConfidence(input, offer) : 0);
      return {
        ...offer,
        deliveryPrice: offer.deliveryPrice ?? 0,
        matchConfidence: confidence,
        score: Math.max(1, Math.min(100, Math.round(
          35 + (lowest / total(offer)) * 30 + (confidence / 100) * 20 + (offer.verified ? 12 : 0) + (offer.deliveryDays === 0 ? 3 : 0)
        ))),
      };
    })
    .sort((a, b) => total(a) - total(b) || b.score - a.score)
    .slice(0, limit);
}

export function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[скрыто]").slice(0, 420);
}
