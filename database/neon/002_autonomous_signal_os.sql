BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.signal_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text text NOT NULL,
  category text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('A','B','C')),
  state text NOT NULL DEFAULT 'NV' CHECK (state = 'NV'),
  district_id text,
  provider_scope text[] NOT NULL DEFAULT ARRAY['parallel','tinyfish']::text[],
  cooldown_minutes integer NOT NULL CHECK (cooldown_minutes >= 60),
  is_active boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (query_text)
);
CREATE INDEX IF NOT EXISTS signal_queries_due_idx ON public.signal_queries (priority, next_run_at) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','partial','failed','skipped')),
  queries_selected integer NOT NULL DEFAULT 0,
  queries_completed integer NOT NULL DEFAULT 0,
  results_found integer NOT NULL DEFAULT 0,
  sources_queued integer NOT NULL DEFAULT 0,
  signals_created integer NOT NULL DEFAULT 0,
  provider_cost numeric(12,4) NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (scheduled_for)
);
CREATE INDEX IF NOT EXISTS search_runs_started_idx ON public.search_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.signal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_url text NOT NULL,
  domain text NOT NULL,
  source_type text NOT NULL,
  source_title text,
  policy_status text NOT NULL DEFAULT 'pending' CHECK (policy_status IN ('pending','allowed','rejected','quarantined')),
  policy_reason text,
  robots_status text NOT NULL DEFAULT 'unchecked' CHECK (robots_status IN ('unchecked','allowed','disallowed','unavailable')),
  http_status integer,
  content_type text,
  content_hash text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_crawled_at timestamptz,
  crawl_status text NOT NULL DEFAULT 'discovered' CHECK (crawl_status IN ('discovered','queued','crawling','completed','failed','blocked')),
  r2_key text,
  UNIQUE (canonical_url)
);
CREATE INDEX IF NOT EXISTS signal_sources_domain_idx ON public.signal_sources (domain, policy_status);
CREATE INDEX IF NOT EXISTS signal_sources_hash_idx ON public.signal_sources (content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_run_id uuid REFERENCES public.search_runs(id) ON DELETE SET NULL,
  query_id uuid REFERENCES public.signal_queries(id) ON DELETE SET NULL,
  source_id uuid NOT NULL REFERENCES public.signal_sources(id) ON DELETE RESTRICT,
  signal_category text NOT NULL,
  signal_type text NOT NULL,
  signal_phrase text,
  signal_summary text NOT NULL,
  evidence_excerpt text NOT NULL,
  evidence_r2_key text NOT NULL,
  published_at timestamptz,
  event_date date,
  effective_date date,
  district_name text,
  school_name text,
  person_name text,
  event_name text,
  years_of_service integer CHECK (years_of_service IS NULL OR years_of_service BETWEEN 0 AND 80),
  retirement_system text,
  signal_score integer NOT NULL CHECK (signal_score BETWEEN 0 AND 100),
  source_reliability_score numeric(4,3) NOT NULL CHECK (source_reliability_score BETWEEN 0 AND 1),
  evidence_confidence numeric(4,3) NOT NULL CHECK (evidence_confidence BETWEEN 0 AND 1),
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','stale','rejected','quarantined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);
CREATE INDEX IF NOT EXISTS signal_events_active_idx ON public.signal_events (signal_score DESC, created_at DESC) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS signal_events_person_idx ON public.signal_events (lower(person_name)) WHERE person_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.teacher_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_event_id uuid NOT NULL REFERENCES public.signal_events(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text NOT NULL,
  job_title text NOT NULL,
  department text,
  school_name text,
  school_district text NOT NULL,
  employer_domain text NOT NULL,
  staff_profile_url text,
  linkedin_url text,
  public_work_email text,
  source_url text NOT NULL,
  employment_evidence text NOT NULL,
  employment_confidence numeric(4,3) NOT NULL CHECK (employment_confidence BETWEEN 0 AND 1),
  signal_relationship text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','resolved','rejected','quarantined')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_candidates_professional_email CHECK (public_work_email IS NULL OR public_work_email = lower(public_work_email)),
  UNIQUE (signal_event_id, full_name, employer_domain)
);

CREATE TABLE IF NOT EXISTS public.teacher_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text NOT NULL,
  current_job_title text NOT NULL,
  current_school text,
  current_district text NOT NULL,
  employer_domain text NOT NULL,
  linkedin_url text,
  staff_profile_url text,
  primary_source_url text NOT NULL,
  identity_key text GENERATED ALWAYS AS (lower(btrim(full_name)) || '|' || lower(btrim(current_district)) || '|' || lower(btrim(employer_domain))) STORED,
  identity_confidence numeric(4,3) NOT NULL CHECK (identity_confidence BETWEEN 0 AND 1),
  employment_status text NOT NULL DEFAULT 'verified_current' CHECK (employment_status IN ('verified_current','unverified','former','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_linkedin_uidx ON public.teacher_profiles (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_staff_uidx ON public.teacher_profiles (lower(staff_profile_url)) WHERE staff_profile_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_identity_uidx ON public.teacher_profiles (lower(full_name), lower(current_district), lower(employer_domain));
CREATE UNIQUE INDEX IF NOT EXISTS teacher_profiles_identity_key_uidx ON public.teacher_profiles (identity_key);

CREATE TABLE IF NOT EXISTS public.teacher_signal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  signal_event_id uuid NOT NULL REFERENCES public.signal_events(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  confidence numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_profile_id, signal_event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS teacher_signal_primary_uidx ON public.teacher_signal_links (teacher_profile_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS public.enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apollo','people_data_labs')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','no_match','failed','skipped')),
  attempt_count integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  provider_cost numeric(12,4) NOT NULL DEFAULT 0,
  freshness_key text NOT NULL,
  UNIQUE (provider, freshness_key)
);

CREATE TABLE IF NOT EXISTS public.enrichment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  enrichment_job_id uuid REFERENCES public.enrichment_jobs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  job_title text,
  organization text,
  employer_domain text,
  linkedin_url text,
  professional_email text,
  match_confidence numeric(4,3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  raw_result_r2_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_profile_id, provider, professional_email)
);

CREATE TABLE IF NOT EXISTS public.email_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  domain text NOT NULL,
  provider text NOT NULL DEFAULT 'zerobounce',
  validation_status text NOT NULL,
  smtp_status text,
  is_disposable boolean NOT NULL DEFAULT false,
  is_role_address boolean NOT NULL DEFAULT false,
  is_free_provider boolean NOT NULL DEFAULT false,
  is_catch_all boolean NOT NULL DEFAULT false,
  is_employer_domain_match boolean NOT NULL DEFAULT false,
  risk_score integer NOT NULL DEFAULT 100 CHECK (risk_score BETWEEN 0 AND 100),
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  validated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (teacher_profile_id, email, validated_at)
);
CREATE INDEX IF NOT EXISTS email_validations_latest_idx ON public.email_validations (teacher_profile_id, validated_at DESC);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  campaign_type text NOT NULL DEFAULT 'signal_sequence' CHECK (campaign_type IN ('signal_sequence','newsletter')),
  state text NOT NULL DEFAULT 'NV',
  target_role_scope text[] NOT NULL,
  signal_category text,
  provider_mode text NOT NULL DEFAULT 'agentmail_only',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','blocked')),
  from_name text NOT NULL,
  from_email text NOT NULL,
  reply_to_email text NOT NULL,
  adviser_disclosure text NOT NULL,
  postal_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  duration_days integer NOT NULL DEFAULT 7 CHECK (duration_days BETWEEN 1 AND 30),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  stop_on_reply boolean NOT NULL DEFAULT true,
  stop_on_booking boolean NOT NULL DEFAULT true,
  stop_on_unsubscribe boolean NOT NULL DEFAULT true,
  stop_on_bounce boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, name)
);

CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number BETWEEN 1 AND 8),
  delay_hours integer NOT NULL CHECK (delay_hours BETWEEN 0 AND 720),
  message_goal text NOT NULL,
  subject_template text NOT NULL,
  body_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_number)
);

CREATE TABLE IF NOT EXISTS public.qualified_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_profile_id uuid NOT NULL REFERENCES public.teacher_profiles(id) ON DELETE RESTRICT,
  primary_signal_event_id uuid NOT NULL REFERENCES public.signal_events(id) ON DELETE RESTRICT,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  job_title text NOT NULL,
  school_name text,
  school_district text NOT NULL,
  employer_domain text NOT NULL,
  signal_category text NOT NULL,
  signal_summary text NOT NULL,
  source_url text NOT NULL,
  signal_date timestamptz NOT NULL,
  signal_score integer NOT NULL CHECK (signal_score BETWEEN 0 AND 100),
  qualification_score integer NOT NULL CHECK (qualification_score BETWEEN 0 AND 100),
  email_validation_status text NOT NULL CHECK (email_validation_status = 'valid'),
  email_validated_at timestamptz NOT NULL,
  provider_route text NOT NULL,
  outreach_status text NOT NULL DEFAULT 'qualified' CHECK (outreach_status IN ('qualified','enrolled','contacted','replied','booked','stopped','suppressed')),
  sequence_id uuid REFERENCES public.sequences(id) ON DELETE SET NULL,
  qualified_at timestamptz NOT NULL DEFAULT now(),
  last_contacted_at timestamptz,
  UNIQUE (teacher_profile_id, primary_signal_event_id),
  UNIQUE (email, primary_signal_event_id)
);
CREATE INDEX IF NOT EXISTS qualified_leads_status_idx ON public.qualified_leads (outreach_status, qualification_score DESC);

CREATE TABLE IF NOT EXISTS public.newsletter_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualified_lead_id uuid NOT NULL REFERENCES public.qualified_leads(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  school_district text NOT NULL,
  primary_signal_category text NOT NULL,
  source_campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  newsletter_consent_status text NOT NULL DEFAULT 'not_requested' CHECK (newsletter_consent_status IN ('not_requested','requested','granted','revoked')),
  consent_requested_at timestamptz,
  consent_granted_at timestamptz,
  consent_source text,
  consent_text_version text,
  suppressed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (qualified_lead_id),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  newsletter_candidate_id uuid NOT NULL REFERENCES public.newsletter_candidates(id) ON DELETE RESTRICT,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  consent_granted_at timestamptz NOT NULL,
  consent_source text NOT NULL,
  consent_text_version text NOT NULL,
  subscription_status text NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active','unsubscribed','suppressed')),
  unsubscribe_at timestamptz,
  last_newsletter_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_explicit_consent CHECK (btrim(consent_source) <> '' AND btrim(consent_text_version) <> ''),
  UNIQUE (newsletter_candidate_id),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.sequences(id) ON DELETE RESTRICT,
  qualified_lead_id uuid NOT NULL REFERENCES public.qualified_leads(id) ON DELETE RESTRICT,
  workflow_instance_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','stopped','blocked')),
  current_step integer NOT NULL DEFAULT 0,
  next_send_at timestamptz,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  stop_reason text,
  UNIQUE (sequence_id, qualified_lead_id),
  UNIQUE (workflow_instance_id)
);

CREATE TABLE IF NOT EXISTS public.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE,
  qualified_lead_id uuid NOT NULL REFERENCES public.qualified_leads(id) ON DELETE RESTRICT,
  signal_event_id uuid NOT NULL REFERENCES public.signal_events(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  provider_message_id text,
  step_number integer NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  source_url text NOT NULL,
  preflight_status text NOT NULL DEFAULT 'pending' CHECK (preflight_status IN ('pending','passed','blocked')),
  preflight_failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key),
  UNIQUE (provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS outbound_messages_due_idx ON public.outbound_messages (scheduled_at) WHERE delivery_status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.message_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_message_id uuid REFERENCES public.outbound_messages(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload_r2_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  teacher_profile_id uuid REFERENCES public.teacher_profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  source text NOT NULL,
  scope text NOT NULL DEFAULT 'global' CHECK (scope IN ('global','campaign','newsletter')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS suppressions_lookup_idx ON public.suppressions (lower(email), scope, expires_at);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  workflow_run_id text,
  rule_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  search_run_id uuid REFERENCES public.search_runs(id) ON DELETE SET NULL,
  job_kind text NOT NULL,
  entity_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','blocked','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.provider_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_run_id uuid REFERENCES public.search_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  operation text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  result_count integer NOT NULL DEFAULT 0,
  cost numeric(12,4) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_usage_budget_idx ON public.provider_usage (occurred_at, provider);

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
