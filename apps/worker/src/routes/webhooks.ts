import { Hono } from "hono";
import { Webhook } from "svix";
import type { AppBindings } from "../lib/auth";
import { constantTimeEqual, nowIso, sha256, uuid } from "../lib/utils";
import { stopEnrollments, writeActivity } from "../lib/db";

export const webhooks = new Hono<AppBindings>();

webhooks.post("/agentmail/events", async (c) => {
  const rawBody = await readSmallBody(c.req.raw);
  const event = verifyAgentMailEvent(c.req.raw.headers, rawBody, c.env.AGENTMAIL_WEBHOOK_SECRET);
  if (!event) return c.json({ error: "invalid signature" }, 401);

  const eventType = stringValue(event.event_type);
  const eventId = stringValue(event.event_id) || await sha256(rawBody);
  if (eventType === "message.received") {
    const incoming = objectValue(event.message);
    const email = extractEmail(stringValue(incoming.from));
    const lead = email ? await c.env.DB.prepare("SELECT id, first_name, last_name FROM leads WHERE lower(email) = lower(?)").bind(email).first<{ id: string; first_name: string; last_name: string }>() : null;
    if (lead) {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT OR IGNORE INTO outreach_events (id, lead_id, event_type, provider, provider_event_id, occurred_at, metadata_json) VALUES (?, ?, 'reply', 'agentmail', ?, ?, ?)")
          .bind(uuid(), lead.id, eventId, stringValue(incoming.timestamp) || nowIso(), JSON.stringify({ subject: stringValue(incoming.subject).slice(0, 300), excerpt: (stringValue(incoming.extracted_text) || stringValue(incoming.text) || stringValue(incoming.preview)).slice(0, 500), threadId: stringValue(incoming.thread_id), messageId: stringValue(incoming.message_id) })),
        c.env.DB.prepare("UPDATE leads SET status = 'replied', updated_at = ? WHERE id = ?").bind(nowIso(), lead.id),
      ]);
      await stopEnrollments(c.env.DB, lead.id, "reply");
      await writeActivity(c.env.DB, { actorType: "system", actorName: "AgentMail Reply Router", action: "lead.replied", entityType: "lead", entityId: lead.id, detail: `${lead.first_name} ${lead.last_name} replied; active sequences were stopped for human follow-up.`, severity: "success" });
    }
    return c.json({ accepted: true, matched: Boolean(lead) });
  }

  const payloadKey = eventType === "message.sent" ? "send" : eventType === "message.delivered" ? "delivery" : eventType === "message.bounced" ? "bounce" : eventType === "message.complained" ? "complaint" : eventType === "message.rejected" ? "reject" : "";
  if (!payloadKey) return c.json({ accepted: true, ignored: true });
  const payload = objectValue(event[payloadKey]);
  const providerMessageId = stringValue(payload.message_id);
  const message = providerMessageId ? await c.env.DB.prepare("SELECT id, lead_id FROM messages WHERE provider = 'agentmail' AND provider_message_id = ?").bind(providerMessageId).first<{ id: string; lead_id: string }>() : null;
  if (!message) return c.json({ accepted: true, matched: false });

  const mappedType = eventType === "message.delivered" ? "delivered" : eventType === "message.bounced" ? "bounce" : eventType === "message.complained" ? "spam_complaint" : eventType === "message.rejected" ? "dropped" : "sent";
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO outreach_events (id, message_id, lead_id, event_type, provider, provider_event_id, occurred_at, metadata_json) VALUES (?, ?, ?, ?, 'agentmail', ?, ?, ?)",
  ).bind(uuid(), message.id, message.lead_id, mappedType, eventId, stringValue(payload.timestamp) || nowIso(), JSON.stringify({ threadId: stringValue(payload.thread_id), type: stringValue(payload.type), subType: stringValue(payload.sub_type), reason: stringValue(payload.reason) })).run();

  if (["bounce", "spam_complaint", "dropped"].includes(mappedType)) {
    const lead = await c.env.DB.prepare("SELECT email FROM leads WHERE id = ?").bind(message.lead_id).first<{ email: string | null }>();
    if (lead?.email) await c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, lead_id, channel, value, reason, source) VALUES (?, ?, 'email', ?, ?, 'agentmail')")
      .bind(uuid(), message.lead_id, lead.email, mappedType).run();
    await stopEnrollments(c.env.DB, message.lead_id, mappedType);
    await c.env.DB.prepare("UPDATE messages SET status = ?, updated_at = ? WHERE id = ?").bind(mappedType, nowIso(), message.id).run();
  } else if (mappedType === "delivered") {
    await c.env.DB.prepare("UPDATE messages SET status = 'delivered', updated_at = ? WHERE id = ? AND status = 'sent'").bind(nowIso(), message.id).run();
  }
  return c.json({ accepted: true, matched: true });
});

webhooks.post("/sendgrid/events", async (c) => {
  const rawBody = await readSmallBody(c.req.raw);
  if (!c.env.SENDGRID_WEBHOOK_PUBLIC_KEY || !(await verifySendGridSignature(c.req.raw.headers, rawBody, c.env.SENDGRID_WEBHOOK_PUBLIC_KEY))) {
    return c.json({ error: "invalid signature" }, 401);
  }
  const events = JSON.parse(rawBody) as Array<Record<string, unknown>>;
  for (const event of events.slice(0, 1_000)) {
    const providerEventId = stringValue(event.sg_event_id) || await sha256(JSON.stringify(event));
    const providerMessageId = stringValue(event.sg_message_id).split(".")[0] ?? "";
    const messageId = stringValue(event.message_id);
    const eventType = mapSendGridEvent(stringValue(event.event));
    const occurredAt = typeof event.timestamp === "number" ? new Date(event.timestamp * 1_000).toISOString() : nowIso();
    const message = messageId
      ? await c.env.DB.prepare("SELECT id, lead_id FROM messages WHERE id = ?").bind(messageId).first<{ id: string; lead_id: string }>()
      : await c.env.DB.prepare("SELECT id, lead_id FROM messages WHERE provider_message_id LIKE ? LIMIT 1").bind(`${providerMessageId}%`).first<{ id: string; lead_id: string }>();
    if (!message) continue;
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO outreach_events (id, message_id, lead_id, event_type, provider, provider_event_id, occurred_at, metadata_json)
       VALUES (?, ?, ?, ?, 'sendgrid', ?, ?, ?)`,
    ).bind(uuid(), message.id, message.lead_id, eventType, providerEventId, occurredAt, JSON.stringify(redactEvent(event))).run();
    if (["bounce", "dropped", "spam_complaint", "unsubscribe"].includes(eventType)) {
      const lead = await c.env.DB.prepare("SELECT email FROM leads WHERE id = ?").bind(message.lead_id).first<{ email: string | null }>();
      if (lead?.email) await c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, lead_id, channel, value, reason, source) VALUES (?, ?, 'email', ?, ?, 'sendgrid')")
        .bind(uuid(), message.lead_id, lead.email, eventType).run();
      await stopEnrollments(c.env.DB, message.lead_id, eventType);
      await c.env.DB.prepare("UPDATE messages SET status = ?, updated_at = ? WHERE id = ?").bind(eventType, nowIso(), message.id).run();
    }
  }
  return c.json({ accepted: true });
});

webhooks.post("/sendgrid/inbound", async (c) => {
  const token = c.req.query("token") ?? c.req.header("x-agent-os-webhook-token") ?? "";
  if (!c.env.INBOUND_WEBHOOK_TOKEN || !(await constantTimeEqual(token, c.env.INBOUND_WEBHOOK_TOKEN))) return c.json({ error: "unauthorized" }, 401);
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > 1_000_000) return c.json({ error: "payload too large" }, 413);
  const form = await c.req.formData();
  const from = String(form.get("from") ?? "");
  const email = extractEmail(from);
  const subject = String(form.get("subject") ?? "").slice(0, 300);
  const text = String(form.get("text") ?? "").slice(0, 5_000);
  const lead = email ? await c.env.DB.prepare("SELECT id, first_name, last_name FROM leads WHERE lower(email) = lower(?)").bind(email).first<{ id: string; first_name: string; last_name: string }>() : null;
  if (lead) {
    const eventId = await sha256(`${lead.id}:${subject}:${text}`);
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO outreach_events (id, lead_id, event_type, provider, provider_event_id, occurred_at, metadata_json) VALUES (?, ?, 'reply', 'sendgrid_inbound', ?, ?, ?)")
        .bind(uuid(), lead.id, eventId, nowIso(), JSON.stringify({ subject, excerpt: text.slice(0, 500) })),
      c.env.DB.prepare("UPDATE leads SET status = 'replied', updated_at = ? WHERE id = ?").bind(nowIso(), lead.id),
    ]);
    await stopEnrollments(c.env.DB, lead.id, "reply");
    await writeActivity(c.env.DB, { actorType: "system", actorName: "Reply Router", action: "lead.replied", entityType: "lead", entityId: lead.id, detail: `${lead.first_name} ${lead.last_name} replied; active sequences were stopped.`, severity: "success" });
  }
  return c.json({ accepted: true, matched: Boolean(lead) });
});

webhooks.post("/twilio/status", async (c) => {
  const raw = await readSmallBody(c.req.raw);
  if (!c.env.TWILIO_AUTH_TOKEN || !(await verifyTwilioSignature(c.req.url, raw, c.req.header("x-twilio-signature") ?? "", c.env.TWILIO_AUTH_TOKEN))) return c.json({ error: "invalid signature" }, 401);
  const form = new URLSearchParams(raw);
  const sid = form.get("MessageSid") ?? "";
  const status = form.get("MessageStatus") ?? "unknown";
  const message = await c.env.DB.prepare("SELECT id, lead_id FROM messages WHERE provider_message_id = ?").bind(sid).first<{ id: string; lead_id: string }>();
  if (message) {
    await c.env.DB.prepare("INSERT OR IGNORE INTO outreach_events (id, message_id, lead_id, event_type, provider, provider_event_id, occurred_at, metadata_json) VALUES (?, ?, ?, ?, 'twilio', ?, ?, ?)")
      .bind(uuid(), message.id, message.lead_id, status, `${sid}:${status}`, nowIso(), JSON.stringify({ status })).run();
    if (["failed", "undelivered"].includes(status)) await c.env.DB.prepare("UPDATE messages SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso(), message.id).run();
  }
  return c.body(null, 204);
});

webhooks.post("/calendly", async (c) => {
  const raw = await readSmallBody(c.req.raw);
  if (!c.env.CALENDLY_WEBHOOK_SECRET || !(await verifyCalendlySignature(raw, c.req.header("calendly-webhook-signature") ?? "", c.env.CALENDLY_WEBHOOK_SECRET))) return c.json({ error: "invalid signature" }, 401);
  const event = JSON.parse(raw) as Record<string, unknown>;
  const eventName = stringValue(event.event);
  const payload = objectValue(event.payload);
  const invitee = objectValue(payload.invitee);
  const scheduledEvent = objectValue(payload.scheduled_event);
  const email = stringValue(invitee.email);
  const providerId = stringValue(invitee.uri) || await sha256(raw);
  const lead = email ? await c.env.DB.prepare("SELECT id, first_name, last_name FROM leads WHERE lower(email) = lower(?)").bind(email).first<{ id: string; first_name: string; last_name: string }>() : null;
  const bookingStatus = eventName.includes("canceled") ? "cancelled" : "active";
  if (lead) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR REPLACE INTO bookings (id, lead_id, provider, provider_event_id, event_name, starts_at, status, metadata_json) VALUES (?, ?, 'calendly', ?, ?, ?, ?, ?)")
        .bind(uuid(), lead.id, providerId, stringValue(scheduledEvent.name) || "Retirement review", stringValue(scheduledEvent.start_time) || nowIso(), bookingStatus, JSON.stringify({ event: eventName })),
      c.env.DB.prepare("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?").bind(bookingStatus === "active" ? "booked" : "replied", nowIso(), lead.id),
    ]);
    if (bookingStatus === "active") await stopEnrollments(c.env.DB, lead.id, "booked");
    await writeActivity(c.env.DB, { actorType: "system", actorName: "Calendly", action: bookingStatus === "active" ? "booking.created" : "booking.cancelled", entityType: "lead", entityId: lead.id, detail: `${lead.first_name} ${lead.last_name} ${bookingStatus === "active" ? "booked a retirement-readiness review" : "cancelled a booking"}.`, severity: bookingStatus === "active" ? "success" : "warning" });
  }
  return c.json({ accepted: true, matched: Boolean(lead) });
});

async function readSmallBody(request: Request): Promise<string> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_000_000) throw new Error("Webhook payload too large.");
  return request.text();
}

async function verifySendGridSignature(headers: Headers, body: string, publicKeyValue: string): Promise<boolean> {
  try {
    const signature = headers.get("x-twilio-email-event-webhook-signature");
    const timestamp = headers.get("x-twilio-email-event-webhook-timestamp");
    if (!signature || !timestamp) return false;
    const keyBytes = decodePemOrBase64(publicKeyValue);
    const key = await crypto.subtle.importKey("spki", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decodeBase64(signature), new TextEncoder().encode(timestamp + body));
  } catch { return false; }
}

async function verifyTwilioSignature(url: string, body: string, signature: string, token: string): Promise<boolean> {
  const params = new URLSearchParams(body);
  let data = url;
  for (const key of [...new Set([...params.keys()])].sort()) for (const value of params.getAll(key).sort()) data += key + value;
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)))));
  return constantTimeEqual(signature, expected);
}

async function verifyCalendlySignature(body: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=", 2) as [string, string]));
  if (!parts.t || !parts.v1) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const actual = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${body}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(parts.v1, actual);
}

function decodePemOrBase64(value: string): ArrayBuffer {
  const clean = value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  return decodeBase64(clean);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function extractEmail(value: string): string | null {
  return value.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
}

export function verifyAgentMailEvent(headers: Headers, body: string, secret?: string): Record<string, unknown> | null {
  if (!secret) return null;
  try {
    const webhook = new Webhook(secret);
    const verified = webhook.verify(body, {
      "svix-id": headers.get("svix-id") ?? "",
      "svix-timestamp": headers.get("svix-timestamp") ?? "",
      "svix-signature": headers.get("svix-signature") ?? "",
    });
    return objectValue(verified);
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function mapSendGridEvent(value: string): string { return value === "spamreport" ? "spam_complaint" : value; }
function redactEvent(event: Record<string, unknown>): Record<string, unknown> { return { event: event.event, category: event.category, response: event.response, reason: event.reason, attempt: event.attempt }; }
