import { Hono } from "hono";
import { queueMessageSchema } from "@agent-os/shared";
import type { AppBindings } from "./lib/auth";
import { api } from "./routes/api";
import { webhooks } from "./routes/webhooks";
import { crawlApprovedSource, discoverWebCandidates } from "./lib/crawler";
import { enrichLead, sendQueuedMessage, validateLeadEmail } from "./lib/providers";
import { constantTimeEqual, logError, logInfo, nowIso, uuid } from "./lib/utils";
import { hasProcessedMessage, markMessageProcessed, stopEnrollments, writeActivity } from "./lib/db";
import { selectNevadaRetirementSearches } from "./lib/nevada-retirement-intelligence";
export { OutreachSequenceWorkflow } from "./workflows/outreach-sequence";

const app = new Hono<AppBindings>();

app.route("/api", api);
app.route("/webhooks", webhooks);

app.on(["GET", "POST"], "/unsubscribe", async (c) => {
  const leadId = c.req.query("lead") ?? "";
  const token = c.req.query("token") ?? "";
  if (!leadId || !token || !c.env.UNSUBSCRIBE_SECRET) return c.html(unsubscribePage("This unsubscribe link is invalid.", false), 400);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(c.env.UNSUBSCRIBE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(leadId));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (!(await constantTimeEqual(token, expected))) return c.html(unsubscribePage("This unsubscribe link is invalid.", false), 400);
  const lead = await c.env.DB.prepare("SELECT email FROM leads WHERE id = ?").bind(leadId).first<{ email: string | null }>();
  if (!lead?.email) return c.html(unsubscribePage("This contact could not be found.", false), 404);
  await c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, lead_id, channel, value, reason, source) VALUES (?, ?, 'email', ?, 'unsubscribe', 'one_click')")
    .bind(uuid(), leadId, lead.email).run();
  await stopEnrollments(c.env.DB, leadId, "unsubscribe");
  await c.env.DB.prepare("UPDATE leads SET status = 'suppressed', updated_at = ? WHERE id = ?").bind(nowIso(), leadId).run();
  await writeActivity(c.env.DB, { actorType: "system", actorName: "Suppression Guard", action: "lead.unsubscribed", entityType: "lead", entityId: leadId, detail: "A contact unsubscribed; active sequences were stopped.", severity: "warning" });
  return c.html(unsubscribePage("You have been unsubscribed.", true));
});

app.get("/book", async (c) => {
  const setting = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'booking_url'").first<{ value: string }>();
  if (!setting?.value || setting.value.includes("configure-me")) return c.text("Booking link has not been configured yet.", 503);
  return c.redirect(setting.value, 302);
});

app.get("/crawler-policy", (c) => c.json({
  operator: c.env.APP_NAME,
  purpose: "Monitor administrator-approved public sources for Nevada educator retirement updates.",
  rules: ["Honors robots.txt", "No authentication bypass", "No CAPTCHA bypass", "No personal contact-data inference", "Rate-limited concurrent access", "Human approval required before outreach"],
  contact: c.env.REPLY_TO_EMAIL,
}));

app.notFound(async (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  logError("http.unhandled", error, { path: c.req.path, method: c.req.method });
  const message = String(c.env.AUTH_MODE) === "development" && error instanceof Error ? error.message : "The request could not be completed.";
  return c.json({ error: { code: "internal_error", message } }, 500);
});

const handler = {
  fetch: app.fetch,

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => {
      try {
        if (batch.queue.endsWith("-dlq")) {
          const parsed = queueMessageSchema.safeParse(message.body);
          await env.DB.prepare(
            "INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json, error_code, error_message, started_at, completed_at) VALUES (?, 'dead_letter', 'queue_message', ?, 'failed', ?, 'retry_exhausted', 'Message exhausted queue retries.', ?, ?)",
          ).bind(uuid(), message.id, JSON.stringify(message.body), nowIso(), nowIso()).run();
          await writeActivity(env.DB, { actorType: "system", actorName: "Dead Letter Monitor", action: "job.failed", entityType: "queue_message", entityId: message.id, detail: parsed.success ? `${parsed.data.kind} exhausted all retries and requires review.` : "An invalid queue message requires review.", severity: "error" });
          message.ack();
          return;
        }
        if (await hasProcessedMessage(env.DB, message.id)) { message.ack(); return; }
        const parsed = queueMessageSchema.parse(message.body);
        if (parsed.kind === "discover-web") await discoverWebCandidates(env, parsed.query, parsed.runId, parsed);
        else if (parsed.kind === "crawl-source") await crawlApprovedSource(env, parsed.sourceId, parsed.runId);
        else if (parsed.kind === "enrich-lead") await enrichLead(env, parsed.leadId, parsed.runId);
        else if (parsed.kind === "validate-email") await validateLeadEmail(env, parsed.leadId, parsed.runId);
        else await sendQueuedMessage(env, parsed.messageId);
        await markMessageProcessed(env.DB, message.id, batch.queue);
        message.ack();
      } catch (error) {
        logError("queue.message_failed", error, { queue: batch.queue, messageId: message.id, attempts: message.attempts });
        message.retry({ delaySeconds: Math.min(30 * (2 ** Math.max(message.attempts - 1, 0)), 3_600) });
      }
    }));
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    const due = await env.DB.prepare(
      `SELECT id FROM sources WHERE approved = 1 AND active = 1 AND (
         last_crawled_at IS NULL OR
         (crawl_frequency = 'daily' AND last_crawled_at < datetime('now', '-1 day')) OR
         (crawl_frequency = 'weekly' AND last_crawled_at < datetime('now', '-7 day')) OR
         (crawl_frequency = 'monthly' AND last_crawled_at < datetime('now', '-30 day'))
       ) ORDER BY last_crawled_at ASC LIMIT 25`,
    ).all<{ id: string }>();
    for (const source of due.results) {
      const runId = uuid();
      await env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json) VALUES (?, 'crawler', 'source', ?, 'queued', ?)")
        .bind(runId, source.id, JSON.stringify({ trigger: "cron", scheduledTime: event.scheduledTime })).run();
      await env.AGENT_QUEUE.send({ kind: "crawl-source", sourceId: source.id, runId });
    }
    let searchCount = 0;
    if (env.TINYFISH_API_KEY || env.PARALLEL_API_KEY) {
      const searches = selectNevadaRetirementSearches(new Date(event.scheduledTime).toISOString().slice(0, 10), 8);
      const jobs = searches.map((search) => ({ ...search, runId: uuid() }));
      await env.DB.batch(jobs.map((job) => env.DB.prepare(
        "INSERT INTO agent_runs (id, agent_type, entity_type, status, input_json) VALUES (?, 'source_scout', 'source', 'queued', ?)",
      ).bind(job.runId, JSON.stringify({ trigger: "cron", query: job.query, queryId: job.id, category: job.category }))));
      await env.AGENT_QUEUE.sendBatch(jobs.map((job) => ({
        body: { kind: "discover-web", query: job.query, runId: job.runId, queryId: job.id, category: job.category, sourceType: job.sourceType },
      })));
      searchCount = jobs.length;
    }
    logInfo("cron.discovery_enqueued", {
      sources: due.results.length,
      searches: searchCount,
      tinyfish: Boolean(env.TINYFISH_API_KEY),
      parallel: Boolean(env.PARALLEL_API_KEY),
      scheduledTime: event.scheduledTime,
    });
  },
} satisfies ExportedHandler<Env>;

export default handler;

function unsubscribePage(message: string, success: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Communication preferences</title><style>body{margin:0;font-family:system-ui;background:#f5f7fb;color:#14213d;display:grid;place-items:center;min-height:100vh}.card{max-width:480px;background:white;padding:40px;border-radius:20px;box-shadow:0 20px 60px #17315c20;text-align:center}.mark{width:52px;height:52px;margin:auto;border-radius:50%;display:grid;place-items:center;background:${success ? "#e6f8ef" : "#fff1f0"};color:${success ? "#087a4b" : "#b42318"};font-size:24px}p{color:#536079;line-height:1.6}</style></head><body><main class="card"><div class="mark">${success ? "✓" : "!"}</div><h1>Communication preferences</h1><p>${message}</p><p>You can contact Benjamin directly if you need further help.</p></main></body></html>`;
}
