import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/live-search/page.tsx", import.meta.url), "utf8");

test("photo search compresses browser images before recognition upload", () => {
  assert.match(page, /preparePhotoForRecognition/);
  assert.match(page, /canvas\.toDataURL\("image\/jpeg"/);
  assert.match(page, /renderCompactJpeg\(image, 1600/);
  assert.match(page, /renderCompactJpeg\(image, 1280/);
  assert.match(page, /response\.text\(\)/);
  assert.match(page, /AbortController/);
  assert.match(page, /accept="image\/\*"/);
  assert.doesNotMatch(page, /reader\.readAsDataURL\(file\)/);
});

test("photo upload surfaces server and timeout errors instead of hiding them as JSON parse failures", () => {
  assert.match(page, /Сервер вернул некорректный ответ/);
  assert.match(page, /Распознавание заняло слишком много времени/);
  assert.match(page, /response\.status === 413/);
  assert.match(page, /input\.value = ""/);
});
