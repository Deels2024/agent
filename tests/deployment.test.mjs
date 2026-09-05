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
  assert.match(startScript, /dist\/server\/wrangler\.json/);
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
    assert.equal(generated.main, "index.js");
    assert.equal(generated.vars.EXISTING, "kept");
    assert.equal(generated.vars.ADMIN_EMAILS, "admin@example.test");
    assert.equal(generated.vars.OPENAI_BASE_URL, "http://openai-gateway:8080");
    assert.equal(generated.vars.OPENAI_GATEWAY_TOKEN, "gateway-test");
    assert.equal(generated.vars.APISHIP_API_TOKEN, "delivery-test");
    assert.equal(generated.vars.CRON_SECRET, "cron-test");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("root-only runtime initializer extracts narrow OpenAI values and generates internal secrets", () => {
  const initSection = compose.match(/\n  runtime-init:[\s\S]*?\n  openai-gateway:/)?.[0] ?? "";
  assert.match(initSection, /\/opt\/bureau_nakhodok_suite\/\.env:\/run\/integration\/bureau\.env:ro/);
  assert.match(initSection, /runtime_secrets:\/run\/runtime/);
  assert.match(initSection, /restart: "on-failure:3"/);
  assert.match(runtimeInitDockerfile, /openai_api_key/);
  assert.match(runtimeInitDockerfile, /openai_proxy_url/);
  assert.match(runtimeInit, /OPENAI_API_KEY/);
  assert.match(runtimeInit, /proxy_url\(values\)/);
  assert.match(runtimeInit, /openai_gateway_token/);
  assert.match(runtimeInit, /cron_secret/);
  assert.match(runtimeInit, /write_value\("openai_api_key", api_key\)/);
  assert.match(runtimeInit, /write_value\("openai_proxy_url", proxy\)/);
  assert.match(runtimeInit, /write_value\("openai_model", model\)/);
  assert.match(runtimeInit, /signal\.pause\(\)/);
});

test("unprivileged OpenAI gateway sees only extracted runtime files and must preflight the proxy", () => {
  const gatewaySection = compose.match(/\n  openai-gateway:[\s\S]*?\n  app:/)?.[0] ?? "";
  const appSection = compose.match(/\n  app:[\s\S]*?\n  automation:/)?.[0] ?? "";
  assert.doesNotMatch(gatewaySection, /\/opt\/bureau_nakhodok_suite/);
  assert.match(gatewaySection, /OPENAI_API_KEY_FILE: \/run\/runtime\/openai_api_key/);
  assert.match(gatewaySection, /OPENAI_PROXY_URL_FILE: \/run\/runtime\/openai_proxy_url/);
  assert.match(gatewaySection, /OPENAI_GATEWAY_TOKEN_FILE: \/run\/runtime\/openai_gateway_token/);
  assert.match(gatewaySection, /OPENAI_VISION_MODEL_FILE: \/run\/runtime\/openai_model/);
  assert.match(gatewaySection, /GATEWAY_REQUIRE_UPSTREAM: "true"/);
  assert.match(gatewaySection, /restart: "on-failure:3"/);
  assert.doesNotMatch(gatewaySection, /ports:/);
  assert.doesNotMatch(appSection, /OPENAI_API_KEY:/);
  assert.doesNotMatch(appSection, /OPENAI_PROXY_URL:/);
  assert.match(appSection, /OPENAI_BASE_URL: http:\/\/openai-gateway:8080/);
  assert.match(openaiDockerfile, /USER gateway/);
  assert.match(openaiGateway, /OPENAI_API_KEY_FILE/);
  assert.match(openaiGateway, /OPENAI_PROXY_URL_FILE/);
  assert.match(openaiGateway, /--proxy/);
  assert.match(openaiGateway, /POST", "\/v1\/responses"/);
  assert.match(openaiGateway, /if require_upstream and check_upstream\(\) != 0/);
  assert.match(openaiGateway, /request_payload\["model"\] = model\(\)/);
});

test("application startup injects private gateway and cron tokens into workerd only at runtime", () => {
  assert.match(startScript, /OPENAI_GATEWAY_TOKEN_FILE/);
  assert.match(startScript, /CRON_SECRET_FILE/);
  assert.match(startScript, /export OPENAI_GATEWAY_TOKEN=/);
  assert.match(startScript, /export CRON_SECRET=/);
  assert.match(startScript, /Runtime secrets are empty/);
  assert.match(compose, /runtime_secrets:\/run\/runtime:ro/);
});

test("production app is reachable only through the host reverse proxy", () => {
  assert.match(compose, /127\.0\.0\.1:8788:8788/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:8788:8788/);
});

test("background automation reads the same private cron secret and has a heartbeat health check", () => {
  const automationSection = compose.match(/\n  automation:[\s\S]*?\nvolumes:/)?.[0] ?? "";
  assert.match(automationSection, /CRON_SECRET_FILE: \/run\/runtime\/cron_secret/);
  assert.match(automationSection, /runtime_secrets:\/run\/runtime:ro/);
  assert.match(automationSection, /condition: service_healthy/);
  assert.match(automationDockerfile, /automation\.heartbeat/);
  assert.match(automationRunner, /CRON_SECRET_FILE/);
  assert.match(automationRunner, /\/api\/jobs\/price-alerts/);
  assert.match(automationRunner, /\/api\/jobs\/deliveries/);
  assert.match(automationRunner, /\/api\/jobs\/notifications/);
  assert.match(automationRunner, /ProxyHandler\(\{\}\)/);
});

test("forced-command GitHub deploy intentionally sends no ignored remote shell script", () => {
  assert.match(deployWorkflow, /server-side forced command/);
  assert.match(deployWorkflow, /ServerAliveInterval=30/);
  assert.match(deployWorkflow, /ssh -T/);
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
  ]) {
    assert.match(compose, new RegExp(`${setting}: \\\${${setting}`));
  }
  assert.match(runtimeConfigScript, /APISHIP_API_TOKEN/);
});
