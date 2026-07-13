import { signalJobSchema, type SignalJob, professionalEmailGate } from "@agent-os/shared";
import type { Client } from "pg";
import { analyzeNevadaRetirementText, NEVADA_SCHOOL_DISTRICTS, type RetirementSearchPlan } from "./nevada-retirement-intelligence";
import { extractWithParallel, searchWithParallel, type ResearchCandidate } from "./parallel";
import { neonQuery, neonTransaction, withNeon } from "./neon";
import { evaluateSourceUrl, robotsDecision } from "./source-policy";
import { sha256, uuid } from "./utils";

const MAX_SOURCE_BYTES = 1_000_000;

export class PermanentJobError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

interface QueryRow { id: string; query_text: string; category: string; priority: "A" | "B" | "C"; }

export async function scheduleHourlyRun(env: Env, scheduledTime: number): Promise<{ runId: string; jobs: SignalJob[]; duplicate: boolean }> {
  return neonTransaction(env, async (client) => {
    const scheduledFor = new Date(scheduledTime).toISOString();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO search_runs (scheduled_for, metadata)
       VALUES ($1, jsonb_build_object('trigger','cloudflare_cron','cron','5 * * * *'))
       ON CONFLICT (scheduled_for) DO NOTHING RETURNING id`, [scheduledFor],
    );
    if (!inserted.rowCount) {
      const existing = await client.query<{ id: string }>("SELECT id FROM search_runs WHERE scheduled_for = $1", [scheduledFor]);
      return { runId: existing.rows[0]?.id ?? "", jobs: [], duplicate: true };
    }
    const runId = inserted.rows[0]!.id;
    const batchSize = configNumber(env.SEARCH_BATCH_SIZE, 8, 1, 25);
    const budget = await client.query<{ hourly: string; daily: string }>(
      `SELECT
         COALESCE(SUM(cost) FILTER (WHERE occurred_at >= date_trunc('hour', now())), 0)::text AS hourly,
         COALESCE(SUM(cost) FILTER (WHERE occurred_at >= date_trunc('day', now())), 0)::text AS daily
       FROM provider_usage`,
    );
    if (Number(budget.rows[0]?.hourly ?? 0) >= configNumber(env.MAX_HOURLY_SEARCH_COST, 10, 0, 10_000)
      || Number(budget.rows[0]?.daily ?? 0) >= configNumber(env.MAX_DAILY_SEARCH_COST, 100, 0, 100_000)) {
      await client.query("UPDATE search_runs SET status = 'skipped', completed_at = now(), metadata = metadata || '{\"reason\":\"provider_budget_reached\"}'::jsonb WHERE id = $1", [runId]);
      return { runId, jobs: [], duplicate: false };
    }
    const selected = await client.query<QueryRow>(
      `SELECT id, query_text, category, priority
       FROM signal_queries
       WHERE is_active AND next_run_at <= now() AND (locked_until IS NULL OR locked_until < now())
       ORDER BY CASE priority WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END, next_run_at, last_run_at NULLS FIRST
       FOR UPDATE SKIP LOCKED LIMIT $1`, [batchSize],
    );
    for (const query of selected.rows) {
      const cooldown = query.priority === "A" ? 60 : query.priority === "B" ? 240 : 720;
      await client.query(
        `UPDATE signal_queries SET locked_until = now() + interval '20 minutes', last_run_at = now(),
         next_run_at = now() + make_interval(mins => GREATEST(cooldown_minutes, $2)), updated_at = now() WHERE id = $1`,
        [query.id, cooldown],
      );
    }
    await client.query("UPDATE search_runs SET queries_selected = $2 WHERE id = $1", [runId, selected.rowCount]);
    const jobs = selected.rows.map((query) => signalJobSchema.parse({
      kind: "search-query",
      searchRunId: runId,
      queryId: query.id,
      idempotencyKey: `search:${runId}:${query.id}`,
    }));
    return { runId, jobs, duplicate: false };
  });
}

export async function processSignalJob(env: Env, raw: unknown): Promise<void> {
  const job = signalJobSchema.parse(raw);
  if (!(await claimJob(env, job))) return;
  try {
    switch (job.kind) {
      case "search-query": await runSearchQuery(env, job); break;
      case "crawl-source": await runSourceCrawl(env, job); break;
      case "resolve-teachers": await resolveTeachers(env, job); break;
      default: throw new PermanentJobError(`Unsupported pipeline job: ${job.kind}`, "unsupported_job");
    }
    await finishJob(env, job.idempotencyKey, "completed");
  } catch (error) {
    await finishJob(env, job.idempotencyKey, error instanceof PermanentJobError ? "blocked" : "failed", error);
    throw error;
  }
}

async function claimJob(env: Env, job: SignalJob): Promise<boolean> {
  return neonTransaction(env, async (client) => {
    await client.query(
      `INSERT INTO pipeline_jobs (idempotency_key, search_run_id, job_kind, entity_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING`,
      [job.idempotencyKey, "searchRunId" in job ? job.searchRunId : null, job.kind, entityId(job)],
    );
    const current = await client.query<{ status: string }>("SELECT status FROM pipeline_jobs WHERE idempotency_key = $1 FOR UPDATE", [job.idempotencyKey]);
    const status = current.rows[0]?.status;
    if (status === "completed" || status === "blocked") return false;
    await client.query(
      `UPDATE pipeline_jobs SET status = 'running', attempt_count = attempt_count + 1, started_at = now(), error_code = NULL, error_message = NULL
       WHERE idempotency_key = $1`, [job.idempotencyKey],
    );
    return true;
  });
}

function entityId(job: SignalJob): string | null {
  if ("sourceId" in job) return job.sourceId;
  if ("signalEventId" in job) return job.signalEventId;
  if ("qualifiedLeadId" in job) return job.qualifiedLeadId;
  if ("messageId" in job) return job.messageId;
  return "queryId" in job ? job.queryId : null;
}

async function finishJob(env: Env, key: string, status: "completed" | "failed" | "blocked", error?: unknown): Promise<void> {
  await neonQuery(env,
    `UPDATE pipeline_jobs SET status = $2, completed_at = now(), error_code = $3, error_message = $4 WHERE idempotency_key = $1`,
    [key, status, error instanceof PermanentJobError ? error.code : error ? "transient_failure" : null, error instanceof Error ? error.message.slice(0, 1_000) : null],
  );
}

async function runSearchQuery(env: Env, job: Extract<SignalJob, { kind: "search-query" }>): Promise<void> {
  const queryResult = await neonQuery<QueryRow>(env, "SELECT id, query_text, category, priority FROM signal_queries WHERE id = $1", [job.queryId]);
  const query = queryResult.rows[0];
  if (!query) throw new PermanentJobError("Signal query not found.", "query_not_found");
  const plan: RetirementSearchPlan = { id: query.id, query: query.query_text, category: mapCategory(query.category), sourceType: sourceTypeForCategory(query.category) };
  const started = Date.now();
  const requests: Array<Promise<ResearchCandidate[]>> = [];
  if (env.PARALLEL_API_KEY) requests.push(searchWithParallel(env, plan));
  if (env.TINYFISH_API_KEY) requests.push(searchTinyFish(env, plan));
  if (!requests.length) throw new PermanentJobError("No search provider is configured.", "search_provider_missing");
  const settled = await Promise.allSettled(requests);
  const candidates = dedupeCandidates(settled.flatMap((result) => result.status === "fulfilled" ? result.value : [])).slice(0, 30);
  if (!settled.some((result) => result.status === "fulfilled")) throw new Error("All configured search providers failed.");
  let queued = 0;
  for (const candidate of candidates) {
    const policy = evaluateSourceUrl(candidate.url, plan.sourceType);
    const source = await neonQuery<{ id: string }>(env,
      `INSERT INTO signal_sources (canonical_url, domain, source_type, source_title, policy_status, policy_reason, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at = now(), source_title = COALESCE(EXCLUDED.source_title, signal_sources.source_title)
       RETURNING id`,
      [policy.canonicalUrl, policy.domain, policy.sourceType, candidate.title, policy.status, policy.reason],
    );
    const sourceId = source.rows[0]!.id;
    if (policy.status === "allowed") {
      await env.AGENT_QUEUE.send({ kind: "crawl-source", searchRunId: job.searchRunId, sourceId, idempotencyKey: `crawl:${sourceId}:${job.searchRunId}` }, { contentType: "json" });
      queued += 1;
      await neonQuery(env, "UPDATE signal_sources SET crawl_status = 'queued' WHERE id = $1", [sourceId]);
    }
  }
  await neonQuery(env,
    `INSERT INTO provider_usage (search_run_id, provider, operation, request_count, result_count, latency_ms, status)
     VALUES ($1, 'parallel+tinyfish', 'search', $2, $3, $4, 'completed')`,
    [job.searchRunId, requests.length, candidates.length, Date.now() - started],
  );
  await neonQuery(env,
    `UPDATE search_runs SET queries_completed = queries_completed + 1, results_found = results_found + $2, sources_queued = sources_queued + $3 WHERE id = $1`,
    [job.searchRunId, candidates.length, queued],
  );
}

async function runSourceCrawl(env: Env, job: Extract<SignalJob, { kind: "crawl-source" }>): Promise<void> {
  const rows = await neonQuery<{ id: string; canonical_url: string; source_type: string; source_title: string | null; policy_status: string }>(
    env, "SELECT id, canonical_url, source_type, source_title, policy_status FROM signal_sources WHERE id = $1", [job.sourceId],
  );
  const source = rows.rows[0];
  if (!source || source.policy_status !== "allowed") throw new PermanentJobError("Source is not policy-allowed.", "source_not_allowed");
  const target = new URL(source.canonical_url);
  const userAgent = `${env.APP_NAME}/2.0 (+${env.PUBLIC_APP_URL}/crawler-policy)`;
  const robots = await robotsDecision(target, userAgent);
  await neonQuery(env, "UPDATE signal_sources SET robots_status = $2 WHERE id = $1", [source.id, robots.status]);
  if (!robots.allowed) {
    await neonQuery(env, "UPDATE signal_sources SET crawl_status = 'blocked', policy_status = 'rejected', policy_reason = 'robots_disallowed' WHERE id = $1", [source.id]);
    throw new PermanentJobError("robots.txt does not allow this crawl.", "robots_disallowed");
  }
  const page = await fetchPage(env, target, userAgent);
  const contentHash = await sha256(page.text);
  const r2Key = `signals/${source.id}/${contentHash}.${page.format === "markdown" ? "md" : "html"}`;
  await env.EVIDENCE.put(r2Key, page.text, {
    httpMetadata: { contentType: page.format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8" },
    customMetadata: { sourceId: source.id, canonicalUrl: source.canonical_url, sha256: contentHash, provider: page.provider },
  });
  const plainText = page.format === "html" ? stripMarkup(page.text) : page.text;
  const signals = analyzeNevadaRetirementText(plainText.slice(0, 100_000), { url: source.canonical_url, sourceType: source.source_type });
  let created = 0;
  for (const signal of signals) {
    const dedupeKey = await sha256([source.id, signal.signalType, signal.metadata.possible_event_or_effective_date ?? "", signal.signalPhrase.toLowerCase()].join(":"));
    const person = extractNamedEducator(signal.excerpt);
    const district = districtForDomain(target.hostname);
    const event = await neonQuery<{ id: string }>(env,
      `INSERT INTO signal_events (
         search_run_id, query_id, source_id, signal_category, signal_type, signal_phrase, signal_summary,
         evidence_excerpt, evidence_r2_key, published_at, event_date, effective_date, district_name, person_name,
         years_of_service, retirement_system, signal_score, source_reliability_score, evidence_confidence, dedupe_key, status
       ) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active')
       ON CONFLICT (dedupe_key) DO UPDATE SET updated_at = now(), evidence_r2_key = EXCLUDED.evidence_r2_key
       RETURNING id`,
      [job.searchRunId, source.id, signal.category, signal.signalType, signal.signalPhrase, signal.summary, signal.excerpt, r2Key,
        parseDate(signal.metadata.possible_event_or_effective_date), district, person?.fullName ?? null,
        typeof signal.metadata.years_of_service === "number" ? signal.metadata.years_of_service : null,
        /pers/i.test(`${signal.signalPhrase} ${signal.summary}`) ? "Nevada PERS" : null,
        signal.finalPriorityScore, Math.min(1, signal.sourceReliabilityScore / 1.3), signal.confidence, dedupeKey],
    );
    if (event.rowCount) {
      created += 1;
      const signalEventId = event.rows[0]!.id;
      await env.AGENT_QUEUE.send({ kind: "resolve-teachers", searchRunId: job.searchRunId, signalEventId, idempotencyKey: `resolve:${signalEventId}` }, { contentType: "json" });
    }
  }
  await neonQuery(env,
    `UPDATE signal_sources SET content_hash = $2, content_type = $3, r2_key = $4, last_crawled_at = now(), crawl_status = 'completed' WHERE id = $1`,
    [source.id, contentHash, page.contentType, r2Key],
  );
  await neonQuery(env, "UPDATE search_runs SET signals_created = signals_created + $2 WHERE id = $1", [job.searchRunId, created]);
}

async function resolveTeachers(env: Env, job: Extract<SignalJob, { kind: "resolve-teachers" }>): Promise<void> {
  const result = await neonQuery<{
    id: string; person_name: string | null; evidence_excerpt: string; district_name: string | null; signal_type: string;
    canonical_url: string; domain: string; signal_score: number;
  }>(env,
    `SELECT e.id, e.person_name, e.evidence_excerpt, e.district_name, e.signal_type, e.signal_score,
            s.canonical_url, s.domain
     FROM signal_events e JOIN signal_sources s ON s.id = e.source_id WHERE e.id = $1 AND e.status = 'active'`, [job.signalEventId],
  );
  const signal = result.rows[0];
  if (!signal) throw new PermanentJobError("Active signal not found.", "signal_not_found");
  const candidates = extractProfessionalTeachers(signal.evidence_excerpt, signal.domain, signal.district_name, signal.canonical_url);
  if (!candidates.length && signal.person_name) {
    const name = splitName(signal.person_name);
    if (name) candidates.push({ ...name, fullName: signal.person_name, jobTitle: "Teacher", email: null, school: null, district: signal.district_name ?? "Nevada public education", employerDomain: signal.domain, sourceUrl: signal.canonical_url, evidence: signal.evidence_excerpt, confidence: 0.8 });
  }
  for (const candidate of candidates) {
    if (candidate.email && !professionalEmailGate(candidate.email, candidate.employerDomain).passed) candidate.email = null;
    const candidateRow = await neonQuery<{ id: string }>(env,
      `INSERT INTO teacher_candidates (
         signal_event_id, first_name, last_name, full_name, job_title, school_name, school_district, employer_domain,
         public_work_email, source_url, employment_evidence, employment_confidence, signal_relationship, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'resolved')
       ON CONFLICT (signal_event_id, full_name, employer_domain) DO UPDATE SET
         public_work_email = COALESCE(EXCLUDED.public_work_email, teacher_candidates.public_work_email), last_verified_at = now()
       RETURNING id`,
      [signal.id, candidate.firstName, candidate.lastName, candidate.fullName, candidate.jobTitle, candidate.school,
        candidate.district, candidate.employerDomain, candidate.email, candidate.sourceUrl, candidate.evidence, candidate.confidence,
        signal.person_name ? "person_named_in_signal" : "district_signal_to_verified_employee"],
    );
    if (!candidateRow.rowCount) continue;
    const profile = await neonQuery<{ id: string }>(env,
      `INSERT INTO teacher_profiles (
         first_name,last_name,full_name,current_job_title,current_school,current_district,employer_domain,
         primary_source_url,identity_confidence,employment_status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified_current')
       ON CONFLICT (identity_key) DO UPDATE SET
         current_job_title = EXCLUDED.current_job_title, current_school = COALESCE(EXCLUDED.current_school, teacher_profiles.current_school),
         primary_source_url = EXCLUDED.primary_source_url, updated_at = now()
       RETURNING id`,
      [candidate.firstName, candidate.lastName, candidate.fullName, candidate.jobTitle, candidate.school, candidate.district,
        candidate.employerDomain, candidate.sourceUrl, candidate.confidence],
    );
    const teacherProfileId = profile.rows[0]!.id;
    await neonQuery(env,
      `INSERT INTO teacher_signal_links (teacher_profile_id, signal_event_id, relationship_type, confidence, is_primary)
       VALUES ($1,$2,$3,$4,true) ON CONFLICT (teacher_profile_id, signal_event_id) DO NOTHING`,
      [teacherProfileId, signal.id, signal.person_name ? "direct_public_signal" : "district_signal", candidate.confidence],
    );
    if (candidate.email) {
      await env.AGENT_QUEUE.send({ kind: "validate-email", teacherProfileId, signalEventId: signal.id, email: candidate.email, idempotencyKey: `validate:${teacherProfileId}:${candidate.email}` }, { contentType: "json" });
    } else {
      await env.AGENT_QUEUE.send({ kind: "enrich-teacher", teacherProfileId, signalEventId: signal.id, idempotencyKey: `enrich:${teacherProfileId}:${new Date().toISOString().slice(0, 7)}` }, { contentType: "json" });
    }
  }
}

async function searchTinyFish(env: Env, plan: RetirementSearchPlan): Promise<ResearchCandidate[]> {
  if (!env.TINYFISH_API_KEY) return [];
  const params = new URLSearchParams({ query: plan.query, location: "US", language: "en", recency_minutes: "129600" });
  const response = await fetch(`${env.TINYFISH_SEARCH_API_BASE}?${params}`, { headers: { "X-API-Key": env.TINYFISH_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`TinyFish Search returned HTTP ${response.status}.`);
  const data = await response.json<{ results?: Array<{ title?: string; url?: string; snippet?: string; published_at?: string }> }>();
  return (data.results ?? []).flatMap((item) => item.title && item.url ? [{ title: item.title, url: item.url, snippet: item.snippet, publishedAt: item.published_at, provider: "tinyfish" as const }] : []);
}

async function fetchPage(env: Env, target: URL, userAgent: string): Promise<{ text: string; format: "html" | "markdown"; provider: string; contentType: string }> {
  const errors: string[] = [];
  if (env.PARALLEL_API_KEY) {
    try { const page = await extractWithParallel(env, target.href); return { ...page, contentType: "text/markdown" }; } catch (error) { errors.push(String(error)); }
  }
  if (env.TINYFISH_API_KEY) {
    try {
      const response = await fetch(env.TINYFISH_FETCH_API_BASE, { method: "POST", headers: { "X-API-Key": env.TINYFISH_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ urls: [target.href], format: "markdown", ttl: 0 }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`TinyFish Fetch HTTP ${response.status}`);
      const payload = await response.json<{ results?: Array<{ text?: string }> }>();
      const text = payload.results?.[0]?.text ?? "";
      if (!text || new TextEncoder().encode(text).byteLength > MAX_SOURCE_BYTES) throw new Error("TinyFish content missing or oversized.");
      return { text, format: "markdown", provider: "tinyfish", contentType: "text/markdown" };
    } catch (error) { errors.push(String(error)); }
  }
  try {
    const response = await fetch(target, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain,application/pdf" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Native HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) throw new PermanentJobError(`Unsupported content type: ${contentType}`, "unsupported_content_type");
    const text = await readBounded(response, MAX_SOURCE_BYTES);
    return { text, format: contentType.includes("html") ? "html" : "markdown", provider: "native", contentType };
  } catch (error) { errors.push(String(error)); }
  throw new Error(`All source fetch methods failed: ${errors.join("; ")}`);
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new PermanentJobError("Source response exceeds size limit.", "response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new PermanentJobError("Source response exceeds size limit.", "response_too_large"); }
    chunks.push(part.value);
  }
  const data = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(data);
}

function extractProfessionalTeachers(text: string, employerDomain: string, district: string | null, sourceUrl: string) {
  const candidates: Array<{ firstName: string; lastName: string; fullName: string; jobTitle: string; email: string | null; school: string | null; district: string; employerDomain: string; sourceUrl: string; evidence: string; confidence: number }> = [];
  const normalized = stripMarkup(text).replace(/\r/g, "\n");
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const match of normalized.matchAll(emailPattern)) {
    const email = match[0].toLowerCase();
    if (!professionalEmailGate(email, employerDomain).passed) continue;
    const index = match.index ?? 0;
    const context = normalized.slice(Math.max(0, index - 220), Math.min(normalized.length, index + email.length + 220)).replace(/\s+/g, " ");
    const title = context.match(/\b(?:special education teacher|instructional coach|classroom teacher|lead teacher|senior teacher|teacher|counselor|librarian|faculty|professor|instructor)\b/i)?.[0];
    const nameMatch = context.match(/\b([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\b/);
    if (!title || !nameMatch) continue;
    const fullName = `${nameMatch[1]} ${nameMatch[2]}`;
    candidates.push({ firstName: nameMatch[1]!, lastName: nameMatch[2]!, fullName, jobTitle: title, email, school: null, district: district ?? "Nevada public education", employerDomain, sourceUrl, evidence: context.slice(0, 500), confidence: 0.85 });
  }
  return dedupeBy(candidates, (item) => `${item.fullName.toLowerCase()}:${item.email}`);
}

function extractNamedEducator(text: string): { fullName: string } | null {
  const direct = text.match(/\b(?:teacher|educator|instructor|professor)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)/);
  const reverse = text.match(/\b([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?),?\s+(?:a\s+)?(?:teacher|educator|instructor|professor)\b/);
  const match = direct ?? reverse;
  return match ? { fullName: `${match[1]} ${match[2]}` } : null;
}

function splitName(fullName: string): { firstName: string; lastName: string } | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return { firstName: parts[0]!, lastName: parts.at(-1)! };
}

function districtForDomain(domain: string): string | null {
  const normalized = domain.toLowerCase().replace(/^www\./, "");
  return NEVADA_SCHOOL_DISTRICTS.find((item) => normalized === item.domain || normalized.endsWith(`.${item.domain}`))?.name ?? null;
}

function sourceTypeForCategory(category: string): RetirementSearchPlan["sourceType"] {
  if (/board|district|retirement_application|workforce/.test(category)) return "district";
  if (/benefit|supplemental|service_credit|pre_retirement/.test(category)) return "benefits";
  if (/pers/.test(category)) return "retirement";
  return "news";
}

function mapCategory(category: string): RetirementSearchPlan["category"] {
  if (/board|retirement_application/.test(category)) return "board_records";
  if (/event|workshop|pre_retirement/.test(category)) return "events";
  if (/service_milestone/.test(category)) return "service_milestone";
  if (/workforce/.test(category)) return "workforce";
  if (/benefit|service_credit/.test(category)) return "benefits";
  if (/supplemental/.test(category)) return "financial_planning";
  if (/legislation|budget|pers_update/.test(category)) return "legislation";
  return "district";
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function stripMarkup(value: string): string { return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim(); }
function dedupeCandidates(items: ResearchCandidate[]): ResearchCandidate[] { return dedupeBy(items.filter((item) => evaluateSourceUrl(item.url).domain), (item) => evaluateSourceUrl(item.url).canonicalUrl.toLowerCase()); }
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function configNumber(value: unknown, fallback: number, min: number, max: number): number { const number = Number(value); return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback; }
