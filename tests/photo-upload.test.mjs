import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/live-search/page.tsx", import.meta.url), "utf8");

test("photo search compresses browser images before recognition upload", () => {
  assert.match(page, /preparePhotoForRecognition/);
  assert.match(page, /canvas\.toDataURL\("image\/jpeg"/);
  assert.match(page, /renderCompactJpeg\(image, 1400/);
  assert.match(page, /renderCompactJpeg\(image, 1152/);
  assert.match(page, /response\.text\(\)/);
  assert.match(page, /AbortController/);
  assert.match(page, /heic-to\/csp/);
  assert.match(page, /image\/heic/);
  assert.doesNotMatch(page, /capture="environment"/);
  assert.doesNotMatch(page, /reader\.readAsDataURL\(file\)/);
});

test("photo upload surfaces server and timeout errors instead of hiding them as JSON parse failures", () => {
  assert.match(page, /Сервер вернул некорректный ответ/);
  assert.match(page, /Распознавание заняло слишком много времени/);
  assert.match(page, /response\.status === 413/);
  assert.match(page, /input\.value = ""/);
});


test("photo recognition resets the old test bucket and exposes safe rate-limit errors", async () => {
  const route = await readFile(new URL("../app/api/recognize/route.ts", import.meta.url), "utf8");
  assert.match(route, /public-recognition-v2/);
  assert.match(route, /24, 3600/);
  assert.match(route, /Retry-After/);
  assert.match(route, /recognition_image_invalid/);
});
