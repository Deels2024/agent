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

async function extract(contents) {
  const directory = await mkdtemp(join(tmpdir(), "agent-proxy-address-"));
  const shared = join(directory, "shared");
  const openai = join(directory, "openai");
  const envFile = join(directory, "bureau.env");
  await writeFile(envFile, contents);
  const code = `
import importlib.util, json
spec=importlib.util.spec_from_file_location("init_runtime", ${JSON.stringify(initPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.SHARED_DIR.mkdir(parents=True,exist_ok=True); m.OPENAI_DIR.mkdir(parents=True,exist_ok=True)
print(json.dumps(m.extract_openai_transport_configuration()))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], {
    env: { ...process.env, RUNTIME_SHARED_DIR: shared, RUNTIME_OPENAI_DIR: openai, INTEGRATION_ENV_FILE: envFile },
  });
  return { directory, openai, status: JSON.parse(stdout.trim()) };
}

test("PROXY_ADDRESS may contain host:port when PROXY_PORT is blank", async () => {
  const result = await extract([
    "PROXY_ADDRESS=proxy.example.test:1080",
    "PROXY_PORT=",
    "PROXY_SCHEME=socks5",
    "PROXY_LOGIN=user",
    "PROXY_PASSWORD=pass",
    "",
  ].join("\n"));
  try {
    assert.equal(result.status.proxyConfigured, true);
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "socks5h://user:pass@proxy.example.test:1080");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("PROXY_ADDRESS may contain a full proxy URL when PROXY_PORT is blank", async () => {
  const result = await extract([
    "PROXY_ADDRESS=http://embedded:secret@proxy.example.test:3128",
    "PROXY_PORT=",
    "PROXY_LOGIN=",
    "PROXY_PASSWORD=",
    "",
  ].join("\n"));
  try {
    assert.equal(result.status.proxyConfigured, true);
    assert.equal(result.status.proxySource, "PROXY_ADDRESS_URL");
    assert.equal((await readFile(join(result.openai, "proxy_url"), "utf8")).trim(), "http://embedded:secret@proxy.example.test:3128");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("proxy diagnostics reveal only whether production components are populated", async () => {
  const result = await extract([
    "PROXY_ADDRESS=proxy.example.test",
    "PROXY_PORT=",
    "PROXY_SCHEME=http",
    "PROXY_LOGIN=user",
    "PROXY_PASSWORD=secret-value",
    "",
  ].join("\n"));
  try {
    assert.equal(result.status.proxyConfigured, false);
    assert.deepEqual(result.status.proxyComponentPresence, {
      PROXY_ADDRESS: true,
      PROXY_LOGIN: true,
      PROXY_PASSWORD: true,
      PROXY_PORT: false,
      PROXY_SCHEME: true,
    });
    assert.equal(JSON.stringify(result.status).includes("proxy.example.test"), false);
    assert.equal(JSON.stringify(result.status).includes("secret-value"), false);
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});
