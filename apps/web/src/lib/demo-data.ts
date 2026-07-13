import type { Activity, Approval, Campaign, DashboardData, Lead, Signal, Source } from "./types";

export const demoDashboard: DashboardData = {
  metrics: { totalLeads: 248, highIntent: 37, newSignals: 18, upcomingBookings: 6, pendingApprovals: 2, sent: 126, replies: 19, sourceCandidates: 8 },
  funnel: [
    { label: "Discovered", value: 248 }, { label: "Enriched", value: 196 }, { label: "Validated", value: 163 },
    { label: "Enrolled", value: 91 }, { label: "Replied", value: 19 }, { label: "Booked", value: 6 },
  ],
  generatedAt: new Date().toISOString(),
};

export const demoLeads: Lead[] = [
  { id: "b1111111-1111-4111-8111-111111111111", first_name: "Maria", last_name: "Santos", email: "maria.santos@example.invalid", email_status: "valid", title: "Mathematics Teacher", organization_name: "Silverado High School", district: "Clark County School District", city: "Las Vegas", state: "NV", years_in_education: 24, score: 92, status: "ready", signal_count: 3, evidence_count: 4, last_signal_at: new Date(Date.now() - 2 * 864e5).toISOString() },
  { id: "b2222222-2222-4222-8222-222222222222", first_name: "David", last_name: "Kim", email: "david.kim@example.invalid", email_status: "valid", title: "School Counselor", organization_name: "Depoali Middle School", district: "Washoe County School District", city: "Reno", state: "NV", years_in_education: 18, score: 81, status: "review", signal_count: 2, evidence_count: 3, last_signal_at: new Date(Date.now() - 6 * 864e5).toISOString() },
  { id: "b3333333-3333-4333-8333-333333333333", first_name: "Tanya", last_name: "Reed", email: "tanya.reed@example.invalid", email_status: "risky", title: "Assistant Principal", organization_name: "Carson High School", district: "Carson City School District", city: "Carson City", state: "NV", years_in_education: 21, score: 76, status: "enriching", signal_count: 1, evidence_count: 2, last_signal_at: new Date(Date.now() - 12 * 864e5).toISOString() },
  { id: "b4444444-4444-4444-8444-444444444444", first_name: "Robert", last_name: "Lewis", email: "robert.lewis@example.invalid", email_status: "pending", title: "Science Teacher", organization_name: "Silverado High School", district: "Clark County School District", city: "Henderson", state: "NV", years_in_education: 12, score: 64, status: "new", signal_count: 0, evidence_count: 1, last_signal_at: null },
  { id: "b5555555-5555-4555-8555-555555555555", first_name: "Angela", last_name: "Brooks", email: null, email_status: "unavailable", title: "Elementary Educator", organization_name: null, district: null, city: "North Las Vegas", state: "NV", years_in_education: 16, score: 52, status: "enriching", signal_count: 1, evidence_count: 1, last_signal_at: new Date(Date.now() - 25 * 864e5).toISOString() },
];

export const demoSignals: Signal[] = [
  { id: "c1", signal_type: "retirement_update", title: "Nevada PERS resource update detected", summary: "A monitored retirement resource changed and may support a timely educational newsletter.", source_url: "https://www.nvpers.org", source_excerpt: "Plan resource page content changed.", confidence: .96, discovered_at: new Date(Date.now() - 864e5).toISOString(), status: "reviewed", lead_name: null, organization_name: null, source_name: "Nevada PERS Updates" },
  { id: "c2", signal_type: "career_tenure", title: "Long-tenured Nevada educator profile updated", summary: "District profile indicates sustained Nevada public-school service. Review for an educational retirement-planning connection.", source_url: "https://newsroom.ccsd.net", source_excerpt: "Staff recognition profile updated this week.", confidence: .91, discovered_at: new Date(Date.now() - 2 * 864e5).toISOString(), status: "new", lead_name: "Maria Santos", organization_name: "Silverado High School", source_name: "Clark County Schools News" },
  { id: "c3", signal_type: "role_change", title: "School leadership role announcement", summary: "Public announcement indicates a new leadership role and a potential benefits transition conversation.", source_url: "https://www.washoeschools.net", source_excerpt: "Leadership appointments announced for the school year.", confidence: .84, discovered_at: new Date(Date.now() - 12 * 864e5).toISOString(), status: "new", lead_name: "Tanya Reed", organization_name: "Carson High School", source_name: "Washoe County Schools" },
];

export const demoCampaigns: Campaign[] = [
  { id: "d1", name: "Nevada Educator Retirement Checkup", campaign_type: "sequence", status: "pending_approval", audience_description: "Nevada educators with validated email and evidence-backed scores above 70.", current_version: 1, subject: "A retirement checklist for Nevada educators", preview_text: "Three topics to review before your next benefits meeting.", enrollment_count: 0, sent_count: 0, compliance_result_json: '{"passed":true,"blockers":[],"warnings":[]}', updated_at: new Date(Date.now() - 2 * 36e5).toISOString() },
  { id: "d2", name: "Monthly PERS & 403(b) Brief", campaign_type: "newsletter", status: "draft", audience_description: "Contacts with active email newsletter consent.", current_version: 1, subject: "Nevada educator retirement brief", preview_text: "A monthly educational summary.", enrollment_count: 66, sent_count: 63, compliance_result_json: '{"passed":true,"blockers":[],"warnings":["Consent audience must be selected."]}', updated_at: new Date(Date.now() - 4 * 36e5).toISOString() },
  { id: "d3", name: "Benefits Transition Follow-up", campaign_type: "sequence", status: "approved", audience_description: "Educators with a cited public role-change signal.", current_version: 2, subject: "Organizing questions after a benefits change", preview_text: "A short educational checklist.", enrollment_count: 25, sent_count: 21, compliance_result_json: '{"passed":true,"blockers":[],"warnings":[]}', updated_at: new Date(Date.now() - 2 * 864e5).toISOString() },
];

export const demoApprovals: Approval[] = [
  { campaign_id: "d1", name: "Nevada Educator Retirement Checkup", campaign_type: "sequence", audience_description: "Nevada educators with validated email and an evidence-backed score above 70.", current_version: 1, subject: "A retirement checklist for Nevada educators", preview_text: "Three topics to review before your next benefits meeting.", body_html: "<p>Hi {{first_name}},</p><p>I work with Nevada educators who want to organize their questions around PERS, 403(b) accounts, and retirement transitions.</p><p>If a short educational retirement-readiness review would be useful, you can choose a time here: {{booking_link}}</p><p>{{unsubscribe_link}}</p>", disclosure: "Educational information only. This communication is not individualized investment, tax, or legal advice.", compliance_result_json: '{"passed":true,"blockers":[],"warnings":[]}', created_at: new Date(Date.now() - 2 * 36e5).toISOString() },
];

export const demoActivity: Activity[] = [
  { id: "f1", actor_type: "agent", actor_name: "TinyFish Source Scout", action: "sources.discovered", detail: "Found 8 public source candidates; each requires human approval.", severity: "success", occurred_at: new Date(Date.now() - 8 * 60e3).toISOString() },
  { id: "f2", actor_type: "agent", actor_name: "Signal Analyst", action: "signal.discovered", detail: "Detected a Nevada retirement resource update.", severity: "success", occurred_at: new Date(Date.now() - 18 * 60e3).toISOString() },
  { id: "f3", actor_type: "agent", actor_name: "Email Validator", action: "lead.validated", detail: "Validated Maria Santos' professional email.", severity: "success", occurred_at: new Date(Date.now() - 36 * 60e3).toISOString() },
  { id: "f4", actor_type: "user", actor_name: "Benjamin Persyn", action: "campaign.submitted", detail: "Submitted Nevada Educator Retirement Checkup for approval.", severity: "info", occurred_at: new Date(Date.now() - 2 * 36e5).toISOString() },
  { id: "f5", actor_type: "system", actor_name: "Compliance Guard", action: "campaign.blocked", detail: "Newsletter remains in draft until a consented audience is selected.", severity: "warning", occurred_at: new Date(Date.now() - 4 * 36e5).toISOString() },
];

export const demoSources: Source[] = [
  { id: "s1", name: "Nevada PERS Updates", url: "https://www.nvpers.org", source_type: "retirement", crawl_frequency: "weekly", approved: 1, active: 1, last_status: "healthy", last_crawled_at: new Date(Date.now() - 864e5).toISOString() },
  { id: "s2", name: "Clark County Schools News", url: "https://newsroom.ccsd.net", source_type: "district", crawl_frequency: "daily", approved: 1, active: 1, last_status: "healthy", last_crawled_at: new Date(Date.now() - 5 * 36e5).toISOString() },
  { id: "s3", name: "Nevada educator retirement news result", url: "https://example.org/candidate", source_type: "news", crawl_frequency: "manual", approved: 0, active: 1, last_status: "candidate_review", last_crawled_at: null },
];
