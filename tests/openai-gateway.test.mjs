import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const gatewayPath = fileURLToPath(new URL("../openai-gateway/openai_gateway.py", import.meta.url));
const clearedProxyEnvironment = {
  OPENAI_PROXY_URL: "", BN_OPENAI_PROXY_URL: "", OPENAI_PROXY: "", OPENAI_HTTPS_PROXY: "",
  HTTPS_PROXY: "", https_proxy: "", ALL_PROXY: "", all_proxy: "", HTTP_PROXY: "", http_proxy: "",
  PROXY_URL: "", PROXY: "", OUTBOUND_PROXY_URL: "", OUTBOUND_PROXY: "",
};

async function inspectGateway(envFile, tokenFile, extraEnv = {}) {
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
      ...clearedProxyEnvironment,
      INTEGRATION_ENV_FILE: envFile,
      OPENAI_GATEWAY_TOKEN_FILE: tokenFile,
      OPENAI_API_KEY: "",
      ...extraEnv,
    },
  });
  return JSON.parse(stdout.trim());
}

test("gateway reads API key and a full proxy URL from the mounted integration env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-gateway-"));
  try {
    const envFile = join(directory, "bureau.env");
    const tokenFile = join(directory, "token");
    await writeFile(envFile, "OPENAI_API_KEY=fake-key\nOPENAI_PROXY_URL=http://user:pass@127.0.0.1:3128\n");
    await writeFile(tokenFile, "fake-token\n");
    const result = await inspectGateway(envFile, tokenFile);
    assert.equal(result.key, true);
    assert.equal(result.token, true);
    assert.equal(result.proxy, "http://user:pass@127.0.0.1:3128");
    assert.equal(result.model, "gpt-5.6-luna");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("gateway builds an authenticated proxy URL from split proxy settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-proxy-split-"));
  try {
    const envFile = join(directory, "bureau.env");
    const tokenFile = join(directory, "token");
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
    await writeFile(tokenFile, "fake-token\n");
    const result = await inspectGateway(envFile, tokenFile);
    assert.equal(result.proxy, "socks5h://user%40example.test:p%20a%3Ass@proxy.example.test:1080");
    assert.equal(result.model, "gpt-5.6-luna");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
