import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("integration-readiness", `${process.pid}-${Date.now()}`);
const { default: worker } = await import(workerUrl.href);

const assets = { fetch: async () => new Response("Not found", { status: 404 }) };
const context = { waitUntil() {}, passThroughOnException() {} };

async function request(path, environment = {}) {
  return worker.fetch(new Request(`http://localhost${path}`), { ASSETS: assets, ...environment }, context);
}

test("health requires a reachable ready OpenAI gateway, not only local token configuration", async () => {
  const response = await request("/api/health", {
    OPENAI_BASE_URL: "http://openai-gateway:8080",
    OPENAI_GATEWAY_TOKEN: "gateway-test-token",
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.capabilities.photoRecognition, false);
  assert.equal(payload.runtime.aiTransport, "proxy-gateway");
  assert.equal(payload.runtime.aiUpstream, "unavailable");
  assert.ok(["gateway_unreachable", "gateway_readiness_timeout"].includes(payload.runtime.aiDiagnostic?.status));
  assert.equal(JSON.stringify(payload).includes("gateway-test-token"), false);
});

test("marketplace admin status reports configured transport without exposing the gateway token", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/marketplaces/status", {
    headers: { "oai-authenticated-user-email": "admin@example.test" },
  }), {
    ASSETS: assets,
    AUTH_MODE: "chatgpt",
    ADMIN_EMAILS: "admin@example.test",
    OPENAI_BASE_URL: "http://openai-gateway:8080",
    OPENAI_GATEWAY_TOKEN: "gateway-test-token",
  }, context);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.recognition.configured, true);
  assert.equal(payload.recognition.transport, "proxy-gateway");
  assert.equal(JSON.stringify(payload).includes("gateway-test-token"), false);
});

test("health does not call a sandbox payment configuration production-ready", async () => {
  const response = await request("/api/health", {
    PAYMENT_PROVIDER: "sandbox",
    PAYMENT_MODEL: "disabled",
    PAYMENT_API_URL: "https://payments.example.test",
    PAYMENT_API_KEY: "test-key",
  });
  const payload = await response.json();
  assert.equal(payload.capabilities.paymentGateway, false);
});

test("operations module requires backup policy to be explicitly true", async () => {
  const response = await worker.fetch(new Request("http://localhost/api/platform/status", {
    headers: { "oai-authenticated-user-email": "admin@example.test" },
  }), {
    ASSETS: assets,
    AUTH_MODE: "chatgpt",
    ADMIN_EMAILS: "admin@example.test",
    MONITORING_WEBHOOK_URL: "https://monitor.example.test/hook",
    BACKUP_POLICY_CONFIRMED: "false",
  }, context);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const operations = payload.modules.find((module) => module.key === "operations");
  assert.equal(operations.status, "needs_configuration");
  assert.ok(operations.missing.includes("BACKUP_POLICY_CONFIRMED=true"));
});
