import { qualifyTeacher, signalJobSchema, type SignalJob, professionalEmailGate } from "@agent-os/shared";
import { neonQuery, neonTransaction } from "./neon";
import { sha256, uuid } from "./utils";

type LeadJob = Extract<SignalJob, { kind: "enrich-teacher" | "validate-email" | "qualify-lead" | "enroll-lead" }>;

export async function processLeadPipelineJob(env: Env, raw: unknown): Promise<void> {
  const parsed = signalJobSchema.parse(raw);
  if (!["enrich-teacher", "validate-email", "qualify-lead", "enroll-lead"].includes(parsed.kind)) throw new Error(`Unsupported lead job ${parsed.kind}`);
  const job = parsed as LeadJob;
  if (!(await claim(env, job))) return;
  try {
    if (job.kind === "enrich-teacher") await enrichTeacher(env, job);
    else if (job.kind === "validate-email") await validateEmail(env, job);
    else if (job.kind === "qualify-lead") await qualifyLead(env, job);
    else await enrollLead(env, job);
    await finish(env, job.idempotencyKey, "completed");
  } catch (error) {
    await finish(env, job.idempotencyKey, "failed", error);
    throw error;
  }
}

async function enrichTeacher(env: Env, job: Extract<LeadJob, { kind: "enrich-teacher" }>): Promise<void> {
  const rows = await neonQuery<{
    id: string; first_name: string; last_name: string; full_name: string; current_job_title: string; current_school: string | null;
    current_district: string; employer_domain: string; linkedin_url: string | null; staff_profile_url: string | null; primary_source_url: string;
    signal_score: number;
  }>(env,
    `SELECT p.*, s.signal_score FROM teacher_profiles p JOIN signal_events s ON s.id = $2 WHERE p.id = $1`,
    [job.teacherProfileId, job.signalEventId],
  );
  const teacher = rows.rows[0];
  if (!teacher) throw new Error("Teacher profile or signal not found.");
  if (teacher.signal_score < configNumber(env.MIN_SIGNAL_SCORE, 60)) {
    await audit(env, "teacher_profile", teacher.id, "enrichment.skipped_low_signal", { signalScore: teacher.signal_score });
    return;
  }
  const providers: Array<"apollo" | "people_data_labs"> = env.APOLLO_API_KEY ? ["apollo"] : [];
  if (env.PDL_API_KEY) providers.push("people_data_labs");
  if (!providers.length) {
    await audit(env, "teacher_profile", teacher.id, "enrichment.blocked_provider_missing", {});
    return;
  }
  let matchedEmail: string | null = null;
  for (const provider of providers) {
    if (provider === "people_data_labs" && matchedEmail) break;
    const freshnessKey = `${teacher.id}:${new Date().toISOString().slice(0, 7)}`;
    const jobRow = await neonQuery<{ id: string }>(env,
      `INSERT INTO enrichment_jobs (teacher_profile_id, provider, status, attempt_count, started_at, freshness_key)
       VALUES ($1,$2,'running',1,now(),$3) ON CONFLICT (provider, freshness_key) DO UPDATE SET attempt_count = enrichment_jobs.attempt_count + 1, started_at = now(), status = 'running' RETURNING id`,
      [teacher.id, provider, freshnessKey],
    );
    const providerJobId = jobRow.rows[0]!.id;
    const started = Date.now();
    try {
      const result = provider === "apollo" ? await apolloMatch(env, teacher) : await pdlMatch(env, teacher);
      const rawKey = `enrichment/${teacher.id}/${provider}/${Date.now()}.json`;
      await env.EVIDENCE.put(rawKey, JSON.stringify(result.raw), { httpMetadata: { contentType: "application/json" }, customMetadata: { provider, teacherProfileId: teacher.id } });
      if (result.email && professionalEmailGate(result.email, teacher.employer_domain).passed) matchedEmail = result.email;
      await neonTransaction(env, async (client) => {
        await client.query(
          `INSERT INTO enrichment_results (teacher_profile_id, enrichment_job_id, provider, job_title, organization, employer_domain, linkedin_url, professional_email, match_confidence, raw_result_r2_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (teacher_profile_id, provider, professional_email) DO NOTHING`,
          [teacher.id, providerJobId, provider, result.jobTitle, result.organization, result.employerDomain, result.linkedinUrl, matchedEmail, result.confidence, rawKey],
        );
        await client.query("UPDATE enrichment_jobs SET status = $2, completed_at = now() WHERE id = $1", [providerJobId, result.matched ? "completed" : "no_match"]);
        if (result.linkedinUrl) await client.query("UPDATE teacher_profiles SET linkedin_url = COALESCE(linkedin_url, $2), updated_at = now() WHERE id = $1", [teacher.id, result.linkedinUrl]);
        await client.query(
          `INSERT INTO provider_usage (provider, operation, result_count, latency_ms, status) VALUES ($1,'people_enrichment',$2,$3,'completed')`,
          [provider, result.matched ? 1 : 0, Date.now() - started],
        );
      });
    } catch (error) {
      await neonQuery(env, "UPDATE enrichment_jobs SET status = 'failed', error_code = 'provider_error', completed_at = now() WHERE id = $1", [providerJobId]);
      if (provider === "apollo" && env.PDL_API_KEY) continue;
      throw error;
    }
  }
  if (matchedEmail) {
    await env.AGENT_QUEUE.send({ kind: "validate-email", teacherProfileId: teacher.id, signalEventId: job.signalEventId, email: matchedEmail, idempotencyKey: `validate:${teacher.id}:${matchedEmail}` }, { contentType: "json" });
  } else {
    await audit(env, "teacher_profile", teacher.id, "enrichment.no_professional_email", { providers });
  }
}

async function validateEmail(env: Env, job: Extract<LeadJob, { kind: "validate-email" }>): Promise<void> {
  const profile = await neonQuery<{ employer_domain: string }>(env, "SELECT employer_domain FROM teacher_profiles WHERE id = $1", [job.teacherProfileId]);
  const employerDomain = profile.rows[0]?.employer_domain;
  if (!employerDomain) throw new Error("Teacher profile not found.");
  const localGate = professionalEmailGate(job.email, employerDomain);
  if (!localGate.passed) {
    await audit(env, "teacher_profile", job.teacherProfileId, "email.blocked_local_gate", { reasons: localGate.reasons });
    return;
  }
  if (!env.BOUNCER_API_KEY) {
    await audit(env, "teacher_profile", job.teacherProfileId, "email.blocked_validator_missing", {});
    return;
  }
  const params = new URLSearchParams({ email: job.email });
  const started = Date.now();
  const response = await fetch(`${env.BOUNCER_API_BASE}/email/verify?${params}`, { headers: { "x-api-key": env.BOUNCER_API_KEY }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Bouncer returned HTTP ${response.status}.`);
  const data = await response.json<Record<string, unknown>>();
  const status = stringValue(data.status).toLowerCase() || "unknown";
  const domain = (data.domain ?? {}) as Record<string, unknown>;
  const account = (data.account ?? {}) as Record<string, unknown>;
  const isRole = stringValue(account.role).toLowerCase() === "yes";
  const isCatchAll = stringValue(domain.acceptAll).toLowerCase() === "yes";
  const isDisposable = stringValue(domain.disposable).toLowerCase() === "yes";
  const isFree = stringValue(domain.free).toLowerCase() === "yes";
  const clean = status === "deliverable" && !isRole && !isCatchAll && !isDisposable && !isFree;
  await neonQuery(env,
    `INSERT INTO email_validations (
       teacher_profile_id,email,domain,provider,validation_status,smtp_status,is_disposable,is_role_address,is_free_provider,is_catch_all,
       is_employer_domain_match,risk_score,provider_metadata,expires_at
     ) VALUES ($1,$2,$3,'bouncer',$4,$5,$6,$7,$8,$9,true,$10,$11,now() + make_interval(days => $12))`,
    [job.teacherProfileId, job.email.toLowerCase(), employerDomain, clean ? "valid" : status, stringValue(data.reason) || null,
      isDisposable, isRole, isFree, isCatchAll, clean ? 0 : 100, JSON.stringify(redactValidation(data)), configNumber(env.EMAIL_VALIDATION_MAX_AGE_DAYS, 30)],
  );
  await neonQuery(env,
    `INSERT INTO provider_usage (provider, operation, result_count, latency_ms, status) VALUES ('bouncer','email_validation',1,$1,'completed')`,
    [Date.now() - started],
  );
  if (clean) {
    await env.AGENT_QUEUE.send({ kind: "qualify-lead", teacherProfileId: job.teacherProfileId, signalEventId: job.signalEventId, idempotencyKey: `qualify:${job.teacherProfileId}:${job.signalEventId}` }, { contentType: "json" });
  } else {
    await audit(env, "teacher_profile", job.teacherProfileId, "email.validation_rejected", { status, reason: stringValue(data.reason) });
  }
}

async function qualifyLead(env: Env, job: Extract<LeadJob, { kind: "qualify-lead" }>): Promise<void> {
  const rows = await neonQuery<Record<string, unknown>>(env,
    `SELECT p.current_job_title, p.current_district, p.employer_domain, p.identity_confidence, p.employment_status,
            COALESCE(tc.employment_confidence, 0) AS employment_confidence,
            s.status AS signal_status, s.signal_score, COALESCE(s.published_at, s.created_at) AS signal_date,
            s.evidence_excerpt, src.canonical_url AS source_url, s.signal_category, s.signal_summary,
            v.email, v.validation_status, v.validated_at, v.is_disposable, v.is_role_address, v.is_free_provider, v.is_catch_all, v.is_employer_domain_match,
            EXISTS (SELECT 1 FROM suppressions x WHERE lower(x.email)=lower(v.email) AND (x.expires_at IS NULL OR x.expires_at > now())) AS is_suppressed,
            EXISTS (SELECT 1 FROM message_events me JOIN outbound_messages om ON om.id=me.outbound_message_id WHERE om.qualified_lead_id IN (SELECT id FROM qualified_leads WHERE teacher_profile_id=p.id) AND me.event_type IN ('reply','positive_reply','negative_reply','booking','unsubscribe','complaint','hard_bounce','invalid_email','rejected','spam_report')) AS has_terminal_event,
            EXISTS (SELECT 1 FROM sequence_enrollments se JOIN qualified_leads ql ON ql.id=se.qualified_lead_id WHERE ql.teacher_profile_id=p.id AND se.status='active') AS has_active_enrollment,
            p.first_name,p.last_name,p.current_school
     FROM teacher_profiles p
     JOIN signal_events s ON s.id=$2
     JOIN signal_sources src ON src.id=s.source_id
     LEFT JOIN teacher_candidates tc ON tc.signal_event_id=s.id AND lower(tc.full_name)=lower(p.full_name)
     JOIN LATERAL (SELECT * FROM email_validations ev WHERE ev.teacher_profile_id=p.id ORDER BY ev.validated_at DESC LIMIT 1) v ON true
     WHERE p.id=$1`, [job.teacherProfileId, job.signalEventId],
  );
  const row = rows.rows[0];
  if (!row) throw new Error("Qualification record not found.");
  const result = qualifyTeacher({
    jobTitle: String(row.current_job_title), currentDistrict: String(row.current_district), employerDomain: String(row.employer_domain),
    identityConfidence: Number(row.identity_confidence), employmentConfidence: Number(row.employment_confidence), employmentStatus: String(row.employment_status),
    signalStatus: String(row.signal_status), signalScore: Number(row.signal_score), signalDate: new Date(String(row.signal_date)),
    evidenceExcerpt: String(row.evidence_excerpt), sourceUrl: String(row.source_url), email: String(row.email), validationStatus: String(row.validation_status),
    validatedAt: new Date(String(row.validated_at)), isDisposable: Boolean(row.is_disposable), isRoleAddress: Boolean(row.is_role_address),
    isFreeProvider: Boolean(row.is_free_provider), isCatchAll: Boolean(row.is_catch_all), isEmployerDomainMatch: Boolean(row.is_employer_domain_match),
    isSuppressed: Boolean(row.is_suppressed), hasTerminalEvent: Boolean(row.has_terminal_event), hasActiveEnrollment: Boolean(row.has_active_enrollment),
    minSignalScore: configNumber(env.MIN_SIGNAL_SCORE, 60), minQualificationScore: configNumber(env.MIN_QUALIFICATION_SCORE, 75),
    minIdentityConfidence: configNumber(env.MIN_IDENTITY_CONFIDENCE, 0.8), minEmploymentConfidence: configNumber(env.MIN_EMPLOYMENT_CONFIDENCE, 0.8),
    maxSignalAgeDays: configNumber(env.MAX_SIGNAL_AGE_DAYS, 90), validationMaxAgeDays: configNumber(env.EMAIL_VALIDATION_MAX_AGE_DAYS, 30),
  });
  if (!result.qualified) {
    await audit(env, "teacher_profile", job.teacherProfileId, "qualification.blocked", { blockers: result.blockers, score: result.score, signalEventId: job.signalEventId });
    return;
  }
  const lead = await neonTransaction(env, async (client) => {
    const sequence = await client.query<{ id: string }>("SELECT id FROM sequences WHERE status='active' ORDER BY created_at LIMIT 1");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO qualified_leads (
         teacher_profile_id,primary_signal_event_id,email,first_name,last_name,job_title,school_name,school_district,employer_domain,
         signal_category,signal_summary,source_url,signal_date,signal_score,qualification_score,email_validation_status,email_validated_at,provider_route,sequence_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'valid',$16,$17,$18)
       ON CONFLICT (teacher_profile_id, primary_signal_event_id) DO UPDATE SET qualification_score=EXCLUDED.qualification_score RETURNING id`,
      [job.teacherProfileId, job.signalEventId, row.email, row.first_name, row.last_name, row.current_job_title, row.current_school, row.current_district,
        row.employer_domain, row.signal_category, row.signal_summary, row.source_url, row.signal_date, row.signal_score, result.score, row.validated_at,
        String(env.EMAIL_PROVIDER_MODE || "agentmail_only"), sequence.rows[0]?.id ?? null],
    );
    const id = inserted.rows[0]!.id;
    await client.query(
      `INSERT INTO newsletter_candidates (qualified_lead_id,email,first_name,last_name,school_district,primary_signal_category)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (qualified_lead_id) DO NOTHING`,
      [id, row.email, row.first_name, row.last_name, row.current_district, row.signal_category],
    );
    return id;
  });
  await env.AGENT_QUEUE.send({ kind: "enroll-lead", qualifiedLeadId: lead, idempotencyKey: `enroll:${lead}` }, { contentType: "json" });
}

async function enrollLead(env: Env, job: Extract<LeadJob, { kind: "enroll-lead" }>): Promise<void> {
  const enrollment = await neonTransaction(env, async (client) => {
    const lead = await client.query<{ sequence_id: string | null }>("SELECT sequence_id FROM qualified_leads WHERE id=$1 AND outreach_status='qualified' FOR UPDATE", [job.qualifiedLeadId]);
    const sequenceId = lead.rows[0]?.sequence_id;
    if (!sequenceId) return null;
    const workflowId = `signal-${job.qualifiedLeadId}-${await sha256(sequenceId).then((value) => value.slice(0, 12))}`;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sequence_enrollments (sequence_id,qualified_lead_id,workflow_instance_id,status,next_send_at)
       VALUES ($1,$2,$3,'active',now()) ON CONFLICT (sequence_id,qualified_lead_id) DO NOTHING RETURNING id`,
      [sequenceId, job.qualifiedLeadId, workflowId],
    );
    if (!inserted.rowCount) return null;
    await client.query("UPDATE qualified_leads SET outreach_status='enrolled' WHERE id=$1", [job.qualifiedLeadId]);
    return { id: inserted.rows[0]!.id, sequenceId, workflowId };
  });
  if (!enrollment) return;
  await env.OUTREACH_SEQUENCE.create({ id: enrollment.workflowId, params: { enrollmentId: enrollment.id, qualifiedLeadId: job.qualifiedLeadId, sequenceId: enrollment.sequenceId } });
}

async function apolloMatch(env: Env, teacher: Record<string, unknown>) {
  const response = await fetch(`${env.APOLLO_API_BASE}/people/match`, {
    method: "POST", headers: { "x-api-key": env.APOLLO_API_KEY ?? "", "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ first_name: teacher.first_name, last_name: teacher.last_name, organization_name: teacher.current_district, domain: teacher.employer_domain, linkedin_url: teacher.linkedin_url ?? undefined, reveal_personal_emails: false, reveal_phone_number: false, run_waterfall_email: false, run_waterfall_phone: false }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return { matched: false, email: null, jobTitle: null, organization: null, employerDomain: null, linkedinUrl: null, confidence: 0, raw: {} };
  if (!response.ok) throw new Error(`Apollo returned HTTP ${response.status}.`);
  const raw = await response.json<Record<string, unknown>>();
  const person = objectValue(raw.person); const organization = objectValue(person.organization);
  const email = stringValue(person.email).toLowerCase() || null;
  return { matched: Boolean(person.id), email, jobTitle: stringValue(person.title) || null, organization: stringValue(organization.name) || null, employerDomain: stringValue(organization.primary_domain) || null, linkedinUrl: stringValue(person.linkedin_url) || null, confidence: stringValue(person.email_status).toLowerCase() === "verified" ? 0.95 : 0.8, raw: redactProvider(raw) };
}

async function pdlMatch(env: Env, teacher: Record<string, unknown>) {
  const params = new URLSearchParams({ first_name: String(teacher.first_name), last_name: String(teacher.last_name), company: String(teacher.current_district), website: String(teacher.employer_domain), region: "Nevada", country: "US", min_likelihood: "7" });
  const response = await fetch(`${env.PDL_API_BASE}/person/enrich?${params}`, { headers: { "X-Api-Key": env.PDL_API_KEY ?? "", Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return { matched: false, email: null, jobTitle: null, organization: null, employerDomain: null, linkedinUrl: null, confidence: 0, raw: {} };
  if (!response.ok) throw new Error(`People Data Labs returned HTTP ${response.status}.`);
  const raw = await response.json<Record<string, unknown>>();
  const workEmails = Array.isArray(raw.work_email) ? raw.work_email : Array.isArray(raw.emails) ? raw.emails : [];
  const email = workEmails.map((value) => typeof value === "string" ? value : stringValue(objectValue(value).address)).find(Boolean) ?? null;
  return { matched: Boolean(raw.id), email, jobTitle: stringValue(raw.job_title) || null, organization: stringValue(raw.job_company_name) || null, employerDomain: stringValue(raw.job_company_website) || null, linkedinUrl: stringValue(raw.linkedin_url) || null, confidence: Math.min(1, Number(raw.likelihood ?? 0) / 10), raw: redactProvider(raw) };
}

async function claim(env: Env, job: LeadJob): Promise<boolean> {
  return neonTransaction(env, async (client) => {
    await client.query(`INSERT INTO pipeline_jobs (idempotency_key,job_kind,entity_id) VALUES ($1,$2,$3) ON CONFLICT (idempotency_key) DO NOTHING`, [job.idempotencyKey, job.kind, "qualifiedLeadId" in job ? job.qualifiedLeadId : job.teacherProfileId]);
    const row = await client.query<{ status: string }>("SELECT status FROM pipeline_jobs WHERE idempotency_key=$1 FOR UPDATE", [job.idempotencyKey]);
    if (["completed", "blocked"].includes(row.rows[0]?.status ?? "")) return false;
    await client.query("UPDATE pipeline_jobs SET status='running',attempt_count=attempt_count+1,started_at=now() WHERE idempotency_key=$1", [job.idempotencyKey]);
    return true;
  });
}
async function finish(env: Env, key: string, status: string, error?: unknown) { await neonQuery(env, "UPDATE pipeline_jobs SET status=$2,completed_at=now(),error_code=$3,error_message=$4 WHERE idempotency_key=$1", [key, status, error ? "provider_or_database_error" : null, error instanceof Error ? error.message.slice(0, 1_000) : null]); }
async function audit(env: Env, entityType: string, entityId: string, action: string, metadata: Record<string, unknown>) { await neonQuery(env, "INSERT INTO audit_log (entity_type,entity_id,action,rule_version,metadata) VALUES ($1,$2,$3,'signal-os-v2',$4)", [entityType, entityId, action, JSON.stringify(metadata)]); }
function redactValidation(data: Record<string, unknown>) { return { status: data.status, reason: data.reason, domain: data.domain, account: data.account, score: data.score }; }
function redactProvider(raw: Record<string, unknown>) { const copy = structuredClone(raw); for (const key of ["phone", "phone_numbers", "personal_emails", "street_address", "address"]) delete copy[key]; return copy; }
function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function configNumber(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
