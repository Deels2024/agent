import { getDb } from "../../../db";
import { ensureMarketplaceSchema } from "../../../db/ensure";
import { recognitions } from "../../../db/schema";
import { openAIConfigured, openAIResponses } from "../../../lib/openai";
import { runtimeValue } from "../../../lib/runtime";
import { enforceRateLimit } from "../../../lib/security";

type RecognitionPayload = { imageDataUrl?: string };
type Recognition = { productName: string; brand?: string; model?: string; barcode?: string; confidence: number };

function extractText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [];
    for (const part of content) if (part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return typeof payload.output_text === "string" ? payload.output_text : "";
}

function parseRecognition(text: string): Recognition {
  const jsonText = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(jsonText) as Partial<Recognition>;
  const productName = String(parsed.productName || "").trim().slice(0, 240);
  if (!productName) throw new Error("Модель не смогла определить товар");
  return {
    productName,
    brand: parsed.brand ? String(parsed.brand).slice(0, 100) : undefined,
    model: parsed.model ? String(parsed.model).slice(0, 120) : undefined,
    barcode: parsed.barcode ? String(parsed.barcode).replace(/\D/g, "").slice(0, 32) : undefined,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

export async function POST(request: Request) {
  if (!openAIConfigured()) return Response.json({ error: "Распознавание по фото ещё не активировано", code: "openai_not_configured" }, { status: 503 });
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "public-recognition", 8, 3600);
    if (!rate.allowed) return Response.json({ error: "Лимит распознаваний исчерпан. Повторите позже.", retryAfter: rate.retryAfter }, { status: 429 });
  } catch {
    return Response.json({ error: "Защита распознавания временно недоступна", code: "rate_limit_unavailable" }, { status: 503 });
  }
  let payload: RecognitionPayload;
  try { payload = await request.json() as RecognitionPayload; }
  catch { return Response.json({ error: "Некорректный JSON" }, { status: 400 }); }
  const imageDataUrl = payload.imageDataUrl || "";
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(imageDataUrl)) {
    return Response.json({ error: "Поддерживаются JPEG, PNG и WebP" }, { status: 400 });
  }
  if (imageDataUrl.length > 10_500_000) return Response.json({ error: "Изображение больше 8 МБ" }, { status: 413 });

  const response = await openAIResponses({
    model: runtimeValue("OPENAI_VISION_MODEL") || "gpt-5.6-luna",
    max_output_tokens: 350,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Определи товар на фото для поиска цен. Верни только JSON без markdown: {\"productName\":\"точное название на русском\",\"brand\":\"бренд или пусто\",\"model\":\"модель или пусто\",\"barcode\":\"видимый штрих-код или пусто\",\"confidence\":0.0}. Не выдумывай невидимые модель и штрих-код." },
        { type: "input_image", image_url: imageDataUrl, detail: "auto" },
      ],
    }],
  });
  if (!response.ok) {
    return Response.json({
      error: response.status === 504 ? "Распознавание заняло слишком много времени. Повторите ещё раз." : "Не удалось распознать товар",
      code: response.status === 504 ? "recognition_timeout" : "recognition_failed",
      retryable: response.status >= 500 || response.status === 429,
    }, { status: response.status === 429 ? 429 : response.status === 504 ? 504 : 502 });
  }

  let recognition: Recognition;
  try { recognition = parseRecognition(extractText(response.payload)); }
  catch { return Response.json({ error: "Не удалось уверенно определить товар", code: "unrecognized" }, { status: 422 }); }

  try {
    await ensureMarketplaceSchema();
    await getDb().insert(recognitions).values(recognition);
  } catch { /* Распознавание остаётся полезным даже при временной недоступности истории. */ }

  return Response.json({ recognition, suggestedQuery: [recognition.brand, recognition.model, recognition.productName].filter(Boolean).join(" ") });
}
