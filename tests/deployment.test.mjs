import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

const [dockerfile, compose, startScript, runtimeConfigScript] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../docker-compose.server.yml", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-docker.sh", import.meta.url), "utf8"),
  readFile(new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url), "utf8"),
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
  assert.match(compose, /worker_state:\/app\/\.wrangler/);
  assert.match(compose, /AUTH_MODE: \$\{AUTH_MODE:-standalone\}/);
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
      env: { ...process.env, ADMIN_EMAILS: "admin@example.test", PAYMENT_WEBHOOK_SECRET: "test-secret" },
    });
    const generated = JSON.parse(await readFile(target, "utf8"));
    assert.equal(generated.main, "index.js");
    assert.equal(generated.vars.EXISTING, "kept");
    assert.equal(generated.vars.ADMIN_EMAILS, "admin@example.test");
    assert.equal(generated.vars.PAYMENT_WEBHOOK_SECRET, "test-secret");
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
    "DELIVERY_API_KEY",
    "DELIVERY_WEBHOOK_SECRET",
    "NOTIFICATION_WEBHOOK_SECRET",
    "CRON_SECRET",
    "LEGAL_OPERATOR_REQUISITES_CONFIRMED",
    "PRIVACY_PROCESSORS_CONFIRMED",
    "PUBLIC_ACCESS_ENABLED",
    "AUTH_MODE",
  ]) {
    assert.match(compose, new RegExp(`${setting}: \\\${${setting}`));
  }
});
