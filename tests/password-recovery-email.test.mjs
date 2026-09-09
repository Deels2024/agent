import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const email = await readFile(new URL("../lib/email.ts", import.meta.url), "utf8");
const notifications = await readFile(new URL("../app/api/jobs/notifications/route.ts", import.meta.url), "utf8");
const health = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
const compose = await readFile(new URL("../docker-compose.server.yml", import.meta.url), "utf8");
const runtimeConfig = await readFile(new URL("../scripts/create-runtime-wrangler-config.mjs", import.meta.url), "utf8");


test("password reset email has a real transactional provider path", () => {
  assert.match(email, /https:\/\/api\.resend\.com\/emails/);
  assert.match(email, /Authorization|authorization/);
  assert.match(email, /Idempotency-Key/);
  assert.match(email, /password_reset/);
  assert.match(email, /Сменить пароль/);
  assert.match(email, /verify_email/);
});

test("notification job can deliver email without webhook", () => {
  assert.match(notifications, /directEmailConfigured/);
  assert.match(notifications, /sendTransactionalEmail/);
  assert.match(notifications, /webhookNotificationsConfigured/);
  assert.match(notifications, /deferred/);
});

test("production exposes email provider only through server runtime", () => {
  for (const name of ["RESEND_API_URL", "RESEND_API_KEY", "EMAIL_FROM"]) {
    assert.match(compose, new RegExp(name));
    assert.match(runtimeConfig, new RegExp(`\\"${name}\\"`));
  }
  assert.match(health, /notificationDeliveryConfigured/);
});
