import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../worker/index.ts", import.meta.url);

test("CSP allows blob Web Workers required by HEIC conversion", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /worker-src 'self' blob:/);
});

test("CSP keeps blob out of script-src", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const match = worker.match(/script-src ([^;]+);/);
  assert.ok(match, "script-src directive must remain explicit");
  assert.match(match[1], /'self'/);
  assert.doesNotMatch(match[1], /blob:/);
});
