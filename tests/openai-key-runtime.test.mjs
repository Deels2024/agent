import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const initPath = fileURLToPath(new URL("../runtime-init/init_runtime.py", import.meta.url));

test("runtime initializer copies OPENAI_API_KEY from mounted env into private OpenAI volume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-openai-key-runtime-"));
  const shared = join(directory, "shared");
  const openai = join(directory, "openai");
  const envFile = join(directory, "bureau.env");
  try {
    await writeFile(envFile, [
      "OPENAI_API_KEY=fake-project-key",
      "PROXY_ADDRESS=proxy.example.test",
      "PROXY_PORT=3128",
      "PROXY_LOGIN=test-user",
      "PROXY_PASSWORD=test-pass",
      "PROXY_SCHEME=http",
      "",
    ].join("\n"));
    const code = `
import importlib.util, json, pathlib, os
spec = importlib.util.spec_from_file_location("runtime_init", ${JSON.stringify(initPath)})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.SHARED_DIR.mkdir(parents=True, exist_ok=True)
module.OPENAI_DIR.mkdir(parents=True, exist_ok=True)
status = module.extract_openai_transport_configuration()
print(json.dumps(status))
`;
    const { stdout } = await execFileAsync("python3", ["-c", code], {
      env: {
        ...process.env,
        RUNTIME_SHARED_DIR: shared,
        RUNTIME_OPENAI_DIR: openai,
        INTEGRATION_ENV_FILE: envFile,
      },
    });
    const status = JSON.parse(stdout.trim());
    assert.equal(status.apiKeyConfigured, true);
    assert.equal(status.apiKeySource, "OPENAI_API_KEY");
    assert.equal(status.proxyConfigured, true);
    assert.equal((await readFile(join(openai, "api_key"), "utf8")).trim(), "fake-project-key");
    assert.equal((await readFile(join(openai, "proxy_url"), "utf8")).includes("proxy.example.test"), true);
    assert.equal(JSON.stringify(status).includes("fake-project-key"), false);
    assert.equal(JSON.stringify(status).includes("test-pass"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
