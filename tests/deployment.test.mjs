import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const [dockerfile, dockerignore, compose, startScript, runtimeConfigScript, openaiDockerfile, openaiGateway, runtimeInitDockerfile, runtimeInit, automationDockerfile, automationRunner, deployWorkflow] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  readFile(new URL("../docker-compose.server.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-docker.sh", import.meta.url), "utf8"),
  readFile(new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile.openai-gateway", import.meta.url), "utf8"),
  readFile(new URL("../openai-gateway/openai_gateway.py", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile.runtime-init", import.meta.url), "utf8"),
  readFile(new URL("../runtime-init/init_runtime.py", import.meta.url), "utf8"),
  readFile(new URL("../Dockerfile.automation", import.meta.url), "utf8"),
  readFile(new URL("../automation/runner.py", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
]);

test("Docker runtime provides persistent D1 and optimized immutable application files", () => {
  assert.match(dockerfile, /CMD \["npm", "run", "start:docker"\]/);
  assert.match(dockerfile, /COPY --chown=node:node --from=build \/app \/app/);
  assert.doesNotMatch(dockerfile, /chown -R node:node \/app/);
  assert.match(startScript, /wrangler dev/);
  assert.match(startScript, /--persist-to/);
  assert.match(startScript, /create-runtime-wrangler-config\.mjs/);
  assert.match(compose, /worker_state:\/app\/\.wrangler/);
  assert.match(compose, /runtime_state:\/app\/\.sites-runtime/);
});

test("runtime Worker config receives protected environment without changing paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buyer-agent-runtime-config-"));
  const source = join(directory, "wrangler.json");
  const target = join(directory, "wrangler.runtime.json");
  try {
    await writeFile(source, JSON.stringify({ main: "index.js", vars: { EXISTING: "kept" } }));
    await execFileAsync(process.execPath, [new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url).pathname, source, target], {
      env: { ...process.env, ADMIN_EMAILS: "admin@example.test", OPENAI_BASE_URL: "http://openai-gateway:8080", OPENAI_GATEWAY_TOKEN: "gateway-test", APISHIP_API_TOKEN: "delivery-test", CRON_SECRET: "cron-test" },
    });
    const generated = JSON.parse(await readFile(target, "utf8"));
    assert.equal(generated.vars.OPENAI_BASE_URL, "http://openai-gateway:8080");
    assert.equal(generated.vars.OPENAI_GATEWAY_TOKEN, "gateway-test");
    assert.equal(generated.vars.APISHIP_API_TOKEN, "delivery-test");
    assert.equal(generated.vars.CRON_SECRET, "cron-test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("root runtime initializer extracts only OpenAI secrets and shared tokens", () => {
  const initSection = compose.match(/\n  runtime-init:[\s\S]*?\n  openai-gateway:/)?.[0] ?? "";
  assert.match(initSection, /\/opt\/bureau_nakhodok_suite\/\.env:\/run\/integration\/bureau\.env:ro/);
  assert.match(initSection, /runtime_shared:\/run\/shared/);
  assert.match(initSection, /runtime_openai:\/run\/openai/);
  assert.match(runtimeInitDockerfile, /openai_config_status\.json/);
  assert.match(runtimeInit, /openai_gateway_token/);
  assert.match(runtimeInit, /cron_secret/);
  assert.match(runtimeInit, /api_key/);
  assert.match(runtimeInit, /proxy_url/);
  assert.match(runtimeInit, /candidateProxyKeys/);
  assert.match(runtimeInit, /signal\.pause\(\)/);
});

test("OpenAI API key and proxy never enter the application container", () => {
  const gatewaySection = compose.match(/\n  openai-gateway:[\s\S]*?\n  app:/)?.[0] ?? "";
  const appSection = compose.match(/\n  app:[\s\S]*?\n  automation:/)?.[0] ?? "";
  assert.match(gatewaySection, /runtime_openai:\/run\/openai:ro/);
  assert.match(gatewaySection, /OPENAI_API_KEY_FILE: \/run\/openai\/api_key/);
  assert.match(gatewaySection, /OPENAI_PROXY_URL_FILE: \/run\/openai\/proxy_url/);
  assert.match(gatewaySection, /OPENAI_GATEWAY_TOKEN_FILE: \/run\/shared\/openai_gateway_token/);
  assert.doesNotMatch(gatewaySection, /\/opt\/bureau_nakhodok_suite\/\.env/);
  assert.doesNotMatch(appSection, /runtime_openai/);
  assert.doesNotMatch(appSection, /OPENAI_API_KEY/);
  assert.doesNotMatch(appSection, /OPENAI_PROXY_URL/);
  assert.match(appSection, /OPENAI_BASE_URL: http:\/\/openai-gateway:8080/);
  assert.match(openaiDockerfile, /USER gateway/);
});

test("gateway remains available while exposing safe upstream readiness", () => {
  assert.match(openaiGateway, /\/ready/);
  assert.match(openaiGateway, /upstreamReady/);
  assert.match(openaiGateway, /candidateProxyKeys/);
  assert.match(openaiGateway, /threading\.Thread/);
  assert.match(openaiGateway, /proxy_timeout/);
  assert.match(openaiGateway, /request_payload\["model"\] = model\(\)/);
  assert.doesNotMatch(openaiGateway, /print\([^\n]*api_key\(\)/);
});

test("production app is reachable only through the host reverse proxy", () => {
  assert.match(compose, /127\.0\.0\.1:8788:8788/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8788:8788/);
});

test("background automation reads only the shared cron secret", () => {
  const automationSection = compose.match(/\n  automation:[\s\S]*?\nvolumes:/)?.[0] ?? "";
  assert.match(automationSection, /CRON_SECRET_FILE: \/run\/shared\/cron_secret/);
  assert.match(automationSection, /runtime_shared:\/run\/shared:ro/);
  assert.doesNotMatch(automationSection, /runtime_openai/);
  assert.match(automationDockerfile, /automation\.heartbeat/);
  assert.match(automationRunner, /\/api\/jobs\/price-alerts/);
});

test("forced-command deploy validates the final production health payload", () => {
  assert.match(deployWorkflow, /server-side forced command/);
  assert.match(deployWorkflow, /ssh -T/);
  assert.match(deployWorkflow, /Verified health/);
  assert.match(deployWorkflow, /photoRecognition/);
  assert.match(deployWorkflow, /backgroundAutomation/);
  assert.match(deployWorkflow, /database/);
  assert.doesNotMatch(deployWorkflow, /bash -s/);
  assert.doesNotMatch(deployWorkflow, /docker compose/);
});

test("Docker build context excludes all server-only secret files", () => {
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.deploy\.runtime\.env$/m);
  assert.match(dockerignore, /^\.openai-gateway-token$/m);
  assert.match(dockerignore, /^\.cron-secret$/m);
});

test("server compose still passes configured non-OpenAI production integrations", () => {
  for (const setting of [
    "ADMIN_EMAILS", "CREDENTIAL_ENCRYPTION_KEY", "PAYMENT_API_KEY", "PAYMENT_WEBHOOK_SECRET",
    "KYC_API_KEY", "APISHIP_API_TOKEN", "DELIVERY_API_KEY", "DELIVERY_WEBHOOK_SECRET",
    "NOTIFICATION_WEBHOOK_SECRET", "LEGAL_OPERATOR_REQUISITES_CONFIRMED", "PRIVACY_PROCESSORS_CONFIRMED",
    "PUBLIC_ACCESS_ENABLED", "AUTH_MODE", "EMAIL_VERIFICATION_REQUIRED",
  ]) assert.match(compose, new RegExp(`${setting}: \\\${${setting}`));
  assert.match(runtimeConfigScript, /APISHIP_API_TOKEN/);
});
