import { nowIso, uuid } from "./utils";

export interface ActivityInput {
  actorType: "agent" | "user" | "system";
  actorName: string;
  action: string;
  entityType?: string;
  entityId?: string;
  detail: string;
  severity?: "info" | "success" | "warning" | "error";
}

export async function writeActivity(db: D1Database, input: ActivityInput): Promise<void> {
  await db.prepare(
    `INSERT INTO activity_events (id, actor_type, actor_name, action, entity_type, entity_id, detail, severity, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    uuid(),
    input.actorType,
    input.actorName,
    input.action,
    input.entityType ?? null,
    input.entityId ?? null,
    input.detail,
    input.severity ?? "info",
    nowIso(),
  ).run();
}

export async function isSuppressed(db: D1Database, leadId: string, channel: "email" | "sms"): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS blocked FROM suppressions s
     LEFT JOIN leads l ON l.id = ?
     WHERE (s.lead_id = ? OR (s.channel = ? AND lower(s.value) = lower(CASE WHEN ? = 'email' THEN l.email ELSE l.phone END)))
       AND (s.channel = ? OR s.channel = 'all') LIMIT 1`,
  ).bind(leadId, leadId, channel, channel, channel).first<{ blocked: number }>();
  return Boolean(row?.blocked);
}

export async function hasActiveConsent(db: D1Database, leadId: string, channel: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT status FROM consent_records WHERE lead_id = ? AND channel = ? ORDER BY recorded_at DESC LIMIT 1`,
  ).bind(leadId, channel).first<{ status: string }>();
  return row?.status === "granted";
}

export async function stopEnrollments(db: D1Database, leadId: string, reason: string): Promise<void> {
  await db.prepare(
    `UPDATE sequence_enrollments SET status = 'stopped', stop_reason = ?, updated_at = ? WHERE lead_id = ? AND status = 'active'`,
  ).bind(reason, nowIso(), leadId).run();
}

export async function hasProcessedMessage(db: D1Database, messageId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 AS found FROM processed_messages WHERE id = ? LIMIT 1").bind(messageId).first());
}

export async function markMessageProcessed(db: D1Database, messageId: string, queueName: string): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO processed_messages (id, queue_name, processed_at) VALUES (?, ?, ?)")
    .bind(messageId, queueName, nowIso()).run();
}
