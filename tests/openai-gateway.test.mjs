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

async function extractConfiguration(contents, buroKey = "") {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-extractor-"));
  const shared = join(directory, "shared");
  const openai = join(directory, "openai");
  const envFile = join(directory, "bureau.env");
  const buroDir = join(directory, "bureau-openai");
  const buroKeyFile = join(buroDir, "openai_api_key");
  await mkdir(buroDir, { recursive: true });
  await writeFile(envFile, contents);
  if (buroKey) await writeFile(buroKeyFile, buroKey);
  const code = `
import importlib.util, json
spec=importlib.util.spec_from_file_location("init_runtime", ${JSON.stringify(initPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.SHARED_DIR.mkdir(parents=True,exist_ok=True); m.OPENAI_DIR.mkdir(parents=True,exist_ok=True)
m.ensure_secret(m.SHARED_DIR,"openai_gateway_token"); m.ensure_secret(m.SHARED_DIR,"cron_secret")
print(json.dumps(m.extract_openai_configuration()))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    env: {
      ...process.env,
      RUNTIME_SHARED_DIR: shared,
      RUNTIME_OPENAI_DIR: openai,
      INTEGRATION_ENV_FILE: envFile,
      BURO_OPENAI_KEY_FILE: buroKeyFile,
    },
  });
  return { directory, shared, openai, status: JSON.parse(stdout.trim()) };
}

test("root extractor copies only key/proxy/model from a full proxy URL configuration", async () => {
  const result = await extractConfiguration("OPENAI_API_KEY=fake-key\nOPENAI_PROXY_URL=http://user:pass@127.0.0.1:3128\n");
  try {
    assert.equal(result.status.apiKeyConfigured, true);
    assert.equal(result.status.proxyConfigured, true);
    assert.equal(result.status.apiKeySource, "OPENAI_API_KEY");
    assert.equal(result.status.proxySource, "OPENAI_PROXY_URL");
    assert.equal((await readFile(join(result.openai, "api_key"), "utf8")).trim(), "fake-key");
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "http://user:pass@127.0.0.1:3128");
    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6-luna");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("root extractor reuses the protected Buro OpenAI secret volume when env has no key", async () => {
  const result = await extractConfiguration("BN_OPENAI_MODEL=gpt-5.6-luna\n", "sk-test-protected-key");
  try {
    assert.equal(result.status.apiKeyConfigured, true);
    assert.equal(result.status.apiKeySource, "bureau-nakhodok_openai_secret/openai_api_key");
    assert.equal(result.status.buroSecretFilePresent, true);
    assert.equal((await readFile(join(result.openai, "api_key"), "utf8")).trim(), "sk-test-protected-key");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("root extractor builds production proxy URL from PROXY_ADDRESS LOGIN PORT SCHEME PASSWORD", async () => {
  const result = await extractConfiguration([
    "PROXY_ADDRESS=proxy.example.test",
    "PROXY_PORT=1080",
    "PROXY_SCHEME=socks5",
    "PROXY_LOGIN=user@example.test",
    "PROXY_PASSWORD=p a:ss",
    "BN_OPENAI_MODEL=gpt-5.6-luna",
    "",
  ].join("\n"), "sk-test-protected-key");
  try {
    assert.equal(result.status.proxyConfigured, true);
    assert.equal(result.status.proxySource, "PROXY_ADDRESS+PORT");
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "socks5h://user%40example.test:p%20a%3Ass@proxy.example.test:1080");
    assert.ok(result.status.candidateProxyKeys.includes("PROXY_ADDRESS"));
    assert.ok(result.status.candidateProxyKeys.includes("PROXY_LOGIN"));
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("non-root gateway consumes extracted files and exposes only safe configuration status", async () => {
  const result = await extractConfiguration("OPENAI_PROXY_URL=http://127.0.0.1:3128\n", "sk-test-protected-key");
  try {
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
        OPENAI_API_KEY: "",
        OPENAI_PROXY_URL: "",
        OPENAI_GATEWAY_TOKEN: "",
      },
    });
    const status = JSON.parse(stdout.trim());
    assert.equal(status.apiKeyConfigured, true);
    assert.equal(status.proxyConfigured, true);
    assert.equal(status.gatewayTokenConfigured, true);
    assert.equal(JSON.stringify(status).includes("sk-test-protected-key"), false);
    assert.equal(JSON.stringify(status).includes("http://127.0.0.1:3128"), false);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});
