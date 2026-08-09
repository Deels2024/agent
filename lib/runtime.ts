type RuntimeValues = Record<string, unknown>;

type RuntimeGlobal = typeof globalThis & { __BUYER_AGENT_ENV__?: RuntimeValues };

export function runtimeEnv(): RuntimeValues {
  return (globalThis as RuntimeGlobal).__BUYER_AGENT_ENV__ ?? {};
}

export function runtimeValue(name: string): string | undefined {
  const cloudflareValue = runtimeEnv()[name];
  if (typeof cloudflareValue === "string" && cloudflareValue.trim()) return cloudflareValue.trim();
  const processValue = typeof process !== "undefined" ? process.env[name] : undefined;
  return processValue?.trim() || undefined;
}

export function hasRuntimeValue(name: string) {
  return Boolean(runtimeValue(name));
}
