import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const initPath = fileURLToPath(new URL("../runtime-init/init_runtime.py", import.meta.url));

test("non-empty proxy values survive later empty duplicate placeholders", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-proxy-duplicate-"));
  const envFile = join(directory, "bureau.env");
  try {
    await writeFile(envFile, [
      "PROXY_ADDRESS=proxy.example.test",
      "PROXY_PORT=3128",
      "PROXY_LOGIN=test-user",
      "PROXY_PASSWORD=test-pass",
      "PROXY_SCHEME=http",
      "PROXY_ADDRESS=",
      "PROXY_PORT=",
      "PROXY_LOGIN=",
      "PROXY_PASSWORD=",
      "PROXY_SCHEME=",
      "",
    ].join("\n"));

    const code = `
import importlib.util, json, pathlib
spec=importlib.util.spec_from_file_location("init_runtime", ${JSON.stringify(initPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
values=m.parse_env_file(pathlib.Path(${JSON.stringify(envFile)}))
proxy,source=m.build_split_proxy(values)
print(json.dumps({"proxy":proxy,"source":source,"presence":{k:bool(values.get(k)) for k in ["PROXY_ADDRESS","PROXY_PORT","PROXY_LOGIN","PROXY_PASSWORD","PROXY_SCHEME"]}}))
`;
    const { stdout } = await execFileAsync("python3", ["-c", code]);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.proxy, "http://test-user:test-pass@proxy.example.test:3128");
    assert.equal(result.source, "PROXY_ADDRESS+PORT");
    assert.deepEqual(result.presence, {
      PROXY_ADDRESS: true,
      PROXY_PORT: true,
      PROXY_LOGIN: true,
      PROXY_PASSWORD: true,
      PROXY_SCHEME: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
