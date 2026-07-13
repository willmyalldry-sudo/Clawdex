ALTER TABLE signals ADD COLUMN signal_category TEXT;
ALTER TABLE signals ADD COLUMN intent_score INTEGER CHECK (intent_score BETWEEN 0 AND 100);
ALTER TABLE signals ADD COLUMN source_reliability_score REAL CHECK (source_reliability_score BETWEEN 0 AND 2);
ALTER TABLE signals ADD COLUMN final_priority_score INTEGER CHECK (final_priority_score BETWEEN 0 AND 100);
ALTER TABLE signals ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending_human_review';
ALTER TABLE signals ADD COLUMN human_review_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE signals ADD COLUMN outreach_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signals ADD COLUMN suppression_reason TEXT;
ALTER TABLE signals ADD COLUMN metadata_json TEXT;

CREATE INDEX idx_signals_priority ON signals(final_priority_score DESC, discovered_at DESC);
CREATE INDEX idx_signals_verification ON signals(verification_status, human_review_required, outreach_eligible);

INSERT OR IGNORE INTO sources
  (id, name, url, source_type, crawl_frequency, robots_policy, approved, active, last_status)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Nevada PERS', 'https://www.nvpers.org/front', 'retirement', 'daily', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000002', 'Nevada Public Employees Retirement Law - NRS 286', 'https://www.leg.state.nv.us/nrs/NRS-286.html', 'retirement', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000003', 'Nevada Department of Education District Directory', 'https://doe.nv.gov/school-and-district-information', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000004', 'Nevada Public Employees Benefits Program', 'https://pebp.nv.gov/', 'benefits', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000005', 'IRS Publication 571 - 403(b) Plans', 'https://www.irs.gov/publications/p571', 'benefits', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000006', 'IRS 401(k) and Profit-Sharing Contribution Limits', 'https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-401k-and-profit-sharing-plan-contribution-limits', 'benefits', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000101', 'Carson City School District', 'https://www.carsoncityschools.com/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000102', 'Churchill County School District', 'https://www.churchillcsd.com/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000103', 'Clark County School District', 'https://www.ccsd.net/', 'district', 'daily', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000104', 'Douglas County School District', 'https://www.dcsd.net/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000105', 'Elko County School District', 'https://www.ecsdnv.net/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000106', 'Esmeralda County School District', 'https://www.esmeralda.k12.nv.us/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000107', 'Eureka County School District', 'https://www.eureka.k12.nv.us/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000108', 'Humboldt County School District', 'https://www.hcsdnv.com/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000109', 'Lander County School District', 'https://www.lander.k12.nv.us/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000110', 'Lincoln County School District', 'https://lcsdnv.com/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000111', 'Lyon County School District', 'https://www.lyoncsd.org/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000112', 'Mineral County School District', 'https://nvmcsd.org/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000113', 'Nye County School District', 'https://www.nye.k12.nv.us/', 'district', 'weekly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000114', 'Pershing County School District', 'https://www.pcsdnv.com/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000115', 'Storey County School District', 'https://www.storeynv.com/', 'district', 'monthly', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000116', 'Washoe County School District', 'https://www.washoeschools.net/', 'district', 'daily', 'honor', 1, 1, 'approved'),
  ('20000000-0000-4000-8000-000000000117', 'White Pine County School District', 'https://www.whitepine.k12.nv.us/', 'district', 'monthly', 'honor', 1, 1, 'approved');

INSERT OR REPLACE INTO settings (key, value, updated_by) VALUES
  ('retirement_search_profile', 'nevada-educator-v1', 'system'),
  ('public_contact_policy', 'Employer-published professional contact information only; no personal phone, home address, private source, guessed email, or anonymous-user identification.', 'system'),
  ('signal_outreach_default', 'human_review_required', 'system');
