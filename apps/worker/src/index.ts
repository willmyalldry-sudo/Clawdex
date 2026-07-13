import { Hono } from "hono";
import { routeAgentRequest } from "agents";
import { signalJobSchema } from "@agent-os/shared";
import type { AppBindings } from "./lib/auth";
import { verifyAccessJwt } from "./lib/auth";
import { api } from "./routes/api";
import { webhooks } from "./routes/webhooks";
import { scheduleHourlyRun, processSignalJob, PermanentJobError } from "./lib/autonomous-pipeline";
import { processLeadPipelineJob } from "./lib/lead-pipeline";
import { processSendJob } from "./lib/message-delivery";
import { databaseConfigured, neonQuery, neonTransaction } from "./lib/neon";
import { constantTimeEqual, hmacBase64Url, logError, logInfo } from "./lib/utils";
export { OutreachSequenceWorkflow } from "./workflows/outreach-sequence";
export { McpControlAgent } from "./agents/mcp-control-agent";

const app = new Hono<AppBindings>();
app.route("/api", api);
app.route("/webhooks", webhooks);

app.on(["GET", "POST"], "/unsubscribe", async (c) => {
  const leadId = c.req.query("lead") ?? "";
  const token = c.req.query("token") ?? "";
  if (!leadId || !token || !c.env.UNSUBSCRIBE_SECRET) return c.html(page("This unsubscribe link is invalid.", false), 400);
  const expected = await hmacBase64Url(c.env.UNSUBSCRIBE_SECRET, leadId);
  if (!(await constantTimeEqual(token, expected))) return c.html(page("This unsubscribe link is invalid.", false), 400);
  const stopped = await neonTransaction(c.env, async (client) => {
    const lead = await client.query<{ email: string; teacher_profile_id: string }>("SELECT email,teacher_profile_id FROM qualified_leads WHERE id=$1 FOR UPDATE", [leadId]);
    if (!lead.rowCount) return false;
    const { email, teacher_profile_id: teacherProfileId } = lead.rows[0]!;
    await client.query(`INSERT INTO suppressions(email,teacher_profile_id,reason,source,scope) SELECT $1,$2,'unsubscribe','one_click','global' WHERE NOT EXISTS(SELECT 1 FROM suppressions WHERE lower(email)=lower($1) AND scope='global' AND expires_at IS NULL)`, [email, teacherProfileId]);
    await client.query(`UPDATE sequence_enrollments SET status='stopped',stop_reason='unsubscribe',completed_at=now(),next_send_at=NULL WHERE qualified_lead_id=$1 AND status='active'`, [leadId]);
    await client.query(`UPDATE outbound_messages SET delivery_status='cancelled' WHERE qualified_lead_id=$1 AND delivery_status='scheduled'`, [leadId]);
    await client.query(`UPDATE qualified_leads SET outreach_status='suppressed' WHERE id=$1`, [leadId]);
    await client.query(`UPDATE newsletter_candidates SET newsletter_consent_status='revoked',suppressed_at=now(),updated_at=now() WHERE qualified_lead_id=$1`, [leadId]);
    await client.query(`UPDATE newsletter_subscribers SET subscription_status='unsubscribed',unsubscribe_at=now(),updated_at=now() WHERE newsletter_candidate_id IN (SELECT id FROM newsletter_candidates WHERE qualified_lead_id=$1)`, [leadId]);
    await client.query(`INSERT INTO audit_log(entity_type,entity_id,action,rule_version,metadata) VALUES('qualified_lead',$1,'sequence.stopped_unsubscribe','signal-os-v2','{}')`, [leadId]);
    return true;
  });
  return c.html(page(stopped ? "You have been unsubscribed." : "This contact could not be found.", stopped), stopped ? 200 : 404);
});

app.get("/crawler-policy", (c) => c.json({
  operator: c.env.APP_NAME,
  purpose: "Discover verified public Nevada educator-retirement signals and professional employer-published contact data.",
  rules: ["Honors robots.txt", "No authentication or CAPTCHA bypass", "Official and approved public source classes only", "No personal contact data", "No guessed email addresses", "Bounded requests and automatic quarantine"],
  contact: c.env.REPLY_TO_EMAIL,
}));

app.get("/book", (c) => c.env.CALENDLY_BOOKING_URL ? c.redirect(c.env.CALENDLY_BOOKING_URL, 302) : c.text("Booking link has not been configured.", 503));
app.notFound(async (c) => c.env.ASSETS.fetch(c.req.raw));
app.onError((error, c) => { logError("http.unhandled", error, { path: c.req.path, method: c.req.method }); return c.json({ error: { code: "internal_error", message: "The request could not be completed." } }, 500); });

const handler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/agents/")) {
      const development = String(env.AUTH_MODE) === "development";
      const oauthCallback = request.method === "GET"
        && url.pathname.endsWith("/callback")
        && url.searchParams.has("state")
        && (url.searchParams.has("code") || url.searchParams.has("error"));
      if (!development && !oauthCallback) {
        const accessJwt = request.headers.get("cf-access-jwt-assertion");
        const verified = accessJwt ? await verifyAccessJwt(env, accessJwt).then(() => true, () => false) : false;
        if (!verified) {
          return Response.json({ error: { code: "unauthorized", message: "Cloudflare Access authentication is required." } }, { status: 401 });
        }
      }
    }
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    return app.fetch(request, env, ctx);
  },
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (batch.queue.endsWith("-dlq")) {
          const parsed = signalJobSchema.safeParse(message.body);
          if (parsed.success) {
            await neonQuery(env, `UPDATE pipeline_jobs SET status='dead_letter',completed_at=now(),error_code='retry_exhausted' WHERE idempotency_key=$1`, [parsed.data.idempotencyKey]);
            await neonQuery(env, `INSERT INTO audit_log(entity_type,entity_id,action,rule_version,metadata) VALUES('pipeline_job',$1,'job.dead_letter','signal-os-v2',$2)`, [parsed.data.idempotencyKey, JSON.stringify({ queue: batch.queue, attempts: message.attempts })]);
          }
          message.ack();
          continue;
        }
        const job = signalJobSchema.parse(message.body);
        if (["search-query", "crawl-source", "resolve-teachers"].includes(job.kind)) await processSignalJob(env, job);
        else if (["enrich-teacher", "validate-email", "qualify-lead", "enroll-lead"].includes(job.kind)) await processLeadPipelineJob(env, job);
        else await processSendJob(env, job);
        message.ack();
      } catch (error) {
        logError("queue.message_failed", error, { queue: batch.queue, messageId: message.id, attempts: message.attempts });
        if (error instanceof PermanentJobError || error instanceof SyntaxError) message.ack();
        else message.retry({ delaySeconds: Math.min(30 * (2 ** Math.max(message.attempts - 1, 0)), 43_200) });
      }
    }
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!databaseConfigured(env)) throw new Error("Neon is not configured.");
    ctx.waitUntil((async () => {
      const run = await scheduleHourlyRun(env, event.scheduledTime);
      if (run.jobs.length) await env.AGENT_QUEUE.sendBatch(run.jobs.map((body) => ({ body, contentType: "json" as const })));
      logInfo("cron.hourly_run", { runId: run.runId, jobs: run.jobs.length, duplicate: run.duplicate, scheduledTime: event.scheduledTime });
    })());
  },
} satisfies ExportedHandler<Env>;

export default handler;

function page(message: string, success: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Communication preferences</title><style>body{margin:0;font-family:system-ui;background:#f5f7fb;color:#14213d;display:grid;place-items:center;min-height:100vh}.card{max-width:480px;background:white;padding:40px;border-radius:20px;box-shadow:0 20px 60px #17315c20;text-align:center}.mark{width:52px;height:52px;margin:auto;border-radius:50%;display:grid;place-items:center;background:${success ? "#e6f8ef" : "#fff1f0"};color:${success ? "#087a4b" : "#b42318"};font-size:24px}p{color:#536079;line-height:1.6}</style></head><body><main class="card"><div class="mark">${success ? "✓" : "!"}</div><h1>Communication preferences</h1><p>${message}</p></main></body></html>`;
}
