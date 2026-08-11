import { ensureMarketplaceSchema } from "../../../../db/ensure";
import { writeAudit } from "../../../../lib/audit";
import { requireAdmin } from "../../../../lib/auth";
import { runtimeEnv } from "../../../../lib/runtime";
import { cleanText, enforceRateLimit } from "../../../../lib/security";

type UserRow = { id: number; email: string; display_name: string | null; role: string; status: string; created_at: string };
type OrderRow = { id: number; public_id: string; buyer_email: string; product_name: string; amount: number; status: string; payment_status: string; delivery_status: string; created_at: string };
type DisputeRow = { id: number; order_id: number; opened_by_email: string; reason: string; status: string; resolution: string | null; created_at: string };
type RiskRow = { id: number; actor_email: string | null; event_type: string; score: number; status: string; created_at: string };
type AuditRow = { id: number; actor_email: string | null; action: string; entity_type: string; entity_id: string | null; created_at: string };

export async function GET(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const env = runtimeEnv() as { DB?: D1Database };
    if (!env.DB) throw new Error("database_unavailable");

    const [users, orders, disputes, risks, audits] = await Promise.all([
      env.DB.prepare("SELECT id, email, display_name, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 200").all<UserRow>(),
      env.DB.prepare("SELECT id, public_id, buyer_email, product_name, amount, status, payment_status, delivery_status, created_at FROM orders ORDER BY created_at DESC LIMIT 200").all<OrderRow>(),
      env.DB.prepare("SELECT id, order_id, opened_by_email, reason, status, resolution, created_at FROM disputes ORDER BY created_at DESC LIMIT 200").all<DisputeRow>(),
      env.DB.prepare("SELECT id, actor_email, event_type, score, status, created_at FROM risk_events ORDER BY created_at DESC LIMIT 200").all<RiskRow>(),
      env.DB.prepare("SELECT id, actor_email, action, entity_type, entity_id, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 250").all<AuditRow>(),
    ]);

    return Response.json({
      users: users.results,
      orders: orders.results,
      disputes: disputes.results,
      risks: risks.results,
      audits: audits.results,
    });
  } catch {
    return Response.json({ error: "Операционные данные временно недоступны" }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const identity = await requireAdmin(request);
  if (identity instanceof Response) return identity;
  try {
    await ensureMarketplaceSchema();
    const rate = await enforceRateLimit(request, "admin-operations", 80, 600);
    if (!rate.allowed) return Response.json({ error: "Слишком много изменений", retryAfter: rate.retryAfter }, { status: 429 });
    const env = runtimeEnv() as { DB?: D1Database };
    if (!env.DB) throw new Error("database_unavailable");
    const body = await request.json() as Record<string, unknown>;
    const action = cleanText(body.action, 40);
    const targetId = Number(body.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) return Response.json({ error: "Некорректный объект" }, { status: 400 });
    const now = new Date().toISOString();

    if (action === "user_status") {
      const status = cleanText(body.status, 20);
      if (!['active', 'suspended'].includes(status)) return Response.json({ error: "Некорректный статус пользователя" }, { status: 400 });
      const target = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(targetId).first<{ email: string }>();
      if (!target) return Response.json({ error: "Пользователь не найден" }, { status: 404 });
      if (target.email.toLowerCase() === identity.email.toLowerCase()) return Response.json({ error: "Нельзя заблокировать собственную учётную запись" }, { status: 409 });
      await env.DB.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, targetId).run();
      await writeAudit(request, { actorEmail: identity.email, action: "user.status_changed", entityType: "user", entityId: targetId, metadata: { status } });
      return Response.json({ ok: true });
    }

    if (action === "order_status") {
      const status = cleanText(body.status, 30);
      const current = await env.DB.prepare("SELECT status, payment_status FROM orders WHERE id = ?").bind(targetId).first<{ status: string; payment_status: string }>();
      if (!current) return Response.json({ error: "Заказ не найден" }, { status: 404 });
      const transitions: Record<string, string[]> = {
        created: ["cancelled"],
        awaiting_payment: ["cancelled"],
        paid: ["processing", "disputed", "refunded"],
        processing: ["delivered", "disputed", "refunded", "cancelled"],
        delivered: ["disputed", "refunded"],
        disputed: ["processing", "delivered", "refunded", "cancelled"],
        refunded: [],
        cancelled: [],
      };
      if (!(transitions[current.status] ?? []).includes(status)) return Response.json({ error: "Недопустимый переход статуса. Финансовые статусы изменяются только по событию платёжного партнёра." }, { status: 409 });
      const result = await env.DB.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, targetId).run();
      if (!result.meta.changes) return Response.json({ error: "Заказ не найден" }, { status: 404 });
      await writeAudit(request, { actorEmail: identity.email, action: "order.status_changed", entityType: "order", entityId: targetId, metadata: { status } });
      return Response.json({ ok: true });
    }

    if (action === "dispute_resolution") {
      const status = cleanText(body.status, 20);
      const resolution = cleanText(body.resolution, 1000);
      if (!['resolved', 'rejected', 'closed'].includes(status) || resolution.length < 5) return Response.json({ error: "Укажите решение и корректный статус" }, { status: 400 });
      const result = await env.DB.prepare("UPDATE disputes SET status = ?, resolution = ?, updated_at = ? WHERE id = ?").bind(status, resolution, now, targetId).run();
      if (!result.meta.changes) return Response.json({ error: "Спор не найден" }, { status: 404 });
      await writeAudit(request, { actorEmail: identity.email, action: "dispute.resolved", entityType: "dispute", entityId: targetId, metadata: { status } });
      return Response.json({ ok: true });
    }

    if (action === "risk_resolution") {
      const status = cleanText(body.status, 20);
      if (!['closed', 'ignored'].includes(status)) return Response.json({ error: "Некорректный статус риска" }, { status: 400 });
      const result = await env.DB.prepare("UPDATE risk_events SET status = ? WHERE id = ?").bind(status, targetId).run();
      if (!result.meta.changes) return Response.json({ error: "Событие риска не найдено" }, { status: 404 });
      await writeAudit(request, { actorEmail: identity.email, action: "risk.reviewed", entityType: "risk_event", entityId: targetId, metadata: { status } });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Неизвестная административная операция" }, { status: 400 });
  } catch {
    return Response.json({ error: "Не удалось сохранить изменение" }, { status: 503 });
  }
}
