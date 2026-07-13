export type PageId = "dashboard" | "leads" | "signals" | "campaigns" | "approvals" | "analytics" | "sources" | "mcp" | "settings";

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_status: string;
  title: string | null;
  organization_name: string | null;
  district: string | null;
  city: string | null;
  state: string;
  years_in_education: number | null;
  score: number;
  status: string;
  signal_count: number;
  evidence_count: number;
  last_signal_at: string | null;
}

export interface Signal {
  id: string;
  signal_type: string;
  title: string;
  summary: string;
  source_url: string;
  source_excerpt: string | null;
  confidence: number;
  discovered_at: string;
  status: string;
  lead_name: string | null;
  organization_name: string | null;
  source_name: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
  audience_description: string;
  current_version: number;
  subject: string;
  preview_text: string;
  enrollment_count: number;
  sent_count: number;
  compliance_result_json: string;
  updated_at: string;
}

export interface Approval {
  campaign_id: string;
  name: string;
  campaign_type: string;
  audience_description: string;
  current_version: number;
  subject: string;
  preview_text: string;
  body_html: string;
  disclosure: string;
  compliance_result_json: string;
  created_at: string;
}

export interface Activity {
  id: string;
  actor_type: string;
  actor_name: string;
  action: string;
  detail: string;
  severity: string;
  occurred_at: string;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  source_type: string;
  crawl_frequency: string;
  approved: number;
  active: number;
  last_status: string | null;
  last_crawled_at: string | null;
}

export interface DashboardData {
  metrics: { totalLeads: number; highIntent: number; newSignals: number; upcomingBookings: number; pendingApprovals: number; sent: number; replies: number; sourceCandidates: number };
  funnel: Array<{ label: string; value: number }>;
  generatedAt: string;
}
