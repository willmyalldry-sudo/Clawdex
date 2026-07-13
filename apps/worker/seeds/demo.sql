PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO organizations (id, name, organization_type, district, city, state, website) VALUES
('11111111-1111-4111-8111-111111111111', 'Silverado High School', 'school', 'Clark County School District', 'Las Vegas', 'NV', 'https://www.ccsd.net'),
('22222222-2222-4222-8222-222222222222', 'Depoali Middle School', 'school', 'Washoe County School District', 'Reno', 'NV', 'https://www.washoeschools.net'),
('33333333-3333-4333-8333-333333333333', 'Carson High School', 'school', 'Carson City School District', 'Carson City', 'NV', 'https://www.carsoncityschools.com');

INSERT OR IGNORE INTO sources (id, name, url, source_type, crawl_frequency, approved, active, last_status) VALUES
('a1111111-1111-4111-8111-111111111111', 'Nevada PERS Updates', 'https://www.nvpers.org', 'retirement', 'weekly', 1, 1, 'healthy'),
('a2222222-2222-4222-8222-222222222222', 'Clark County Schools News', 'https://newsroom.ccsd.net', 'district', 'daily', 1, 1, 'healthy'),
('a3333333-3333-4333-8333-333333333333', 'Washoe County Schools', 'https://www.washoeschools.net', 'district', 'weekly', 1, 1, 'healthy');

INSERT OR IGNORE INTO leads (id, first_name, last_name, email, email_status, phone, title, organization_id, city, state, years_in_education, score, status, source_summary, last_signal_at) VALUES
('b1111111-1111-4111-8111-111111111111', 'Maria', 'Santos', 'maria.santos@example.invalid', 'valid', NULL, 'Mathematics Teacher', '11111111-1111-4111-8111-111111111111', 'Las Vegas', 'NV', 24, 92, 'ready', 'Public district staff profile and licensed professional data.', datetime('now', '-2 day')),
('b2222222-2222-4222-8222-222222222222', 'David', 'Kim', 'david.kim@example.invalid', 'valid', NULL, 'School Counselor', '22222222-2222-4222-8222-222222222222', 'Reno', 'NV', 18, 81, 'review', 'Licensed enrichment with public school affiliation.', datetime('now', '-6 day')),
('b3333333-3333-4333-8333-333333333333', 'Tanya', 'Reed', 'tanya.reed@example.invalid', 'risky', NULL, 'Assistant Principal', '33333333-3333-4333-8333-333333333333', 'Carson City', 'NV', 21, 76, 'enriching', 'Public leadership announcement.', datetime('now', '-12 day')),
('b4444444-4444-4444-8444-444444444444', 'Robert', 'Lewis', 'robert.lewis@example.invalid', 'pending', NULL, 'Science Teacher', '11111111-1111-4111-8111-111111111111', 'Henderson', 'NV', 12, 64, 'new', 'CSV import awaiting validation.', NULL),
('b5555555-5555-4555-8555-555555555555', 'Angela', 'Brooks', NULL, 'unavailable', NULL, 'Elementary Educator', NULL, 'North Las Vegas', 'NV', 16, 52, 'enriching', 'Public professional association directory.', datetime('now', '-25 day'));

INSERT OR IGNORE INTO lead_search (lead_id, full_name, email, title, organization, city) VALUES
('b1111111-1111-4111-8111-111111111111', 'Maria Santos', 'maria.santos@example.invalid', 'Mathematics Teacher', 'Silverado High School', 'Las Vegas'),
('b2222222-2222-4222-8222-222222222222', 'David Kim', 'david.kim@example.invalid', 'School Counselor', 'Depoali Middle School', 'Reno'),
('b3333333-3333-4333-8333-333333333333', 'Tanya Reed', 'tanya.reed@example.invalid', 'Assistant Principal', 'Carson High School', 'Carson City'),
('b4444444-4444-4444-8444-444444444444', 'Robert Lewis', 'robert.lewis@example.invalid', 'Science Teacher', 'Silverado High School', 'Henderson'),
('b5555555-5555-4555-8555-555555555555', 'Angela Brooks', '', 'Elementary Educator', '', 'North Las Vegas');

INSERT OR IGNORE INTO signals (id, lead_id, organization_id, source_id, signal_type, title, summary, source_url, source_excerpt, evidence_hash, confidence, discovered_at, status) VALUES
('c1111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'career_tenure', 'Long-tenured Nevada educator profile updated', 'District profile indicates sustained Nevada public-school service. Review for an educational retirement-planning connection.', 'https://newsroom.ccsd.net', 'Staff recognition profile updated this week.', 'demo-signal-1', 0.91, datetime('now', '-2 day'), 'new'),
('c2222222-2222-4222-8222-222222222222', NULL, NULL, 'a1111111-1111-4111-8111-111111111111', 'retirement_update', 'Nevada PERS resource update detected', 'A monitored retirement resource changed and may support a timely educational newsletter.', 'https://www.nvpers.org', 'Plan resource page content changed.', 'demo-signal-2', 0.96, datetime('now', '-1 day'), 'reviewed'),
('c3333333-3333-4333-8333-333333333333', 'b3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333', 'a3333333-3333-4333-8333-333333333333', 'role_change', 'School leadership role announcement', 'Public announcement indicates a new leadership role and a potential benefits transition conversation.', 'https://www.washoeschools.net', 'Leadership appointments announced for the school year.', 'demo-signal-3', 0.84, datetime('now', '-12 day'), 'new');

INSERT OR IGNORE INTO campaigns (id, name, campaign_type, status, audience_description, current_version, created_by) VALUES
('d1111111-1111-4111-8111-111111111111', 'Nevada Educator Retirement Checkup', 'sequence', 'pending_approval', 'Nevada educators with validated email and an evidence-backed retirement-relevance score above 70.', 1, 'demo@agentos.local'),
('d2222222-2222-4222-8222-222222222222', 'Monthly PERS & 403(b) Brief', 'newsletter', 'draft', 'Contacts with active email newsletter consent.', 1, 'demo@agentos.local');

INSERT OR IGNORE INTO campaign_versions (id, campaign_id, version, subject, preview_text, body_html, sequence_json, disclosure, compliance_result_json, content_hash, created_by) VALUES
('e1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 1, 'A retirement checklist for Nevada educators', 'Three topics to review before your next benefits meeting.', '<p>Hi {{first_name}},</p><p>I work with Nevada educators who want to organize their questions around PERS, 403(b) accounts, and retirement transitions.</p><p>If a short educational retirement-readiness review would be useful, you can choose a time here: {{booking_link}}</p><p>Best,<br>Benjamin</p><p>{{unsubscribe_link}}</p>', '[{"delayDays":0,"subject":"A retirement checklist for Nevada educators","bodyHtml":"<p>Hi {{first_name}},</p><p>I work with Nevada educators who want to organize their questions around PERS, 403(b) accounts, and retirement transitions.</p><p>If a short educational retirement-readiness review would be useful, you can choose a time here: {{booking_link}}</p><p>Best,<br>Benjamin</p><p>{{unsubscribe_link}}</p>"},{"delayDays":4,"subject":"Three retirement questions worth organizing","bodyHtml":"<p>Hi {{first_name}},</p><p>A useful first step is organizing questions about pension timing, employer-plan accounts, and the transition from work to retirement.</p><p>I would be glad to offer an educational review: {{booking_link}}</p><p>{{unsubscribe_link}}</p>"},{"delayDays":6,"subject":"A Nevada educator retirement resource","bodyHtml":"<p>Hi {{first_name}},</p><p>I wanted to share one more invitation to organize your retirement questions before making any decisions.</p><p>You can choose a convenient time here: {{booking_link}}</p><p>{{unsubscribe_link}}</p>"},{"delayDays":11,"subject":"Closing the loop on your retirement checklist","bodyHtml":"<p>Hi {{first_name}},</p><p>I will close the loop for now. If an educational retirement-readiness conversation becomes useful, my calendar is here: {{booking_link}}</p><p>{{unsubscribe_link}}</p>"}]', 'Educational information only. This communication is not individualized investment, tax, or legal advice.', '{"passed":true,"blockers":[],"warnings":[]}', 'demo-campaign-hash-1', 'demo@agentos.local'),
('e2222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222', 1, 'Nevada educator retirement brief', 'A monthly educational summary.', '<p>Monthly educational update for Nevada educators.</p><p>{{unsubscribe_link}}</p>', '[{"delayDays":0,"subject":"Nevada educator retirement brief","bodyHtml":"<p>Monthly educational update for Nevada educators.</p><p>{{unsubscribe_link}}</p>"}]', 'Educational information only. This communication is not individualized investment, tax, or legal advice.', '{"passed":true,"blockers":[],"warnings":[]}', 'demo-campaign-hash-2', 'demo@agentos.local');

INSERT OR IGNORE INTO activity_events (id, actor_type, actor_name, action, entity_type, entity_id, detail, severity, occurred_at) VALUES
('f1111111-1111-4111-8111-111111111111', 'agent', 'Signal Analyst', 'signal.discovered', 'signal', 'c2222222-2222-4222-8222-222222222222', 'Detected a Nevada retirement resource update.', 'success', datetime('now', '-18 minute')),
('f2222222-2222-4222-8222-222222222222', 'agent', 'Email Validator', 'lead.validated', 'lead', 'b1111111-1111-4111-8111-111111111111', 'Validated Maria Santos'' professional email.', 'success', datetime('now', '-36 minute')),
('f3333333-3333-4333-8333-333333333333', 'user', 'Benjamin Persyn', 'campaign.submitted', 'campaign', 'd1111111-1111-4111-8111-111111111111', 'Submitted Nevada Educator Retirement Checkup for approval.', 'info', datetime('now', '-2 hour')),
('f4444444-4444-4444-8444-444444444444', 'system', 'Compliance Guard', 'campaign.blocked', 'campaign', 'd2222222-2222-4222-8222-222222222222', 'Newsletter remains in draft until consent audience is selected.', 'warning', datetime('now', '-4 hour'));

INSERT OR IGNORE INTO settings (key, value, updated_by) VALUES
('booking_url', 'https://calendly.com/bpersyn/appointment-for-investment', 'system'),
('compliance_officer_email', 'configure@example.com', 'system'),
('demo_mode', 'true', 'system');
