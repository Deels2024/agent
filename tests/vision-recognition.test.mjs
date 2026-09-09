import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/recognize/route.ts", import.meta.url);
const runtimeUrl = new URL("../runtime-init/init_runtime.py", import.meta.url);

test("photo recognition uses the Agent low-latency vision contract", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /gpt-5\.6-luna/);
  assert.match(route, /reasoning:\s*\{\s*effort:\s*"none"\s*\}/);
  assert.match(route, /max_output_tokens:\s*220/);
  assert.match(route, /detail:\s*"low"/);
});

test("runtime model isolation does not inherit Buro BN_OPENAI_MODEL", async () => {
  const runtime = await readFile(runtimeUrl, "utf8");
  const modelSection = runtime.slice(runtime.indexOf('model, model_source = first(agent_values'), runtime.indexOf('atomic_write(OPENAI_DIR / "api_key"'));
  assert.match(modelSection, /OPENAI_VISION_MODEL/);
  assert.match(modelSection, /gpt-5\.6-luna/);
  assert.doesNotMatch(modelSection, /BN_OPENAI_MODEL/);
});
