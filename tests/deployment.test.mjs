import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const [dockerfile, compose, startScript, runtimeConfigScript, openaiDockerfile, openaiGateway, automationDockerfile, automationRunner, deployWorkflow] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../docker-compose.server.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-docker.sh", import.meta.url), "utf8"),
  readFile(new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile.openai-gateway", import.meta.url), "utf8"),
  readFile(new URL("../openai-gateway/openai_gateway.py", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile.automation", import.meta.url), "utf8"),
  readFile(new URL("../automation/runner.py", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
]);

test("Docker runtime provides a persistent D1 binding", () => {
  assert.match(dockerfile, /CMD \["npm", "run", "start:docker"\]/);
  assert.match(startScript, /wrangler dev/);
  assert.match(startScript, /--persist-to/);
  assert.match(startScript, /dist\/server\/wrangler\.json/);
  assert.match(startScript, /create-runtime-wrangler-config\.mjs/);
  assert.match(runtimeConfigScript, /CREDENTIAL_ENCRYPTION_KEY/);
  assert.match(runtimeConfigScript, /PUBLIC_ACCESS_ENABLED/);
  assert.match(runtimeConfigScript, /AUTH_MODE/);
  assert.match(runtimeConfigScript, /EMAIL_VERIFICATION_REQUIRED/);
  assert.match(compose, /worker_state:\/app\/\.wrangler/);
  assert.match(compose, /AUTH_MODE: \$\{AUTH_MODE:-standalone\}/);
  assert.match(compose, /EMAIL_VERIFICATION_REQUIRED: \$\{EMAIL_VERIFICATION_REQUIRED:-false\}/);
});

test("Docker health check rejects a backend without database persistence", () => {
  assert.match(dockerfile, /capabilities\?\.persistentSearches/);
});

test("runtime Worker config receives protected environment without changing paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buyer-agent-runtime-config-"));
  const source = join(directory, "wrangler.json");
  const target = join(directory, "wrangler.runtime.json");
  try {
    await writeFile(source, JSON.stringify({ main: "index.js", vars: { EXISTING: "kept" } }));
    await execFileAsync(process.execPath, [new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url).pathname, source, target], {
      env: { ...process.env, ADMIN_EMAILS: "admin@example.test", PAYMENT_WEBHOOK_SECRET: "test-secret", OPENAI_BASE_URL: "http://openai-gateway:8080", OPENAI_GATEWAY_TOKEN: "gateway-test", APISHIP_API_TOKEN: "delivery-test" },
    });
    const generated = JSON.parse(await readFile(target, "utf8"));
    assert.equal(generated.main, "index.js");
    assert.equal(generated.vars.EXISTING, "kept");
    assert.equal(generated.vars.ADMIN_EMAILS, "admin@example.test");
    assert.equal(generated.vars.PAYMENT_WEBHOOK_SECRET, "test-secret");
    assert.equal(generated.vars.OPENAI_BASE_URL, "http://openai-gateway:8080");
    assert.equal(generated.vars.OPENAI_GATEWAY_TOKEN, "gateway-test");
    assert.equal(generated.vars.APISHIP_API_TOKEN, "delivery-test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server compose passes every protected production integration setting", () => {
  for (const setting of [
    "ADMIN_EMAILS",
    "CREDENTIAL_ENCRYPTION_KEY",
    "PAYMENT_API_KEY",
    "PAYMENT_WEBHOOK_SECRET",
    "KYC_API_KEY",
    "APISHIP_API_TOKEN",
    "DELIVERY_API_KEY",
    "DELIVERY_WEBHOOK_SECRET",
    "NOTIFICATION_WEBHOOK_SECRET",
    "CRON_SECRET",
    "LEGAL_OPERATOR_REQUISITES_CONFIRMED",
    "PRIVACY_PROCESSORS_CONFIRMED",
    "PUBLIC_ACCESS_ENABLED",
    "AUTH_MODE",
    "EMAIL_VERIFICATION_REQUIRED",
    "OPENAI_BASE_URL",
    "OPENAI_GATEWAY_TOKEN",
  ]) {
    assert.match(compose, new RegExp(`${setting}: \\\${${setting}`));
  }
});

test("OpenAI production traffic is isolated behind an internal authenticated proxy gateway", () => {
  assert.match(compose, /openai-gateway:/);
  assert.match(compose, /OPENAI_API_KEY: \$\{OPENAI_API_KEY:-\}/);
  assert.match(compose, /OPENAI_PROXY_URL: \$\{OPENAI_PROXY_URL:-\}/);
  assert.match(compose, /OPENAI_BASE_URL: \$\{OPENAI_BASE_URL:-http:\/\/openai-gateway:8080\}/);
  assert.doesNotMatch(compose.match(/\n  app:[\s\S]*?\n  automation:/)?.[0] ?? "", /OPENAI_API_KEY:/);
  assert.match(openaiDockerfile, /USER gateway/);
  assert.match(openaiGateway, /X-OpenAI-Gateway-Token/);
  assert.match(openaiGateway, /--proxy/);
  assert.match(openaiGateway, /--check-upstream/);
  assert.doesNotMatch(compose.match(/\n  openai-gateway:[\s\S]*?\n  app:/)?.[0] ?? "", /ports:/);
  assert.match(deployWorkflow, /openai_gateway\.py --check-upstream/);
  assert.match(deployWorkflow, /photoRecognition/);
});

test("production app is reachable only through the host reverse proxy", () => {
  assert.match(compose, /127\.0\.0\.1:8788:8788/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8788:8788/);
});

test("background runner links price alerts, delivery tracking and notifications to the API", () => {
  assert.match(compose, /automation:/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(automationDockerfile, /USER automation/);
  assert.match(automationRunner, /\/api\/jobs\/price-alerts/);
  assert.match(automationRunner, /\/api\/jobs\/deliveries/);
  assert.match(automationRunner, /\/api\/jobs\/notifications/);
  assert.match(automationRunner, /CRON_SECRET/);
  assert.match(deployWorkflow, /\.cron-secret/);
  assert.match(deployWorkflow, /automation_state/);
});
