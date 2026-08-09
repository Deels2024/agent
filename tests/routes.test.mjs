import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("routes-test", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

async function request(path, init) {
  return worker.fetch(new Request(`http://localhost${path}`, init), env, context);
}

for (const [path, expected] of [
  ["/", "Агент покупок"],
  ["/live-search", "Найдём лучшее предложение"],
  ["/prototype", "Покупатель"],
  ["/backend", "Backend маркетплейсов"],
]) {
  test(`GET ${path} renders a page`, async () => {
    const response = await request(path, { headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), new RegExp(expected, "i"));
  });
}

test("GET /api/health reports only configured capabilities", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.capabilities.textSearch, true);
  assert.equal(payload.capabilities.photoRecognition, false);
  assert.equal(payload.capabilities.persistentSearches, false);
  assert.equal(payload.marketplaces.length, 3);
});

test("GET /api/marketplaces/status exposes honest configuration state", async () => {
  const response = await request("/api/marketplaces/status");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 3);
  assert.equal(payload.configured, 0);
  assert.equal(payload.recognition.configured, false);
});

test("POST /api/search returns ranked demo offers without external credentials", async () => {
  const response = await request("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "Apple AirPods Pro 2 USB-C", mode: "text", limit: 10 }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.demo, true);
  assert.equal(payload.persistence, "unavailable");
  assert.equal(payload.offers.length, 4);
  assert.deepEqual(
    payload.offers.map((offer) => offer.price),
    [...payload.offers].map((offer) => offer.price).sort((a, b) => a - b),
  );
});

test("GET /api/history fails safely when D1 is not configured", async () => {
  const response = await request("/api/history");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "История пока недоступна" });
});

test("POST /api/recognize explains missing OpenAI configuration", async () => {
  const response = await request("/api/recognize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageDataUrl: "data:image/png;base64,AA==" }),
  });
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, "openai_not_configured");
});
