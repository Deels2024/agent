import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const initPath = fileURLToPath(new URL("../runtime-init/init_runtime.py", import.meta.url));
const gatewayPath = fileURLToPath(new URL("../openai-gateway/openai_gateway.py", import.meta.url));

test("proxy diagnostics expose presence and shape but never proxy credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-proxy-diagnostic-"));
  try {
    const shared = join(directory, "shared");
    const openai = join(directory, "openai");
    const envFile = join(directory, "bureau.env");
    const keyFile = join(directory, "openai_api_key");
    await mkdir(shared, { recursive: true });
    await mkdir(openai, { recursive: true });
    await writeFile(envFile, [
      "PROXY_ADDRESS=proxy.example.test:3128",
      "PROXY_LOGIN=secret-login",
      "PROXY_PASSWORD=secret-password",
      "PROXY_PORT=",
      "PROXY_SCHEME=http",
      "",
    ].join("\n"));
    await writeFile(keyFile, "sk-test\n");

    const code = `
import importlib.util, json, pathlib, os
spec=importlib.util.spec_from_file_location("init_runtime", ${JSON.stringify(initPath)})
i=importlib.util.module_from_spec(spec); spec.loader.exec_module(i)
i.SHARED_DIR.mkdir(parents=True,exist_ok=True); i.OPENAI_DIR.mkdir(parents=True,exist_ok=True)
i.ensure_secret(i.SHARED_DIR,"openai_gateway_token"); i.ensure_secret(i.SHARED_DIR,"cron_secret")
status=i.extract_openai_transport_configuration()
spec2=importlib.util.spec_from_file_location("gateway", ${JSON.stringify(gatewayPath)})
g=importlib.util.module_from_spec(spec2); spec2.loader.exec_module(g)
print(json.dumps({"extract":status,"gateway":g.local_status()}))
`;
    const { stdout } = await execFileAsync("python3", ["-c", code], {
      env: {
        ...process.env,
        RUNTIME_SHARED_DIR: shared,
        RUNTIME_OPENAI_DIR: openai,
        INTEGRATION_ENV_FILE: envFile,
        OPENAI_API_KEY_FILE: keyFile,
        OPENAI_GATEWAY_TOKEN_FILE: join(shared, "openai_gateway_token"),
        OPENAI_CONFIG_STATUS_FILE: join(shared, "openai_config_status.json"),
        OPENAI_PROXY_URL_FILE: join(openai, "proxy_url"),
        OPENAI_MODEL_FILE: join(openai, "model"),
        HTTPS_PROXY: "",
        https_proxy: "",
        ALL_PROXY: "",
        all_proxy: "",
        HTTP_PROXY: "",
        http_proxy: "",
      },
    });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.extract.proxyConfigured, true);
    assert.equal(result.extract.proxyComponentPresence.PROXY_ADDRESS, true);
    assert.equal(result.extract.proxyComponentPresence.PROXY_PORT, false);
    assert.equal(result.extract.proxyComponentShapes.PROXY_ADDRESS, "host_port");
    assert.equal(result.extract.proxyComponentShapes.PROXY_PORT, "empty");
    assert.equal(result.extract.proxyComponentShapes.PROXY_LOGIN, "set");
    assert.equal(result.gateway.proxyComponentShapes.PROXY_ADDRESS, "host_port");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("secret-login"), false);
    assert.equal(serialized.includes("secret-password"), false);
    assert.equal(serialized.includes("proxy.example.test"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
