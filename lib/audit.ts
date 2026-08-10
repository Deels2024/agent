import { getDb } from "../db";
import { auditLogs, riskEvents } from "../db/schema";
import { requestFingerprint } from "./security";

export async function writeAudit(request: Request, input: {
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await getDb().insert(auditLogs).values({
      actorEmail: input.actorEmail,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId == null ? null : String(input.entityId),
      ipHash: await requestFingerprint(request, input.actorEmail),
      metadataJson: JSON.stringify(input.metadata ?? {}),
    });
  } catch {
    // Аудит не должен раскрывать детали ошибки клиенту и ломать основную операцию.
  }
}

export async function writeRiskEvent(input: {
  actorEmail?: string;
  eventType: string;
  score: number;
  details?: Record<string, unknown>;
}) {
  await getDb().insert(riskEvents).values({
    actorEmail: input.actorEmail,
    eventType: input.eventType,
    score: Math.max(0, Math.min(100, input.score)),
    detailsJson: JSON.stringify(input.details ?? {}),
  });
}
