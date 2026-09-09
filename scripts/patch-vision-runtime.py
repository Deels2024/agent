from pathlib import Path

# 1) Agent owns its vision model. Never inherit Buro's model.
runtime_path = Path('runtime-init/init_runtime.py')
runtime = runtime_path.read_text()
old_model = '''    model, model_source = first(agent_values, "OPENAI_VISION_MODEL")
    if not model:
        model, model_source = first(integration_values, "BN_OPENAI_MODEL")
    model = model or "gpt-5.6-luna"
    model_source = model_source or "default"
'''
new_model = '''    model, model_source = first(agent_values, "OPENAI_VISION_MODEL")
    model = model or "gpt-5.6-luna"
    model_source = model_source or "default"
'''
if old_model not in runtime:
    raise SystemExit('runtime model fallback block not found')
runtime = runtime.replace(old_model, new_model, 1)
runtime_path.write_text(runtime)

# 2) Keep vision recognition fast and deterministic.
route_path = Path('app/api/recognize/route.ts')
route = route_path.read_text()
route = route.replace('''    model: runtimeValue("OPENAI_VISION_MODEL") || "gpt-5.6-luna",
    max_output_tokens: 350,
''', '''    model: runtimeValue("OPENAI_VISION_MODEL") || "gpt-5.6-luna",
    reasoning: { effort: "none" },
    max_output_tokens: 220,
''', 1)
route = route.replace('{ type: "input_image", image_url: imageDataUrl, detail: "auto" }', '{ type: "input_image", image_url: imageDataUrl, detail: "low" }', 1)
route_path.write_text(route)

# 3) Surface only allowlisted transport diagnostics from the gateway.
gateway_path = Path('openai-gateway/openai_gateway.py')
gateway = gateway_path.read_text()
marker = '''def set_state(payload: dict[str, object]) -> None:
'''
helper = '''SAFE_TRANSPORT_ERROR_CODES = {
    "proxy_timeout", "proxy_dns_error", "proxy_connection_error", "proxy_transport_error",
    "direct_timeout", "direct_dns_error", "direct_connection_error", "direct_transport_error",
    "invalid_upstream_status",
}


def safe_transport_error_code(exc: Exception) -> str:
    code = str(exc).strip()
    return code if code in SAFE_TRANSPORT_ERROR_CODES else "gateway_transport_error"


'''
if 'SAFE_TRANSPORT_ERROR_CODES' not in gateway:
    if marker not in gateway:
        raise SystemExit('gateway state marker not found')
    gateway = gateway.replace(marker, helper + marker, 1)
old_except = '''        try:
            status, payload = curl_request("POST", "/v1/responses", body=body)
        except Exception:
            start_probe_if_needed(True)
            self._json(502, {"error": "openai_upstream_unavailable"})
            return
'''
new_except = '''        try:
            status, payload = curl_request("POST", "/v1/responses", body=body)
        except Exception as exc:
            start_probe_if_needed(True)
            code = safe_transport_error_code(exc)
            response_status = 504 if code.endswith("_timeout") else 502
            self._json(response_status, {"error": {"type": "gateway_transport_error", "code": code}})
            return
'''
if old_except not in gateway:
    raise SystemExit('gateway POST exception block not found')
gateway = gateway.replace(old_except, new_except, 1)
gateway = gateway.replace('server_version = "BuyerAgentOpenAIGateway/1.7"', 'server_version = "BuyerAgentOpenAIGateway/1.8"', 1)
gateway_path.write_text(gateway)

# 4) Update runtime/gateway regression expectations.
test_path = Path('tests/openai-gateway.test.mjs')
test = test_path.read_text()
test = test.replace('''  await writeFile(join(shared, "openai_config_status.json"), JSON.stringify({ apiKeySource: "agent-env:OPENAI_API_KEY", proxySource: "missing", modelSource: "BN_OPENAI_MODEL" }));
''', '''  await writeFile(join(shared, "openai_config_status.json"), JSON.stringify({ apiKeySource: "agent-env:OPENAI_API_KEY", proxySource: "missing", modelSource: "default" }));
''', 1)
test = test.replace('''    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6");
''', '''    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6-luna");
    assert.equal(result.status.modelSource, "default");
''', 1)
append = r'''

test("Agent vision model never falls back to Buro BN_OPENAI_MODEL", async () => {
  const result = await extractTransport("BN_OPENAI_MODEL=gpt-5.6-sol\nPROXY_ADDRESS=proxy.example.test\nPROXY_PORT=3128\n");
  try {
    assert.equal((await readFile(join(result.openai, "model"), "utf8")).trim(), "gpt-5.6-luna");
    assert.equal(result.status.modelSource, "default");
  } finally {
    await rm(result.directory, { recursive: true, force: true });
  }
});

test("gateway exposes only allowlisted transport error codes", async () => {
  const code = `
import importlib.util, json
spec=importlib.util.spec_from_file_location("gateway", ${JSON.stringify(gatewayPath)})
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(json.dumps({
  "timeout": m.safe_transport_error_code(RuntimeError("proxy_timeout")),
  "unknown": m.safe_transport_error_code(RuntimeError("secret-proxy-value")),
}))
`;
  const { stdout } = await execFileAsync("python3", ["-c", code], { env: { ...process.env, ...clearedProxyEnv } });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.timeout, "proxy_timeout");
  assert.equal(result.unknown, "gateway_transport_error");
  assert.equal(JSON.stringify(result).includes("secret-proxy-value"), false);
});
'''
if 'Agent vision model never falls back' not in test:
    test += append
test_path.write_text(test)

# 5) Add a route-level contract test for the fast vision request.
vision_test = Path('tests/vision-recognition.test.mjs')
vision_test.write_text(r'''import assert from "node:assert/strict";
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
''')
