from pathlib import Path

page_path = Path('app/live-search/page.tsx')
page = page_path.read_text()
old_helpers = '''const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
const PHOTO_TARGET_DATA_URL_BYTES = 3_500_000;

function loadBrowserImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image_decode_failed")); };
    image.src = url;
  });
}

function renderCompactJpeg(image: HTMLImageElement, maxEdge: number, quality: number) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("image_decode_failed");
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image_canvas_unavailable");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function preparePhotoForRecognition(file: File) {
  const image = await loadBrowserImage(file);
  let dataUrl = renderCompactJpeg(image, 1600, 0.82);
  if (dataUrl.length > PHOTO_TARGET_DATA_URL_BYTES) dataUrl = renderCompactJpeg(image, 1280, 0.74);
  if (dataUrl.length > PHOTO_TARGET_DATA_URL_BYTES) dataUrl = renderCompactJpeg(image, 1024, 0.68);
  if (dataUrl.length > 4_500_000) throw new Error("photo_too_large_after_compression");
  return dataUrl;
}
'''
new_helpers = '''const MAX_SOURCE_PHOTO_BYTES = 20 * 1024 * 1024;
const PHOTO_TARGET_DATA_URL_BYTES = 1_500_000;
const PHOTO_HARD_DATA_URL_BYTES = 2_400_000;

function likelyHeic(file: File) {
  return /image\\/hei[cf]/i.test(file.type) || /\\.(heic|heif)$/i.test(file.name);
}

async function normalizePhotoBlob(file: File): Promise<Blob> {
  if (!likelyHeic(file)) return file;
  try {
    const { heicTo } = await import("heic-to/csp");
    const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.82 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!(blob instanceof Blob)) throw new Error("heic_conversion_failed");
    return blob;
  } catch {
    throw new Error("heic_conversion_failed");
  }
}

function loadBrowserImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image_decode_failed")); };
    image.src = url;
  });
}

function renderCompactJpeg(image: HTMLImageElement, maxEdge: number, quality: number) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) throw new Error("image_decode_failed");
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image_canvas_unavailable");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function preparePhotoForRecognition(file: File) {
  const source = await normalizePhotoBlob(file);
  const image = await loadBrowserImage(source);
  let dataUrl = renderCompactJpeg(image, 1400, 0.78);
  if (dataUrl.length > PHOTO_TARGET_DATA_URL_BYTES) dataUrl = renderCompactJpeg(image, 1152, 0.68);
  if (dataUrl.length > PHOTO_TARGET_DATA_URL_BYTES) dataUrl = renderCompactJpeg(image, 960, 0.62);
  if (dataUrl.length > PHOTO_HARD_DATA_URL_BYTES) dataUrl = renderCompactJpeg(image, 800, 0.55);
  if (dataUrl.length > PHOTO_HARD_DATA_URL_BYTES) throw new Error("photo_too_large_after_compression");
  return dataUrl;
}
'''
if old_helpers not in page:
    raise SystemExit('photo helper block not found')
page = page.replace(old_helpers, new_helpers, 1)
page = page.replace('''      else if (message === "image_decode_failed") setError("Этот формат фотографии не удалось открыть в браузере. Выберите JPEG, PNG, WebP или сделайте снимок камерой.");
      else if (message === "photo_too_large_after_compression") setError("Фото слишком большое для распознавания. Выберите другое фото или снимок меньшего разрешения.");''', '''      else if (message === "heic_conversion_failed") setError("Не удалось преобразовать HEIC/HEIF. Попробуйте выбрать фото ещё раз или сделать новый снимок.");
      else if (message === "image_decode_failed") setError("Этот файл не удалось открыть как изображение. Выберите JPEG, PNG, WebP, HEIC/HEIF или сделайте новый снимок.");
      else if (message === "photo_too_large_after_compression") setError("Фото слишком большое для распознавания. Выберите другое фото или снимок меньшего разрешения.");''', 1)
page = page.replace('accept="image/*" capture="environment" onChange={recognize}', 'accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif" onChange={recognize}', 1)
page_path.write_text(page)

route_path = Path('app/api/recognize/route.ts')
route = route_path.read_text()
route = route.replace('const rate = await enforceRateLimit(request, "public-recognition", 8, 3600);', 'const rate = await enforceRateLimit(request, "public-recognition-v2", 24, 3600);', 1)
route = route.replace('if (!rate.allowed) return Response.json({ error: "Лимит распознаваний исчерпан. Повторите позже.", retryAfter: rate.retryAfter }, { status: 429 });', 'if (!rate.allowed) return Response.json({ error: "Слишком много распознаваний за короткое время. Повторите позже.", code: "recognition_rate_limited", retryAfter: rate.retryAfter }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });', 1)
old_failure = '''  if (!response.ok) {
    return Response.json({
      error: response.status === 504 ? "Распознавание заняло слишком много времени. Повторите ещё раз." : "Не удалось распознать товар",
      code: response.status === 504 ? "recognition_timeout" : "recognition_failed",
      retryable: response.status >= 500 || response.status === 429,
    }, { status: response.status === 429 ? 429 : response.status === 504 ? 504 : 502 });
  }
'''
new_failure = '''  if (!response.ok) {
    const upstreamError = response.payload.error;
    const upstreamCode = upstreamError && typeof upstreamError === "object" && "code" in upstreamError ? String((upstreamError as { code?: unknown }).code || "") : "";
    console.warn("recognize.upstream.failed", { status: response.status, code: upstreamCode || "unknown" });
    if (response.status === 400 || response.status === 415 || upstreamCode.includes("image")) {
      return Response.json({ error: "Изображение дошло до сервера, но его не удалось прочитать. Попробуйте другое фото.", code: "recognition_image_invalid", retryable: false }, { status: 422 });
    }
    return Response.json({
      error: response.status === 504 ? "Распознавание заняло слишком много времени. Повторите ещё раз." : response.status === 429 ? "Сервис распознавания временно перегружен. Повторите позже." : "Не удалось распознать товар",
      code: response.status === 504 ? "recognition_timeout" : response.status === 429 ? "recognition_upstream_rate_limited" : "recognition_failed",
      retryable: response.status >= 500 || response.status === 429,
    }, { status: response.status === 429 ? 429 : response.status === 504 ? 504 : 502 });
  }
'''
if old_failure not in route:
    raise SystemExit('recognition failure block not found')
route = route.replace(old_failure, new_failure, 1)
route_path.write_text(route)

test_path = Path('tests/photo-upload.test.mjs')
test = test_path.read_text()
test = test.replace('assert.match(page, /renderCompactJpeg\\(image, 1600/);', 'assert.match(page, /renderCompactJpeg\\(image, 1400/);', 1)
test = test.replace('assert.match(page, /renderCompactJpeg\\(image, 1280/);', 'assert.match(page, /renderCompactJpeg\\(image, 1152/);', 1)
test = test.replace('assert.match(page, /accept="image\\/\\*"/);', 'assert.match(page, /heic-to\\/csp/);\n  assert.match(page, /image\\/heic/);\n  assert.doesNotMatch(page, /capture="environment"/);', 1)
test += '''\n\ntest("photo recognition resets the old test bucket and exposes safe rate-limit errors", async () => {\n  const route = await readFile(new URL("../app/api/recognize/route.ts", import.meta.url), "utf8");\n  assert.match(route, /public-recognition-v2/);\n  assert.match(route, /24, 3600/);\n  assert.match(route, /Retry-After/);\n  assert.match(route, /recognition_image_invalid/);\n});\n'''
test_path.write_text(test)
