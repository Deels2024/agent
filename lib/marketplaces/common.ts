import type { MatchLevel, NormalizedOffer, SearchInput } from "./types";

const variantWords = new Set(["pro", "max", "ultra", "plus", "mini", "lite", "air", "se", "fe", "fold", "flip"]);
const capacityPattern = /\b\d+(?:[.,]\d+)?\s*(?:гб|gb|тб|tb)\b/giu;
const dimensionPattern = /\b\d+(?:[.,]\d+)?\s*(?:дюйм(?:а|ов)?|inch|["″])\b/giu;

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
  const productName = values.map((value) => String(value ?? "")).join(" ");
  const assessment = assessMatch(input, { productName });
  return !assessment.variantMismatch && assessment.confidence >= (tokenize(input.query).length <= 2 ? 72 : 65);
}

export function tokenize(value: string) {
  return value.toLocaleLowerCase("ru")
    .replace(/[ё]/g, "е")
    .replace(/(\d+(?:[.,]\d+)?)\s*(гб|gb|тб|tb)\b/giu, (_match, amount: string, unit: string) => amount.replace(",", ".") + unit.replace("гб", "gb").replace("тб", "tb"))
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function matchConfidence(input: SearchInput, offer: Pick<NormalizedOffer, "productName" | "barcode">) {
  return assessMatch(input, offer).confidence;
}

export function assessMatch(input: SearchInput, offer: Pick<NormalizedOffer, "productName" | "barcode" | "brand" | "model" | "mpn">) {
  const expectedBarcode = input.barcode?.replace(/\D/g, "");
  const actualBarcode = offer.barcode?.replace(/\D/g, "");
  if (expectedBarcode && actualBarcode) {
    const exact = expectedBarcode === actualBarcode;
    return {
      confidence: exact ? 100 : 0,
      level: (exact ? "exact" : "uncertain") as MatchLevel,
      reasons: [exact ? "Штрих‑код совпадает точно" : "Штрих‑код относится к другой модификации"],
      variantMismatch: !exact,
    };
  }

  const queryTokens = tokenize(input.query);
  const offerText = [offer.brand, offer.model, offer.mpn, offer.productName].filter(Boolean).join(" ");
  const offerTokens = tokenize(offerText);
  if (!queryTokens.length) return { confidence: 0, level: "uncertain" as MatchLevel, reasons: ["Недостаточно данных для сопоставления"], variantMismatch: false };

  const matched = queryTokens.filter((token) => tokenMatches(token, offerTokens));
  const queryCritical = criticalTokens(input.query);
  const offerCritical = criticalTokens(offerText);
  const missingCritical = queryCritical.filter((token) => !tokenMatches(token, offerTokens));
  const queryCapacities = capacities(input.query);
  const offerCapacities = capacities(offerText);
  const capacityConflict = queryCapacities.length > 0 && offerCapacities.length > 0 && !queryCapacities.some((value) => offerCapacities.includes(value));
  const queryDimensions = dimensions(input.query);
  const offerDimensions = dimensions(offerText);
  const dimensionConflict = queryDimensions.length > 0 && offerDimensions.length > 0 && !queryDimensions.some((value) => offerDimensions.includes(value));
  const queryHasSpecificModel = queryCritical.some((token) => !variantWords.has(token));
  const queryHasVariant = queryCritical.some((token) => variantWords.has(token));
  const extraVariant = (queryHasSpecificModel || queryHasVariant) && [...offerCritical].some((token) => variantWords.has(token) && !queryCritical.includes(token));
  const variantMismatch = capacityConflict || dimensionConflict || missingCritical.length > 0 || extraVariant;
  const coverage = matched.length / queryTokens.length;
  const criticalCoverage = queryCritical.length ? (queryCritical.length - missingCritical.length) / queryCritical.length : 1;
  const confidence = Math.max(0, Math.min(100, Math.round(coverage * 68 + criticalCoverage * 27 + (offer.brand || offer.model || offer.mpn ? 5 : 0) - (capacityConflict ? 35 : 0) - (dimensionConflict ? 30 : 0) - (extraVariant ? 18 : 0))));
  const level: MatchLevel = !variantMismatch && confidence >= 94 ? "exact" : !variantMismatch && confidence >= 78 ? "likely" : "uncertain";
  const reasons = [
    queryCritical.length && !missingCritical.length ? "Модель и ключевые характеристики совпадают" : "Название товара сопоставлено",
    queryCapacities.length && !capacityConflict ? `Модификация ${queryCapacities.join(", ")} подтверждена` : "",
    capacityConflict ? "Объём памяти отличается" : "",
    dimensionConflict ? "Размер или диагональ отличается" : "",
    missingCritical.length ? `Не подтверждено: ${missingCritical.join(", ")}` : "",
    extraVariant ? "В предложении указана другая версия модели" : "",
  ].filter(Boolean);
  return { confidence, level, reasons, variantMismatch };
}

export function rankOffers(offers: NormalizedOffer[], limit: number, input?: SearchInput) {
  const assessed = offers.map((offer) => {
    const assessment = input ? assessMatch(input, offer) : null;
    return assessment ? { ...offer, matchConfidence: assessment.confidence, matchLevel: assessment.level, matchReasons: assessment.reasons, variantMismatch: assessment.variantMismatch } : offer;
  });
  const available = assessed.filter((offer) => offer.inStock && offer.price > 0 && !offer.variantMismatch && (offer.matchConfidence ?? 100) >= 60);
  const total = (offer: NormalizedOffer) => offer.price + (offer.deliveryPrice ?? 0);
  const lowest = Math.min(...available.map(total), Infinity);
  return available
    .map((offer) => {
      const confidence = offer.matchConfidence ?? (input ? matchConfidence(input, offer) : 0);
      const freshnessHours = offer.updatedAt ? Math.max(0, (Date.now() - Date.parse(offer.updatedAt)) / 3_600_000) : null;
      const freshnessScore = freshnessHours == null ? 0 : freshnessHours <= 1 ? 5 : freshnessHours <= 24 ? 3 : 0;
      const serviceScore = (offer.warrantyMonths ? 2 : 0) + (offer.returnDays ? 2 : 0) + (offer.sellerRating && offer.sellerRating >= 4.5 ? 3 : 0);
      return {
        ...offer,
        deliveryPrice: offer.deliveryPrice ?? 0,
        matchConfidence: confidence,
        score: offer.provider === "demo" ? 0 : Math.max(1, Math.min(100, Math.round(
          30 + (lowest / total(offer)) * 28 + (confidence / 100) * 24 + (offer.verified ? 8 : 0) + (offer.deliveryDays === 0 ? 3 : 0) + freshnessScore + serviceScore
        ))),
      };
    })
    .sort((a, b) => total(a) - total(b) || b.score - a.score)
    .slice(0, limit);
}

function tokenMatches(token: string, values: string[]) {
  if (/\d/.test(token)) return values.includes(token);
  return values.some((value) => value === token || (token.length >= 4 && (value.includes(token) || token.includes(value))));
}

function criticalTokens(value: string) {
  return tokenize(value).filter((token) => (/[a-zа-я]/i.test(token) && /\d/.test(token)) || variantWords.has(token));
}

function capacities(value: string) {
  return [...value.toLocaleLowerCase("ru").matchAll(capacityPattern)].map((match) => match[0].replace(/\s+/g, "").replace("гб", "gb").replace("тб", "tb").replace(",", "."));
}

function dimensions(value: string) {
  const normalized = value.toLocaleLowerCase("ru").replace(",", ".");
  const explicit = [...normalized.matchAll(dimensionPattern)].map((match) => `${Number.parseFloat(match[0])}in`);
  const standalone = tokenize(normalized).filter((token) => /^\d{2,3}$/.test(token)).map(Number).filter((number) => number >= 10 && number <= 120).map((number) => `${number}in`);
  return [...new Set([...explicit, ...standalone])];
}

export function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[скрыто]").slice(0, 420);
}
