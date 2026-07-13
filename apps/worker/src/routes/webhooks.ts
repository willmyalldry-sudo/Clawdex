import { Hono, type Context } from "hono";
import { Webhook } from "svix";
import type { AppBindings } from "../lib/auth";
import { neonQuery, neonTransaction } from "../lib/neon";
import { constantTimeEqual, nowIso, sha256 } from "../lib/utils";

export const webhooks = new Hono<AppBindings>();

const TERMINAL_EVENTS = new Set([
  "reply", "positive_reply", "negative_reply", "booking", "unsubscribe", "complaint",
  "hard_bounce", "invalid_email", "rejected", "spam_report", "manual_global_suppression",
  "provider_suppression",
]);
const SUPPRESSION_EVENTS = new Set(["unsubscribe", "complaint", "hard_bounce", "invalid_email", "rejected", "spam_report", "provider_suppression"]);

webhooks.post("/agentmail", handleAgentMail);
webhooks.post("/agentmail/events", handleAgentMail);

async function handleAgentMail(c: Context<AppBindings>) {
  const raw = await readSmallBody(c.req.raw);
  const event = verifyAgentMailEvent(c.req.raw.headers, raw, c.env.AGENTMAIL_WEBHOOK_SECRET);
  if (!event) return c.json({ error: "invalid signature" }, 401);

  const providerEventId = stringValue(event.event_id) || c.req.header("svix-id") || await sha256(raw);
  const providerType = stringValue(event.event_type || event.type);
  const payload = objectValue(event.message || event.data || event.send || event.delivery || event.bounce || event.complaint || event.reject);
  const mappedType = mapAgentMailEvent(providerType);
  if (!mappedType) return c.json({ accepted: true, ignored: true });

  const providerMessageId = stringValue(payload.message_id || payload.id || event.message_id);
  const replyEmail = mappedType === "reply" ? extractEmail(stringValue(payload.from || event.from)) : null;
  const result = await ingestEvent(c.env, {
    provider: "agentmail", providerEventId, providerMessageId, eventType: mappedType,
    occurredAt: stringValue(payload.timestamp || event.timestamp) || nowIso(), replyEmail, raw,
  });
  return c.json({ accepted: true, ...result });
}

webhooks.post("/autosend", async (c) => {
  const raw = await readSmallBody(c.req.raw);
  if (!c.env.AUTOSEND_WEBHOOK_SECRET || !(await verifyTimestampedHmac(
    raw,
    c.req.header("x-autosend-signature") || c.req.header("webhook-signature") || "",
    c.req.header("x-autosend-timestamp") || c.req.header("webhook-timestamp") || "",
    c.env.AUTOSEND_WEBHOOK_SECRET,
  ))) return c.json({ error: "invalid signature" }, 401);

  const event = JSON.parse(raw) as Record<string, unknown>;
  const data = objectValue(event.data || event.payload);
  const providerType = stringValue(event.type || event.event);
  const mappedType = mapDeliveryEvent(providerType);
  if (!mappedType) return c.json({ accepted: true, ignored: true });
  const providerEventId = stringValue(event.id || event.event_id) || await sha256(raw);
  const providerMessageId = stringValue(data.message_id || data.id || event.message_id);
  const replyEmail = mappedType === "reply" ? extractEmail(stringValue(data.from || event.from)) : null;
  const result = await ingestEvent(c.env, {
    provider: "autosend", providerEventId, providerMessageId, eventType: mappedType,
    occurredAt: stringValue(event.created_at || data.timestamp) || nowIso(), replyEmail, raw,
  });
  return c.json({ accepted: true, ...result });
});

webhooks.post("/calendly", async (c) => {
  const raw = await readSmallBody(c.req.raw);
  if (!c.env.CALENDLY_WEBHOOK_SECRET || !(await verifyCalendlySignature(
    raw,
    c.req.header("calendly-webhook-signature") || "",
    c.env.CALENDLY_WEBHOOK_SECRET,
  ))) return c.json({ error: "invalid signature" }, 401);

  const event = JSON.parse(raw) as Record<string, unknown>;
  const eventName = stringValue(event.event);
  if (!eventName.includes("invitee.created")) return c.json({ accepted: true, ignored: true });
  const payload = objectValue(event.payload);
  const invitee = objectValue(payload.invitee);
  const email = extractEmail(stringValue(invitee.email));
  const result = await ingestEvent(c.env, {
    provider: "calendly",
    providerEventId: stringValue(invitee.uri || payload.uri) || await sha256(raw),
    providerMessageId: "",
    eventType: "booking",
    occurredAt: stringValue(payload.created_at || invitee.created_at) || nowIso(),
    replyEmail: email,
    raw,
  });
  return c.json({ accepted: true, ...result });
});

type InboundEvent = {
  provider: string;
  providerEventId: string;
  providerMessageId: string;
  eventType: string;
  occurredAt: string;
  replyEmail: string | null;
  raw: string;
};

async function ingestEvent(env: Env, input: InboundEvent): Promise<{ duplicate: boolean; matched: boolean }> {
  const payloadKey = `webhooks/${input.provider}/${new Date().toISOString().slice(0, 10)}/${input.providerEventId.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 180)}.json`;
  await env.EVIDENCE.put(payloadKey, input.raw, { httpMetadata: { contentType: "application/json" } });

  return neonTransaction(env, async (client) => {
    const lead = input.replyEmail
      ? await client.query<{ id: string; email: string; teacher_profile_id: string }>(
          `SELECT id,email,teacher_profile_id FROM qualified_leads WHERE lower(email)=lower($1) LIMIT 1 FOR UPDATE`,
          [input.replyEmail],
        )
      : await client.query<{ id: string; email: string; teacher_profile_id: string; message_id: string }>(
          `SELECT q.id,q.email,q.teacher_profile_id,m.id AS message_id
           FROM outbound_messages m JOIN qualified_leads q ON q.id=m.qualified_lead_id
           WHERE m.provider=$1 AND m.provider_message_id=$2 LIMIT 1 FOR UPDATE OF q`,
          [input.provider, input.providerMessageId],
        );
    const row = lead.rows[0];
    const messageId = row && "message_id" in row ? row.message_id : null;
    const inserted = await client.query(
      `INSERT INTO message_events(outbound_message_id,event_type,provider,provider_event_id,occurred_at,payload_r2_key)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id`,
      [messageId, input.eventType, input.provider, input.providerEventId, input.occurredAt, payloadKey],
    );
    if (!inserted.rowCount) return { duplicate: true, matched: Boolean(row) };

    if (messageId) {
      const deliveryStatus = mapDeliveryStatus(input.eventType);
      if (deliveryStatus) await client.query(
        `UPDATE outbound_messages SET delivery_status=$2,sent_at=CASE WHEN $2='sent' THEN COALESCE(sent_at,$3::timestamptz) ELSE sent_at END WHERE id=$1`,
        [messageId, deliveryStatus, input.occurredAt],
      );
    }

    if (!row || !TERMINAL_EVENTS.has(input.eventType)) return { duplicate: false, matched: Boolean(row) };
    await client.query(
      `UPDATE sequence_enrollments SET status='stopped',stop_reason=$2,completed_at=now(),next_send_at=NULL
       WHERE qualified_lead_id=$1 AND status='active'`,
      [row.id, input.eventType],
    );
    await client.query(
      `UPDATE outbound_messages SET delivery_status='cancelled'
       WHERE qualified_lead_id=$1 AND delivery_status='scheduled'`,
      [row.id],
    );
    await client.query(
      `UPDATE qualified_leads SET outreach_status=$2 WHERE id=$1`,
      [row.id, input.eventType === "booking" ? "booked" : input.eventType.includes("reply") ? "replied" : "suppressed"],
    );
    if (SUPPRESSION_EVENTS.has(input.eventType)) await client.query(
      `INSERT INTO suppressions(email,teacher_profile_id,reason,source,scope)
       SELECT $1,$2,$3,$4,'global' WHERE NOT EXISTS(
         SELECT 1 FROM suppressions WHERE lower(email)=lower($1) AND scope='global' AND (expires_at IS NULL OR expires_at>now())
       )`,
      [row.email, row.teacher_profile_id, input.eventType, input.provider],
    );
    await client.query(
      `INSERT INTO audit_log(entity_type,entity_id,action,rule_version,metadata)
       VALUES('qualified_lead',$1,'sequence.stopped_terminal_event','signal-os-v2',$2::jsonb)`,
      [row.id, JSON.stringify({ eventType: input.eventType, provider: input.provider, providerEventId: input.providerEventId })],
    );
    return { duplicate: false, matched: true };
  });
}

async function readSmallBody(request: Request): Promise<string> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 2_000_000) throw new Error("Webhook payload too large.");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000_000) throw new Error("Webhook payload too large.");
  return body;
}

export function verifyAgentMailEvent(headers: Headers, body: string, secret?: string): Record<string, unknown> | null {
  if (!secret) return null;
  try {
    const verified = new Webhook(secret).verify(body, {
      "svix-id": headers.get("svix-id") || "",
      "svix-timestamp": headers.get("svix-timestamp") || "",
      "svix-signature": headers.get("svix-signature") || "",
    });
    return objectValue(verified);
  } catch { return null; }
}

async function verifyCalendlySignature(body: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  if (!parts.t || !parts.v1 || !freshTimestamp(parts.t)) return false;
  return verifyHexHmac(`${parts.t}.${body}`, parts.v1, secret);
}

async function verifyTimestampedHmac(body: string, signature: string, timestamp: string, secret: string): Promise<boolean> {
  const normalized = signature.replace(/^sha256=/, "");
  if (!normalized || !timestamp || !freshTimestamp(timestamp)) return false;
  return verifyHexHmac(`${timestamp}.${body}`, normalized, secret);
}

async function verifyHexHmac(value: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(signature.toLowerCase(), digest);
}

function freshTimestamp(value: string): boolean {
  const numeric = Number(value);
  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1_000;
  return Number.isFinite(milliseconds) && Math.abs(Date.now() - milliseconds) <= 5 * 60 * 1_000;
}

function mapAgentMailEvent(value: string): string | null {
  if (value === "message.received") return "reply";
  return mapDeliveryEvent(value);
}

function mapDeliveryEvent(value: string): string | null {
  const normalized = value.toLowerCase().replace(/^message[._]/, "");
  if (["sent", "delivered"].includes(normalized)) return normalized;
  if (["bounce", "bounced", "hard_bounce"].includes(normalized)) return "hard_bounce";
  if (["complaint", "complained", "spam", "spam_report"].includes(normalized)) return "complaint";
  if (["reject", "rejected", "dropped"].includes(normalized)) return "rejected";
  if (["unsubscribe", "unsubscribed"].includes(normalized)) return "unsubscribe";
  if (["reply", "replied", "received"].includes(normalized)) return "reply";
  return null;
}

function mapDeliveryStatus(eventType: string): string | null {
  if (["sent", "delivered"].includes(eventType)) return eventType;
  if (eventType === "hard_bounce") return "bounced";
  if (eventType === "complaint") return "complaint";
  if (eventType === "rejected") return "rejected";
  return null;
}

function extractEmail(value: string): string | null {
  return value.match(/<([^>]+)>/)?.[1]?.toLowerCase() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || null;
}
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
