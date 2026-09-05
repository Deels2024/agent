import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const initPath = fileURLToPath(new URL("../runtime-init/init_runtime.py", import.meta.url));
const gatewayPath = fileURLToPath(new URL("../openai-gateway/openai_gateway.py", import.meta.url));

async function inspectInitializer(envFile) {
  const code = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("runtime_init", ${JSON.stringify(initPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
values = module.parse_env_file()
print(json.dumps({"key": bool(module.first_value(values, "OPENAI_API_KEY", "BN_OPENAI_API_KEY")), "proxy": module.proxy_url(values), "model": module.first_value(values, "OPENAI_VISION_MODEL", "BN_OPENAI_MODEL") or "gpt-5.6-luna"}))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    env: { ...process.env, INTEGRATION_ENV_FILE: envFile },
  });
  return JSON.parse(stdout.trim());
}

async function inspectGateway(runtimeDir) {
  const code = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("gateway", ${JSON.stringify(gatewayPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(json.dumps({"key": bool(module.api_key()), "proxy": module.proxy_url(), "token": bool(module.gateway_token()), "model": module.model()}))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    env: {
      ...process.env,
      RUNTIME_SECRET_DIR: runtimeDir,
      OPENAI_API_KEY: "",
      OPENAI_PROXY_URL: "",
      OPENAI_GATEWAY_TOKEN: "",
      OPENAI_VISION_MODEL: "",
    },
  });
  return JSON.parse(stdout.trim());
}

test("root-only initializer reads a chmod 600 integration file with a full proxy URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-init-"));
  try {
    const envFile = join(directory, "bureau.env");
    await writeFile(envFile, "OPENAI_API_KEY=fake-key\nOPENAI_PROXY_URL=http://user:pass@127.0.0.1:3128\n");
    await chmod(envFile, 0o600);
    const result = await inspectInitializer(envFile);
    assert.equal(result.key, true);
    assert.equal(result.proxy, "http://user:pass@127.0.0.1:3128");
    assert.equal(result.model, "gpt-5.6-luna");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("initializer builds an authenticated proxy URL from split proxy settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-proxy-split-"));
  try {
    const envFile = join(directory, "bureau.env");
    await writeFile(envFile, [
      "OPENAI_API_KEY=fake-key",
      "PROXY_HOST=proxy.example.test",
      "PROXY_PORT=1080",
      "PROXY_TYPE=socks5",
      "PROXY_USER=user@example.test",
      "PROXY_PASSWORD=p a:ss",
      "BN_OPENAI_MODEL=gpt-5.6-luna",
      "",
    ].join("\n"));
    await chmod(envFile, 0o600);
    const result = await inspectInitializer(envFile);
    assert.equal(result.proxy, "socks5h://user%40example.test:p%20a%3Ass@proxy.example.test:1080");
    assert.equal(result.model, "gpt-5.6-luna");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unprivileged gateway needs only extracted runtime files, not the broad integration env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-runtime-files-"));
  try {
    await Promise.all([
      writeFile(join(directory, "openai_api_key"), "fake-key\n"),
      writeFile(join(directory, "openai_proxy_url"), "http://proxy.example.test:3128\n"),
      writeFile(join(directory, "openai_gateway_token"), "fake-token\n"),
      writeFile(join(directory, "openai_model"), "gpt-5.6-luna\n"),
    ]);
    const result = await inspectGateway(directory);
    assert.equal(result.key, true);
    assert.equal(result.token, true);
    assert.equal(result.proxy, "http://proxy.example.test:3128");
    assert.equal(result.model, "gpt-5.6-luna");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
