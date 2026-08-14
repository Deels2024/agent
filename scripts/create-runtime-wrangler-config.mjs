import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const [sourceArgument, targetArgument] = process.argv.slice(2);
if (!sourceArgument || !targetArgument) {
  throw new Error("Usage: create-runtime-wrangler-config.mjs <source> <target>");
}

const source = resolve(sourceArgument);
const target = resolve(targetArgument);
if (dirname(source) !== dirname(target)) {
  throw new Error("Runtime config must stay beside the built config so relative Worker paths remain valid");
}

const applicationVariables = [
  "AUTH_MODE",
  "EMAIL_VERIFICATION_REQUIRED",
  "OPENAI_API_KEY",
  "OPENAI_VISION_MODEL",
  "WB_API_TOKEN",
  "WB_CLIENT_SECRET",
  "OZON_CLIENT_ID",
  "OZON_API_KEY",
  "YANDEX_MARKET_API_KEY",
  "YANDEX_MARKET_BUSINESS_ID",
  "ADMIN_EMAILS",
  "CREDENTIAL_ENCRYPTION_KEY",
  "PAYMENT_PROVIDER",
  "PAYMENT_MODEL",
  "PAYMENT_API_URL",
  "PAYMENT_API_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_RETURN_URL",
  "KYC_PROVIDER",
  "KYC_API_KEY",
  "DELIVERY_PROVIDER",
  "DELIVERY_API_KEY",
  "DELIVERY_WEBHOOK_SECRET",
  "NOTIFICATION_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_SECRET",
  "CRON_SECRET",
  "MONITORING_WEBHOOK_URL",
  "BACKUP_POLICY_CONFIRMED",
  "LEGAL_OPERATOR_REQUISITES_CONFIRMED",
  "PRIVACY_PROCESSORS_CONFIRMED",
  "PUBLIC_APP_URL",
  "PUBLIC_ACCESS_ENABLED",
];

const config = JSON.parse(await readFile(source, "utf8"));
const vars = { ...(config.vars ?? {}) };
for (const name of applicationVariables) {
  if (typeof process.env[name] === "string") vars[name] = process.env[name];
}

const temporary = `${target}.${randomUUID()}.tmp`;
await writeFile(temporary, `${JSON.stringify({ ...config, vars })}\n`, { mode: 0o600 });
await rename(temporary, target);
await chmod(target, 0o600);
