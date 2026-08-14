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

async function request(path, init, environment = env) {
  return worker.fetch(new Request(`http://localhost${path}`, init), environment, context);
}

for (const [path, expected] of [
  ["/", "Агент покупок"],
  ["/live-search", "Найдём лучшее предложение"],
  ["/forgot-password", "Вернём доступ безопасно"],
  ["/reset-password", "Создайте новый пароль"],
  ["/verify-email", "Защитите свой аккаунт"],
  ["/legal", "Все правила — открыто"],
  ["/legal/buyer-agency-offer", "Публичная оферта на агентские"],
]) {
  test(`GET ${path} renders a page`, async () => {
    const response = await request(path, { headers: { accept: "text/html" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(await response.text(), new RegExp(expected, "i"));
  });
}

for (const path of ["/prototype", "/backend", "/platform"]) {
  test(`GET ${path} is hidden from anonymous visitors`, async () => {
    const response = await request(path, { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(response.status, 307);
  });

  test(`GET ${path} is available only to configured administrators`, async () => {
    const response = await request(path, { headers: { accept: "text/html", "oai-authenticated-user-email": "admin@example.test" } }, { ...env, AUTH_MODE: "chatgpt", ADMIN_EMAILS: "admin@example.test" });
    assert.equal(response.status, 200);
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
  assert.equal(payload.capabilities.accounts, false);
  assert.equal(payload.runtime.database, "unavailable");
  assert.equal("marketplaces" in payload, false);
  assert.equal("platform" in payload, false);
});

test("home header shows an honest sign-in entry for an anonymous visitor", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  const html = await response.text();
  assert.match(html, /href=["']\/login\?return_to=%2Faccount["']/i);
  assert.match(html, />Войти</i);
  assert.match(html, /Личный кабинет/i);
  assert.doesNotMatch(html, /customer-avatar[^>]*>С</i);
});

test("GET /api/auth/session reports the forwarded signed-in user without exposing secrets in ChatGPT mode", async () => {
  const response = await request("/api/auth/session", { headers: { "oai-authenticated-user-email": "buyer@example.test", "oai-authenticated-user-full-name": "%D0%90%D0%BD%D0%BD%D0%B0", "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8" } }, { ...env, AUTH_MODE: "chatgpt" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.email, "buyer@example.test");
  assert.equal(payload.user.displayName, "Анна");
  assert.deepEqual(Object.keys(payload.user).sort(), ["displayName", "email", "role"]);
});

test("account entry defaults to the built-in login instead of a ChatGPT-only route", async () => {
  const response = await request("/account", { headers: { accept: "text/html" }, redirect: "manual" });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/login");
  assert.equal(new URL(response.headers.get("location"), "http://localhost").searchParams.get("return_to"), "/account");
});

test("default login route renders the email and password form", async () => {
  const response = await request("/login", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Войти в кабинет/i);
  assert.match(html, /type=["']password["']/i);
  assert.doesNotMatch(html, /signin-with-chatgpt/i);
});

test("standalone mode never trusts a spoofed ChatGPT identity header", async () => {
  const response = await request("/api/admin/overview", {
    headers: { "oai-authenticated-user-email": "admin@example.test" },
  }, { ...env, AUTH_MODE: "standalone", ADMIN_EMAILS: "admin@example.test" });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "authentication_required");
});

test("GET /api/platform/status reports all commercial modules honestly", async () => {
  const response = await request("/api/platform/status", { headers: { "oai-authenticated-user-email": "admin@example.test" } }, { ...env, AUTH_MODE: "chatgpt", ADMIN_EMAILS: "admin@example.test" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.summary.total, 15);
  assert.equal(payload.summary.implemented, 15);
  assert.equal(payload.modules.length, 15);
  assert.equal(payload.modules.some((module) => module.status === "external_contract"), true);
});

for (const [method, path] of [
  ["POST", "/api/account/bootstrap"],
  ["POST", "/api/orders"],
  ["POST", "/api/price-alerts"],
  ["POST", "/api/sellers/profile"],
  ["POST", "/api/legal/register"],
  ["GET", "/api/admin/overview"],
  ["GET", "/api/admin/operations"],
]) {
  test(`${method} ${path} requires an authenticated user`, async () => {
    const response = await request(path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "authentication_required");
  });
}

test("payment and delivery webhooks reject unsigned events", async () => {
  for (const path of ["/api/webhooks/payment", "/api/webhooks/delivery"]) {
    const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ externalId: "test", status: "succeeded" }) });
    assert.equal(response.status, 401);
  }
});

test("GET /api/marketplaces/status exposes honest configuration state", async () => {
  const response = await request("/api/marketplaces/status", { headers: { "oai-authenticated-user-email": "admin@example.test" } }, { ...env, AUTH_MODE: "chatgpt", ADMIN_EMAILS: "admin@example.test" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.total, 4);
  assert.equal(payload.configured, 0);
  assert.equal(payload.recognition.configured, false);
});

test("GET /admin does not expose administrative data to a regular user", async () => {
  const response = await request("/admin", { headers: { accept: "text/html", "oai-authenticated-user-email": "buyer@example.test" } }, { ...env, AUTH_MODE: "chatgpt" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Доступ только для администратора/i);
  assert.doesNotMatch(html, /Очередь внимания/i);
});

test("admin API rejects an authenticated user without allowlist access", async () => {
  const response = await request("/api/admin/operations", { headers: { "oai-authenticated-user-email": "buyer@example.test" } }, { ...env, AUTH_MODE: "chatgpt" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "admin_required");
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
  assert.equal(payload.offers.length, 3);
  assert.equal(payload.offers.every((offer) => offer.score === 0), true);
  assert.equal(payload.offers.every((offer) => offer.verified === false), true);
  assert.equal(payload.offers.every((offer) => offer.oldPrice === undefined), true);
  assert.deepEqual(
    payload.offers.map((offer) => offer.price),
    [...payload.offers].map((offer) => offer.price).sort((a, b) => a - b),
  );
});

test("demo catalog does not show an implausibly cheap premium phone", async () => {
  const response = await request("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "Apple iPhone 15 Pro 256 GB", mode: "text", limit: 10 }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.demo, true);
  assert.equal(payload.offers[0].productName, "Apple iPhone 15 Pro 256 GB");
  assert.ok(payload.offers[0].price >= 90_000);
});

test("GET /api/history requires identity before reading saved searches", async () => {
  const response = await request("/api/history");
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "authentication_required");
});

test("authenticated mutations reject cross-site browser requests", async () => {
  const response = await request("/api/account/bootstrap", { method: "POST", headers: { "oai-authenticated-user-email": "buyer@example.test", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }, { ...env, AUTH_MODE: "chatgpt" });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "untrusted_origin");
});

test("worker adds baseline browser security headers", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors/i);
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
