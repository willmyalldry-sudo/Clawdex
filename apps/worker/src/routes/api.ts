import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  approvalInputSchema,
  campaignInputSchema,
  checkCampaignCompliance,
  consentInputSchema,
  launchInputSchema,
  leadImportSchema,
  scoreLead,
  sourceInputSchema,
  BENJAMIN_WRITER_POLICY,
  BENJAMIN_WRITER_SYSTEM_PROMPT,
} from "@agent-os/shared";
import type { AppBindings } from "../lib/auth";
import { requireAccessUser } from "../lib/auth";
import { nowIso, normalizeEmail, sha256, uuid } from "../lib/utils";
import { writeActivity } from "../lib/db";
import { buildNevadaRetirementSearchCatalog, selectNevadaRetirementSearches } from "../lib/nevada-retirement-intelligence";

export const api = new Hono<AppBindings>();

api.use("*", requireAccessUser);

api.get("/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({
    ok: db?.ok === 1,
    service: c.env.APP_NAME,
    outreachMode: c.env.OUTREACH_MODE,
    researchProviders: { tinyfish: Boolean(c.env.TINYFISH_API_KEY), parallel: Boolean(c.env.PARALLEL_API_KEY) },
    enrichmentProviders: { apollo: Boolean(c.env.APOLLO_API_KEY), peopleDataLabs: Boolean(c.env.PDL_API_KEY) },
    emailProviders: {
      agentmail: Boolean(c.env.AGENTMAIL_API_KEY && c.env.AGENTMAIL_INBOX_ID),
      autosend: Boolean(c.env.AUTOSEND_API_KEY && c.env.AUTOSEND_PROJECT_ID),
      sendgrid: Boolean(c.env.SENDGRID_API_KEY),
    },
    retirementSearchCount: buildNevadaRetirementSearchCatalog().length,
    timestamp: nowIso(),
  });
});

api.get("/writer/policy", (c) => c.json({ policy: BENJAMIN_WRITER_POLICY, systemPrompt: BENJAMIN_WRITER_SYSTEM_PROMPT, mode: "draft_only_human_approval_required" }));

api.get("/dashboard", async (c) => {
  const results = await c.env.DB.batch([
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM leads WHERE status <> 'suppressed'"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM leads WHERE score >= 75 AND status NOT IN ('suppressed', 'booked')"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM signals WHERE discovered_at >= datetime('now', '-7 day')"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM bookings WHERE status = 'active' AND starts_at >= datetime('now')"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM campaigns WHERE status = 'pending_approval'"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM messages WHERE status = 'sent'"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM outreach_events WHERE event_type = 'reply'"),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM sources WHERE approved = 0 AND active = 1"),
  ]);
  const value = (index: number): number => Number((results[index]?.results[0] as { value?: number } | undefined)?.value ?? 0);
  return c.json({
    metrics: { totalLeads: value(0), highIntent: value(1), newSignals: value(2), upcomingBookings: value(3), pendingApprovals: value(4), sent: value(5), replies: value(6), sourceCandidates: value(7) },
    funnel: await funnel(c.env.DB),
    generatedAt: nowIso(),
  });
});

api.get("/leads", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 250);
  const rows = await c.env.DB.prepare(
    `SELECT l.*, o.name AS organization_name, o.district,
            (SELECT COUNT(*) FROM signals s WHERE s.lead_id = l.id) AS signal_count,
            (SELECT COUNT(*) FROM lead_evidence e WHERE e.lead_id = l.id) AS evidence_count
     FROM leads l LEFT JOIN organizations o ON o.id = l.organization_id
     WHERE (? = '' OR l.status = ?)
       AND (? = '' OR lower(l.first_name || ' ' || l.last_name || ' ' || COALESCE(l.email, '') || ' ' || COALESCE(l.title, '') || ' ' || COALESCE(o.name, '')) LIKE '%' || lower(?) || '%')
     ORDER BY l.score DESC, l.updated_at DESC LIMIT ?`,
  ).bind(status, status, q, q, limit).all();
  return c.json({ leads: rows.results });
});

api.get("/leads/:id", async (c) => {
  const lead = await c.env.DB.prepare(
    `SELECT l.*, o.name AS organization_name, o.district, o.website AS organization_website
     FROM leads l LEFT JOIN organizations o ON o.id = l.organization_id WHERE l.id = ?`,
  ).bind(c.req.param("id")).first();
  if (!lead) return c.json({ error: { code: "not_found", message: "Lead not found." } }, 404);
  const [evidence, signals, messages, consent] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM lead_evidence WHERE lead_id = ? ORDER BY retrieved_at DESC").bind(c.req.param("id")),
    c.env.DB.prepare("SELECT * FROM signals WHERE lead_id = ? ORDER BY discovered_at DESC").bind(c.req.param("id")),
    c.env.DB.prepare("SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at DESC").bind(c.req.param("id")),
    c.env.DB.prepare("SELECT * FROM consent_records WHERE lead_id = ? ORDER BY recorded_at DESC").bind(c.req.param("id")),
  ]);
  return c.json({ lead, evidence: evidence?.results ?? [], signals: signals?.results ?? [], messages: messages?.results ?? [], consent: consent?.results ?? [] });
});

api.post("/leads/import", zValidator("json", leadImportSchema), async (c) => {
  const { leads } = c.req.valid("json");
  const actor = c.get("actorEmail");
  let imported = 0;
  let duplicates = 0;
  for (const input of leads) {
    const email = normalizeEmail(input.email);
    if (email && await c.env.DB.prepare("SELECT 1 FROM leads WHERE lower(email) = ?").bind(email).first()) {
      duplicates += 1;
      continue;
    }
    let organizationId: string | null = null;
    if (input.organization) {
      const existing = await c.env.DB.prepare("SELECT id FROM organizations WHERE lower(name) = lower(?) LIMIT 1").bind(input.organization).first<{ id: string }>();
      organizationId = existing?.id ?? uuid();
      if (!existing) await c.env.DB.prepare("INSERT INTO organizations (id, name, city, state) VALUES (?, ?, ?, ?)").bind(organizationId, input.organization, input.city || null, input.state).run();
    }
    const id = uuid();
    const score = scoreLead({ state: input.state, title: input.title, yearsInEducation: input.yearsInEducation, emailStatus: email ? "pending" : "unknown", hasOrganization: Boolean(organizationId), hasSourceEvidence: Boolean(input.sourceUrl) });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO leads (id, first_name, last_name, email, email_status, phone, title, organization_id, city, state, years_in_education, score, status, source_summary, owner_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
      ).bind(id, input.firstName, input.lastName, email, email ? "pending" : "unknown", input.phone || null, input.title || null, organizationId, input.city || null, input.state, input.yearsInEducation ?? null, score, input.sourceUrl ? "Imported with source URL." : "Manual or CSV import.", actor, nowIso(), nowIso()),
      c.env.DB.prepare("INSERT INTO lead_search (lead_id, full_name, email, title, organization, city) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, `${input.firstName} ${input.lastName}`, email ?? "", input.title || "", input.organization || "", input.city || ""),
    ]);
    if (input.sourceUrl) {
      await c.env.DB.prepare(
        `INSERT INTO lead_evidence (id, lead_id, source_url, field_name, field_value, excerpt, confidence, content_hash, retrieved_at)
         VALUES (?, ?, ?, 'import_source', ?, 'Source supplied during import; review before use.', 0.5, ?, ?)`,
      ).bind(uuid(), id, input.sourceUrl, input.sourceUrl, await sha256(input.sourceUrl), nowIso()).run();
    }
    const runId = uuid();
    await c.env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json) VALUES (?, 'enrichment', 'lead', ?, 'queued', ?)")
      .bind(runId, id, JSON.stringify({ source: "import" })).run();
    await c.env.AGENT_QUEUE.send({ kind: "enrich-lead", leadId: id, runId });
    imported += 1;
  }
  await writeActivity(c.env.DB, { actorType: "user", actorName: actor, action: "leads.imported", entityType: "lead", detail: `Imported ${imported} leads; skipped ${duplicates} duplicates.`, severity: "success" });
  return c.json({ imported, duplicates }, 201);
});

api.post("/leads/:id/enrich", async (c) => {
  const runId = uuid();
  await c.env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json) VALUES (?, 'enrichment', 'lead', ?, 'queued', '{}')")
    .bind(runId, c.req.param("id")).run();
  await c.env.AGENT_QUEUE.send({ kind: "enrich-lead", leadId: c.req.param("id"), runId });
  return c.json({ runId, status: "queued" }, 202);
});

api.post("/leads/:id/validate-email", async (c) => {
  const runId = uuid();
  await c.env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json) VALUES (?, 'email_validation', 'lead', ?, 'queued', '{}')")
    .bind(runId, c.req.param("id")).run();
  await c.env.AGENT_QUEUE.send({ kind: "validate-email", leadId: c.req.param("id"), runId });
  return c.json({ runId, status: "queued" }, 202);
});

api.get("/signals", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*, l.first_name || ' ' || l.last_name AS lead_name, o.name AS organization_name, src.name AS source_name
     FROM signals s LEFT JOIN leads l ON l.id = s.lead_id LEFT JOIN organizations o ON o.id = COALESCE(s.organization_id, l.organization_id)
     LEFT JOIN sources src ON src.id = s.source_id ORDER BY s.discovered_at DESC LIMIT 200`,
  ).all();
  return c.json({ signals: rows.results });
});

api.get("/sources", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM sources ORDER BY approved ASC, active DESC, updated_at DESC").all();
  return c.json({ sources: rows.results });
});

api.post("/sources", zValidator("json", sourceInputSchema), async (c) => {
  const input = c.req.valid("json");
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO sources (id, name, url, source_type, crawl_frequency, robots_policy, approved, active, last_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, 'candidate_review', ?, ?)`,
  ).bind(id, input.name, input.url, input.sourceType, input.crawlFrequency, input.robotsPolicy, nowIso(), nowIso()).run();
  return c.json({ id, status: "candidate_review" }, 201);
});

api.post("/sources/:id/approval", zValidator("json", z.object({ approved: z.boolean() })), async (c) => {
  const { approved } = c.req.valid("json");
  await c.env.DB.prepare("UPDATE sources SET approved = ?, last_status = ?, updated_at = ? WHERE id = ?")
    .bind(approved ? 1 : 0, approved ? "approved" : "rejected", nowIso(), c.req.param("id")).run();
  await writeActivity(c.env.DB, { actorType: "user", actorName: c.get("actorEmail"), action: approved ? "source.approved" : "source.rejected", entityType: "source", entityId: c.req.param("id"), detail: approved ? "Approved source for robots-aware crawling." : "Rejected source candidate.", severity: approved ? "success" : "warning" });
  return c.json({ approved });
});

api.post("/sources/:id/crawl", async (c) => {
  const runId = uuid();
  await c.env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, entity_id, status, input_json) VALUES (?, 'crawler', 'source', ?, 'queued', '{}')")
    .bind(runId, c.req.param("id")).run();
  await c.env.AGENT_QUEUE.send({ kind: "crawl-source", sourceId: c.req.param("id"), runId });
  return c.json({ runId, status: "queued" }, 202);
});

api.post("/discovery/run", zValidator("json", z.object({ query: z.string().min(3).max(300).default("Nevada teachers retirement PERS 403(b) updates") })), async (c) => {
  const { query } = c.req.valid("json");
  const runId = uuid();
  await c.env.DB.prepare("INSERT INTO agent_runs (id, agent_type, entity_type, status, input_json) VALUES (?, 'source_scout', 'source', 'queued', ?)")
    .bind(runId, JSON.stringify({ query, provider: "tinyfish" })).run();
  await c.env.AGENT_QUEUE.send({ kind: "discover-web", query, runId });
  return c.json({ runId, status: "queued", provider: "multi" }, 202);
});

api.post("/discovery/run-batch", zValidator("json", z.object({
  limit: z.coerce.number().int().min(1).max(25).default(8),
  seed: z.string().trim().min(1).max(100).optional(),
})), async (c) => {
  const { limit, seed } = c.req.valid("json");
  const searches = selectNevadaRetirementSearches(seed ?? new Date().toISOString().slice(0, 10), limit);
  const jobs = searches.map((search) => ({ ...search, runId: uuid() }));
  await c.env.DB.batch(jobs.map((job) => c.env.DB.prepare(
    "INSERT INTO agent_runs (id, agent_type, entity_type, status, input_json) VALUES (?, 'source_scout', 'source', 'queued', ?)",
  ).bind(job.runId, JSON.stringify({
    trigger: "manual_batch",
    actor: c.get("actorEmail"),
    query: job.query,
    queryId: job.id,
    category: job.category,
  }))));
  await c.env.AGENT_QUEUE.sendBatch(jobs.map((job) => ({
    body: { kind: "discover-web", query: job.query, runId: job.runId, queryId: job.id, category: job.category, sourceType: job.sourceType },
  })));
  await writeActivity(c.env.DB, {
    actorType: "user",
    actorName: c.get("actorEmail"),
    action: "discovery.batch_queued",
    entityType: "agent_run",
    detail: `Queued ${jobs.length} rotated Nevada educator-retirement searches across Parallel and TinyFish.`,
    severity: "info",
  });
  return c.json({
    status: "queued",
    count: jobs.length,
    providers: { parallel: Boolean(c.env.PARALLEL_API_KEY), tinyfish: Boolean(c.env.TINYFISH_API_KEY) },
    runs: jobs.map((job) => ({ runId: job.runId, queryId: job.id, category: job.category, query: job.query })),
  }, 202);
});

api.get("/campaigns", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.*, cv.subject, cv.preview_text, cv.compliance_result_json,
            (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.campaign_id = c.id) AS enrollment_count,
            (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent_count
     FROM campaigns c JOIN campaign_versions cv ON cv.campaign_id = c.id AND cv.version = c.current_version
     ORDER BY c.updated_at DESC`,
  ).all();
  return c.json({ campaigns: rows.results });
});

api.post("/campaigns", zValidator("json", campaignInputSchema), async (c) => {
  const input = c.req.valid("json");
  const actor = c.get("actorEmail");
  const id = uuid();
  const versionId = uuid();
  const sequence = input.sequenceSteps ?? [{ delayDays: 0, subject: input.subject, bodyHtml: input.bodyHtml }];
  const checks = sequence.map((item) => checkCampaignCompliance({
    subject: item.subject,
    bodyHtml: item.bodyHtml,
    disclosure: input.disclosure,
    hasPhysicalAddress: !c.env.POSTAL_ADDRESS.startsWith("Configure"),
    hasUnsubscribeToken: item.bodyHtml.includes("{{unsubscribe_link}}"),
  }));
  const compliance = {
    passed: checks.every((item) => item.passed),
    blockers: [...new Set(checks.flatMap((item) => item.blockers))],
    warnings: [...new Set(checks.flatMap((item) => item.warnings))],
  };
  const versionPayload = { ...input, sequenceSteps: sequence, compliance };
  const contentHash = await sha256(JSON.stringify(versionPayload));
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO campaigns (id, name, campaign_type, status, audience_description, current_version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(id, input.name, input.campaignType, compliance.passed ? "pending_approval" : "draft", input.audienceDescription, actor, nowIso(), nowIso()),
    c.env.DB.prepare(
      `INSERT INTO campaign_versions (id, campaign_id, version, subject, preview_text, body_html, sequence_json, disclosure, compliance_result_json, content_hash, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(versionId, id, input.subject, input.previewText, input.bodyHtml, JSON.stringify(sequence), input.disclosure, JSON.stringify(compliance), contentHash, actor, nowIso()),
  ]);
  await writeActivity(c.env.DB, { actorType: "user", actorName: actor, action: compliance.passed ? "campaign.submitted" : "campaign.draft_blocked", entityType: "campaign", entityId: id, detail: compliance.passed ? "Campaign passed preflight and is awaiting approval." : `Campaign has ${compliance.blockers.length} compliance blocker(s).`, severity: compliance.passed ? "info" : "warning" });
  return c.json({ id, version: 1, status: compliance.passed ? "pending_approval" : "draft", compliance }, 201);
});

api.get("/approvals", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id AS campaign_id, c.name, c.campaign_type, c.audience_description, c.current_version,
            cv.subject, cv.preview_text, cv.body_html, cv.sequence_json, cv.disclosure, cv.compliance_result_json, cv.created_at
     FROM campaigns c JOIN campaign_versions cv ON cv.campaign_id = c.id AND cv.version = c.current_version
     WHERE c.status = 'pending_approval' ORDER BY cv.created_at ASC`,
  ).all();
  return c.json({ approvals: rows.results });
});

api.post("/campaigns/:id/approval", zValidator("json", approvalInputSchema), async (c) => {
  const input = c.req.valid("json");
  const campaign = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.current_version, c.status, cv.compliance_result_json, cv.content_hash, cv.subject, cv.body_html, cv.sequence_json, cv.disclosure
     FROM campaigns c JOIN campaign_versions cv ON cv.campaign_id = c.id AND cv.version = c.current_version WHERE c.id = ?`,
  ).bind(c.req.param("id")).first<Record<string, string | number>>();
  if (!campaign) return c.json({ error: { code: "not_found", message: "Campaign not found." } }, 404);
  const compliance = JSON.parse(String(campaign.compliance_result_json)) as { passed?: boolean; blockers?: string[] };
  if (input.decision === "approved" && !compliance.passed) return c.json({ error: { code: "compliance_blocked", message: "Resolve campaign compliance blockers before approval.", blockers: compliance.blockers ?? [] } }, 409);
  const approvalId = uuid();
  const archiveKey = `campaigns/${campaign.id}/v${campaign.current_version}-${campaign.content_hash}.json`;
  const archive = { campaignId: campaign.id, version: campaign.current_version, subject: campaign.subject, bodyHtml: campaign.body_html, sequence: JSON.parse(String(campaign.sequence_json)), disclosure: campaign.disclosure, decision: input.decision, reviewer: c.get("actorEmail"), reviewedAt: nowIso(), contentHash: campaign.content_hash };
  await c.env.EVIDENCE.put(archiveKey, JSON.stringify(archive), { httpMetadata: { contentType: "application/json" }, customMetadata: { campaignId: String(campaign.id), contentHash: String(campaign.content_hash) } });
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO approvals (id, campaign_id, version, decision, notes, reviewer_email, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(approvalId, campaign.id, campaign.current_version, input.decision, input.notes, c.get("actorEmail"), nowIso()),
    c.env.DB.prepare("UPDATE campaigns SET status = ?, approved_version = ?, approved_at = ?, updated_at = ? WHERE id = ?")
      .bind(input.decision === "approved" ? "approved" : "rejected", input.decision === "approved" ? campaign.current_version : null, input.decision === "approved" ? nowIso() : null, nowIso(), campaign.id),
    c.env.DB.prepare("UPDATE campaign_versions SET archive_key = ? WHERE campaign_id = ? AND version = ?")
      .bind(archiveKey, campaign.id, campaign.current_version),
  ]);
  await writeActivity(c.env.DB, { actorType: "user", actorName: c.get("actorEmail"), action: `campaign.${input.decision}`, entityType: "campaign", entityId: String(campaign.id), detail: `${input.decision === "approved" ? "Approved" : "Rejected"} ${campaign.name} version ${campaign.current_version}.`, severity: input.decision === "approved" ? "success" : "warning" });
  return c.json({ approvalId, decision: input.decision, archiveKey });
});

api.post("/campaigns/:id/launch", zValidator("json", launchInputSchema), async (c) => {
  const { leadIds } = c.req.valid("json");
  const campaign = await c.env.DB.prepare("SELECT id, status, approved_version FROM campaigns WHERE id = ?")
    .bind(c.req.param("id")).first<{ id: string; status: string; approved_version: number | null }>();
  if (!campaign || campaign.status !== "approved" || !campaign.approved_version) return c.json({ error: { code: "not_approved", message: "Only an approved campaign version can launch." } }, 409);
  let enrolled = 0;
  let skipped = 0;
  for (const leadId of leadIds) {
    const enrollmentId = uuid();
    const instanceId = `${campaign.id}-${campaign.approved_version}-${leadId}`;
    const result = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO sequence_enrollments (id, campaign_id, campaign_version, lead_id, workflow_instance_id, status, enrolled_by, enrolled_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(enrollmentId, campaign.id, campaign.approved_version, leadId, instanceId, c.get("actorEmail"), nowIso(), nowIso()).run();
    if ((result.meta.changes ?? 0) === 0) { skipped += 1; continue; }
    await c.env.OUTREACH_SEQUENCE.create({ id: instanceId, params: { enrollmentId, leadId, campaignId: campaign.id, campaignVersion: campaign.approved_version } });
    enrolled += 1;
  }
  await writeActivity(c.env.DB, { actorType: "user", actorName: c.get("actorEmail"), action: "campaign.launched", entityType: "campaign", entityId: campaign.id, detail: `Enrolled ${enrolled} leads; skipped ${skipped} existing enrollments.`, severity: "success" });
  return c.json({ enrolled, skipped }, 202);
});

api.post("/consents", zValidator("json", consentInputSchema), async (c) => {
  const input = c.req.valid("json");
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO consent_records (id, lead_id, channel, status, consent_text, source, ip_address, user_agent, recorded_by, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.leadId, input.channel, input.status, input.consentText, input.source, c.req.header("cf-connecting-ip") ?? null, c.req.header("user-agent") ?? null, c.get("actorEmail"), nowIso()).run();
  if (input.status === "revoked") {
    const lead = await c.env.DB.prepare("SELECT email, phone FROM leads WHERE id = ?").bind(input.leadId).first<{ email: string | null; phone: string | null }>();
    const channel = input.channel.startsWith("sms") ? "sms" : "email";
    const value = channel === "sms" ? lead?.phone : lead?.email;
    if (value) await c.env.DB.prepare("INSERT OR IGNORE INTO suppressions (id, lead_id, channel, value, reason, source) VALUES (?, ?, ?, ?, 'consent_revoked', 'consent_record')")
      .bind(uuid(), input.leadId, channel, value).run();
  }
  return c.json({ id }, 201);
});

api.get("/activity", async (c) => {
  const since = c.req.query("since") ?? "";
  const rows = await c.env.DB.prepare("SELECT * FROM activity_events WHERE (? = '' OR occurred_at > ?) ORDER BY occurred_at DESC LIMIT 150")
    .bind(since, since).all();
  return c.json({ activity: rows.results, generatedAt: nowIso() });
});

api.get("/analytics", async (c) => {
  const [events, sources, campaigns, runs] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT event_type, COUNT(*) AS count FROM outreach_events GROUP BY event_type ORDER BY count DESC"),
    c.env.DB.prepare("SELECT s.name, COUNT(sig.id) AS signal_count FROM sources s LEFT JOIN signals sig ON sig.source_id = s.id GROUP BY s.id ORDER BY signal_count DESC LIMIT 10"),
    c.env.DB.prepare("SELECT c.name, COUNT(m.id) AS messages, SUM(CASE WHEN m.status = 'sent' THEN 1 ELSE 0 END) AS sent FROM campaigns c LEFT JOIN messages m ON m.campaign_id = c.id GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 10"),
    c.env.DB.prepare("SELECT agent_type, status, COUNT(*) AS count FROM agent_runs GROUP BY agent_type, status ORDER BY agent_type"),
  ]);
  return c.json({ events: events?.results ?? [], sources: sources?.results ?? [], campaigns: campaigns?.results ?? [], agentRuns: runs?.results ?? [], funnel: await funnel(c.env.DB) });
});

api.get("/agent-runs", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 200").all();
  return c.json({ runs: rows.results });
});

async function funnel(db: D1Database): Promise<Array<{ label: string; value: number }>> {
  const result = await db.batch([
    db.prepare("SELECT COUNT(*) AS value FROM leads"),
    db.prepare("SELECT COUNT(*) AS value FROM leads WHERE email IS NOT NULL OR phone IS NOT NULL"),
    db.prepare("SELECT COUNT(*) AS value FROM leads WHERE email_status = 'valid'"),
    db.prepare("SELECT COUNT(DISTINCT lead_id) AS value FROM sequence_enrollments"),
    db.prepare("SELECT COUNT(DISTINCT lead_id) AS value FROM outreach_events WHERE event_type = 'reply'"),
    db.prepare("SELECT COUNT(DISTINCT lead_id) AS value FROM bookings WHERE status = 'active'"),
  ]);
  const labels = ["Discovered", "Enriched", "Validated", "Enrolled", "Replied", "Booked"];
  return labels.map((label, index) => ({ label, value: Number((result[index]?.results[0] as { value?: number } | undefined)?.value ?? 0) }));
}
