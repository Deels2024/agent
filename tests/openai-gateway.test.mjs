import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const initPath = fileURLToPath(new URL("../runtime-init/init_runtime.py", import.meta.url));
const gatewayPath = fileURLToPath(new URL("../openai-gateway/openai_gateway.py", import.meta.url));

async function extractTransport(contents) {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-transport-"));
  const shared = join(directory, "shared");
  const openai = join(directory, "openai");
  const envFile = join(directory, "bureau.env");
  await writeFile(envFile, contents);
  const code = `
import importlib.util, json
spec=importlib.util.spec_from_file_location("init_runtime", ${JSON.stringify(initPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.SHARED_DIR.mkdir(parents=True,exist_ok=True); m.OPENAI_DIR.mkdir(parents=True,exist_ok=True)
m.ensure_secret(m.SHARED_DIR,"openai_gateway_token"); m.ensure_secret(m.SHARED_DIR,"cron_secret")
print(json.dumps(m.extract_openai_transport_configuration()))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    env: { ...process.env, RUNTIME_SHARED_DIR: shared, RUNTIME_OPENAI_DIR: openai, INTEGRATION_ENV_FILE: envFile },
  });
  return { directory, shared, openai, status: JSON.parse(stdout.trim()) };
}

test("root initializer extracts only proxy and model, never the OpenAI API key", async () => {
  const result = await extractTransport("OPENAI_API_KEY=must-not-be-copied\nOPENAI_PROXY_URL=http://user:pass@127.0.0.1:3128\n");
  try {
    assert.equal(result.status.proxyConfigured, true);
    assert.equal(result.status.proxySource, "OPENAI_PROXY_URL");
    assert.equal(result.status.apiKeySource, "bureau-nakhodok_openai_secret/openai_api_key");
    await assert.rejects(readFile(join(result.openai, "api_key"), "utf8"));
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "http://user:pass@127.0.0.1:3128");
    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6-luna");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("root initializer builds production proxy URL from PROXY_ADDRESS LOGIN PORT SCHEME PASSWORD", async () => {
  const result = await extractTransport([
    "PROXY_ADDRESS=proxy.example.test",
    "PROXY_PORT=1080",
    "PROXY_SCHEME=socks5",
    "PROXY_LOGIN=user@example.test",
    "PROXY_PASSWORD=p a:ss",
    "BN_OPENAI_MODEL=gpt-5.6",
    "",
  ].join("\n"));
  try {
    assert.equal(result.status.proxyConfigured, true);
    assert.equal(result.status.proxySource, "PROXY_ADDRESS+PORT");
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "socks5h://user%40example.test:p%20a%3Ass@proxy.example.test:1080");
    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6");
    assert.ok(result.status.candidateProxyKeys.includes("PROXY_ADDRESS"));
    assert.ok(result.status.candidateProxyKeys.includes("PROXY_LOGIN"));
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("gateway reads the Buro-owned key directly while consuming Agent transport files", async () => {
  const result = await extractTransport("OPENAI_PROXY_URL=http://127.0.0.1:3128\nBN_OPENAI_MODEL=gpt-5.6\n");
  try {
    const buroDir = join(result.directory, "bureau-openai");
    const keyFile = join(buroDir, "openai_api_key");
    await mkdir(buroDir, { recursive: true });
    await writeFile(keyFile, "sk-test-protected-key\n", { mode: 0o400 });
    const code = `
import importlib.util, json
spec=importlib.util.spec_from_file_location("gateway", ${JSON.stringify(gatewayPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps(m.local_status()))
`;
    const { stdout } = await execFileAsync("python3", ["-c", code], {
      env: {
        ...process.env,
        RUNTIME_SHARED_DIR: result.shared,
        RUNTIME_OPENAI_DIR: result.openai,
        OPENAI_API_KEY_FILE: keyFile,
        OPENAI_API_KEY: "",
        OPENAI_PROXY_URL: "",
        OPENAI_GATEWAY_TOKEN: "",
      },
    });
    const status = JSON.parse(stdout.trim());
    assert.equal(status.apiKeyConfigured, true);
    assert.equal(status.apiKeySource, "bureau-nakhodok_openai_secret/openai_api_key");
    assert.equal(status.proxyConfigured, true);
    assert.equal(status.gatewayTokenConfigured, true);
    assert.equal(JSON.stringify(status).includes("sk-test-protected-key"), false);
    assert.equal(JSON.stringify(status).includes("http://127.0.0.1:3128"), false);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});
