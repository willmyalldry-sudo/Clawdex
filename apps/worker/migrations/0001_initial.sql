PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL DEFAULT 'school',
  district TEXT,
  city TEXT,
  state TEXT NOT NULL DEFAULT 'NV',
  website TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  crawl_frequency TEXT NOT NULL DEFAULT 'weekly',
  robots_policy TEXT NOT NULL DEFAULT 'honor',
  approved INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  last_crawled_at TEXT,
  last_status TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  email_status TEXT NOT NULL DEFAULT 'unknown',
  phone TEXT,
  title TEXT,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  city TEXT,
  state TEXT NOT NULL DEFAULT 'NV',
  years_in_education INTEGER,
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'new',
  source_summary TEXT,
  last_signal_at TEXT,
  last_contacted_at TEXT,
  owner_email TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_leads_email_unique ON leads(lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX idx_leads_status_score ON leads(status, score DESC);
CREATE INDEX idx_leads_org ON leads(organization_id);

CREATE TABLE lead_evidence (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  excerpt TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  content_hash TEXT,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_lead_evidence_lead ON lead_evidence(lead_id);

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_excerpt TEXT,
  evidence_hash TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  occurred_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'new',
  UNIQUE(evidence_hash, signal_type)
);

CREATE INDEX idx_signals_discovered ON signals(discovered_at DESC);
CREATE INDEX idx_signals_lead ON signals(lead_id);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'sequence',
  status TEXT NOT NULL DEFAULT 'draft',
  audience_description TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  approved_version INTEGER,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campaign_versions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body_html TEXT NOT NULL,
  sequence_json TEXT NOT NULL,
  disclosure TEXT NOT NULL,
  compliance_result_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  archive_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_id, version)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  decision TEXT NOT NULL,
  notes TEXT,
  reviewer_email TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_approvals_campaign ON approvals(campaign_id, version);

CREATE TABLE consent_records (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  source TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consent_active ON consent_records(lead_id, channel, recorded_at DESC);

CREATE TABLE suppressions (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, value)
);

CREATE TABLE sequence_enrollments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_version INTEGER NOT NULL,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workflow_instance_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  current_step INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  enrolled_by TEXT NOT NULL,
  enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(campaign_id, campaign_version, lead_id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  campaign_version INTEGER,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  sequence_step INTEGER NOT NULL DEFAULT 0,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  provider_message_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_lead ON messages(lead_id, created_at DESC);
CREATE INDEX idx_messages_status ON messages(status, created_at);

CREATE TABLE outreach_events (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX idx_outreach_events_occurred ON outreach_events(occurred_at DESC);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'calendly',
  provider_event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  input_json TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX idx_agent_runs_status ON agent_runs(status, started_at DESC);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_activity_occurred ON activity_events(occurred_at DESC);

CREATE TABLE processed_messages (
  id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_receipts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE lead_search USING fts5(
  lead_id UNINDEXED,
  full_name,
  email,
  title,
  organization,
  city,
  tokenize='porter unicode61'
);

CREATE TRIGGER leads_after_delete AFTER DELETE ON leads BEGIN
  DELETE FROM lead_search WHERE lead_id = old.id;
END;
