import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppBindings } from "../lib/auth";
import { requireAccessUser } from "../lib/auth";
import { databaseConfigured, neonQuery } from "../lib/neon";
import { scheduleHourlyRun } from "../lib/autonomous-pipeline";
import { nowIso } from "../lib/utils";
import { mcpApi } from "./mcp";

export const api = new Hono<AppBindings>();

api.get("/health", async (c) => {
  let neon = false;
  if (databaseConfigured(c.env)) {
    try { neon = (await neonQuery<{ ok: number }>(c.env, "SELECT 1 AS ok")).rows[0]?.ok === 1; } catch { neon = false; }
  }
  return c.json({
    ok: neon,
    service: c.env.APP_NAME,
    version: "2.0.0",
    database: { authoritative: "neon", connected: neon, transport: (c.env as Env & { HYPERDRIVE?: Hyperdrive }).HYPERDRIVE ? "hyperdrive" : "direct" },
    outreachMode: c.env.OUTREACH_MODE,
    cron: c.env.SEARCH_CRON,
    researchProviders: { tinyfish: Boolean(c.env.TINYFISH_API_KEY), parallel: Boolean(c.env.PARALLEL_API_KEY) },
    enrichmentProviders: { apollo: Boolean(c.env.APOLLO_API_KEY), peopleDataLabs: Boolean(c.env.PDL_API_KEY) },
    validationProviders: { zerobounce: Boolean(c.env.ZEROBOUNCE_API_KEY), operatorMcp: ["abstract", "bouncer"] },
    emailProviders: { agentmail: Boolean(c.env.AGENTMAIL_API_KEY && c.env.AGENTMAIL_INBOX_ID), autosend: Boolean(c.env.AUTOSEND_API_KEY) },
    timestamp: nowIso(),
  }, neon ? 200 : 503);
});

api.use("*", requireAccessUser);
api.route("/mcp", mcpApi);

api.get("/writer/policy", (c) => c.json({ mode: "autonomous_deterministic_preflight", ruleVersion: "signal-os-v2", coreRule: "Every outbound message must reference a verified public retirement signal." }));

api.get("/dashboard", async (c) => {
  const result = await neonQuery<Record<string, string>>(c.env,
    `SELECT
       (SELECT count(*) FROM qualified_leads WHERE outreach_status <> 'suppressed')::text AS total_leads,
       (SELECT count(*) FROM qualified_leads WHERE qualification_score >= 75 AND outreach_status IN ('qualified','enrolled','contacted'))::text AS high_intent,
       (SELECT count(*) FROM signal_events WHERE created_at >= now()-interval '7 days')::text AS new_signals,
       (SELECT count(*) FROM message_events WHERE event_type='booking' AND occurred_at >= now())::text AS bookings,
       (SELECT count(*) FROM outbound_messages WHERE preflight_status='blocked')::text AS blocked_messages,
       (SELECT count(*) FROM outbound_messages WHERE sent_at IS NOT NULL)::text AS sent,
       (SELECT count(*) FROM message_events WHERE event_type IN ('reply','positive_reply','negative_reply'))::text AS replies,
       (SELECT count(*) FROM signal_sources WHERE policy_status='quarantined')::text AS quarantined_sources`,
  );
  const row = result.rows[0] ?? {};
  return c.json({
    metrics: { totalLeads: number(row.total_leads), highIntent: number(row.high_intent), newSignals: number(row.new_signals), upcomingBookings: number(row.bookings), pendingApprovals: number(row.blocked_messages), sent: number(row.sent), replies: number(row.replies), sourceCandidates: number(row.quarantined_sources) },
    funnel: await funnel(c.env), generatedAt: nowIso(),
  });
});

api.get("/leads", async (c) => {
  const query = `%${(c.req.query("q") ?? "").toLowerCase()}%`;
  const limit = Math.min(250, Math.max(1, Number(c.req.query("limit") ?? 100)));
  const rows = await neonQuery(c.env,
    `SELECT q.id,q.first_name,q.last_name,q.email,q.email_validation_status AS email_status,q.job_title AS title,
            q.school_name AS organization_name,q.school_district AS district,NULL::text AS city,'NV'::text AS state,
            NULL::integer AS years_in_education,q.qualification_score AS score,q.outreach_status AS status,
            (SELECT count(*)::integer FROM teacher_signal_links tsl WHERE tsl.teacher_profile_id=q.teacher_profile_id) AS signal_count,
            1::integer AS evidence_count,q.signal_date AS last_signal_at
     FROM qualified_leads q
     WHERE lower(q.first_name||' '||q.last_name||' '||q.email||' '||q.job_title||' '||q.school_district) LIKE $1
     ORDER BY q.qualification_score DESC,q.qualified_at DESC LIMIT $2`, [query, limit]);
  return c.json({ leads: rows.rows });
});

api.get("/leads/:id", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT q.*,p.linkedin_url,p.primary_source_url,v.provider_metadata
     FROM qualified_leads q JOIN teacher_profiles p ON p.id=q.teacher_profile_id
     JOIN LATERAL (SELECT provider_metadata FROM email_validations WHERE teacher_profile_id=p.id ORDER BY validated_at DESC LIMIT 1) v ON true
     WHERE q.id=$1`, [c.req.param("id")]);
  if (!rows.rowCount) return c.json({ error: { code: "not_found", message: "Lead not found." } }, 404);
  return c.json({ lead: rows.rows[0] });
});

api.get("/signals", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT e.id,e.signal_type,e.signal_category,e.signal_score,e.signal_summary AS summary,e.signal_summary AS title,
            s.canonical_url AS source_url,e.evidence_excerpt AS source_excerpt,e.evidence_confidence AS confidence,
            e.created_at AS discovered_at,e.status,e.person_name AS lead_name,e.district_name AS organization_name,
            COALESCE(s.source_title,s.domain) AS source_name
     FROM signal_events e JOIN signal_sources s ON s.id=e.source_id ORDER BY e.created_at DESC LIMIT 250`);
  return c.json({ signals: rows.rows });
});

api.get("/sources", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT id,COALESCE(source_title,domain) AS name,canonical_url AS url,source_type,
            'automatic'::text AS crawl_frequency,(policy_status='allowed')::integer AS approved,
            (policy_status='allowed')::integer AS active,crawl_status AS last_status,last_crawled_at,
            policy_status,policy_reason,robots_status
     FROM signal_sources ORDER BY last_seen_at DESC LIMIT 250`);
  return c.json({ sources: rows.rows });
});

api.get("/campaigns", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT c.id,c.name,c.campaign_type,c.status,'Verified Nevada educator signals'::text AS audience_description,
            1 AS current_version,COALESCE(ss.subject_template,'Signal-specific sequence') AS subject,''::text AS preview_text,
            (SELECT count(*)::integer FROM sequence_enrollments se WHERE se.sequence_id=s.id) AS enrollment_count,
            (SELECT count(*)::integer FROM outbound_messages om JOIN sequence_enrollments se ON se.id=om.enrollment_id WHERE se.sequence_id=s.id AND om.sent_at IS NOT NULL) AS sent_count,
            '{"passed":true,"warnings":[]}'::text AS compliance_result_json,c.updated_at
     FROM campaigns c JOIN sequences s ON s.campaign_id=c.id LEFT JOIN sequence_steps ss ON ss.sequence_id=s.id AND ss.step_number=1
     ORDER BY c.updated_at DESC`);
  return c.json({ campaigns: rows.rows });
});

api.get("/approvals", (c) => c.json({ approvals: [], mode: "automatic_fail_closed" }));

api.get("/activity", async (c) => {
  const rows = await neonQuery(c.env,
    `SELECT id,'system' AS actor_type,'Signal OS' AS actor_name,action,metadata::text AS detail,
            CASE WHEN action LIKE '%blocked%' OR action LIKE '%dead_letter%' THEN 'warning' ELSE 'info' END AS severity,created_at AS occurred_at
     FROM audit_log ORDER BY created_at DESC LIMIT 150`);
  return c.json({ activity: rows.rows, generatedAt: nowIso() });
});

api.get("/analytics", async (c) => {
  const events = await neonQuery(c.env, `SELECT event_type,count(*)::integer AS count FROM message_events GROUP BY event_type ORDER BY count DESC`);
  const providers = await neonQuery(c.env, `SELECT provider,operation,sum(request_count)::integer AS requests,sum(result_count)::integer AS results,sum(cost)::text AS cost FROM provider_usage GROUP BY provider,operation ORDER BY provider`);
  return c.json({ events: events.rows, providers: providers.rows, funnel: await funnel(c.env) });
});

api.get("/agent-runs", async (c) => {
  const rows = await neonQuery(c.env, `SELECT id,job_kind AS agent_type,entity_id,status,attempt_count AS attempt,error_code,error_message,queued_at AS started_at,completed_at FROM pipeline_jobs ORDER BY queued_at DESC LIMIT 200`);
  return c.json({ runs: rows.rows });
});

api.post("/discovery/run-batch", zValidator("json", z.object({ limit: z.coerce.number().int().min(1).max(25).default(8) })), async (c) => {
  const run = await scheduleHourlyRun(c.env, Date.now());
  const jobs = run.jobs.slice(0, c.req.valid("json").limit);
  if (jobs.length) await c.env.AGENT_QUEUE.sendBatch(jobs.map((body) => ({ body, contentType: "json" as const })));
  return c.json({ status: run.duplicate ? "duplicate" : "queued", runId: run.runId, count: jobs.length }, 202);
});

for (const route of ["/leads/import", "/campaigns", "/consents"] as const) {
  api.post(route, (c) => c.json({ error: { code: "autonomous_only", message: "Manual lead and campaign writes are disabled in Signal OS v2." } }, 410));
}

async function funnel(env: Env) {
  const rows = await neonQuery<Record<string, string>>(env,
    `SELECT (SELECT count(*) FROM teacher_candidates)::text AS discovered,
            (SELECT count(*) FROM enrichment_results)::text AS enriched,
            (SELECT count(*) FROM email_validations WHERE validation_status='valid')::text AS validated,
            (SELECT count(*) FROM sequence_enrollments)::text AS enrolled,
            (SELECT count(DISTINCT om.qualified_lead_id) FROM message_events me JOIN outbound_messages om ON om.id=me.outbound_message_id WHERE me.event_type IN ('reply','positive_reply','negative_reply'))::text AS replied,
            (SELECT count(DISTINCT om.qualified_lead_id) FROM message_events me JOIN outbound_messages om ON om.id=me.outbound_message_id WHERE me.event_type='booking')::text AS booked`);
  const row = rows.rows[0] ?? {};
  return [["Discovered",row.discovered],["Enriched",row.enriched],["Validated",row.validated],["Enrolled",row.enrolled],["Replied",row.replied],["Booked",row.booked]].map(([label,value]) => ({ label, value: number(value) }));
}
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
