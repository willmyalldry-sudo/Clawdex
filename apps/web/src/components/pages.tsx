import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity, ArrowRight, BarChart3, Bot, CalendarCheck, Check, CheckCircle2, ChevronRight, CircleDot,
  Clock3, DatabaseZap, Download, ExternalLink, FileCheck2, Filter, Globe2, Inbox, KeyRound,
  Mail, MailCheck, MessageSquareReply, MoreHorizontal, Plus, Radar, RefreshCw, Search, Send,
  ShieldAlert, ShieldCheck, Signal as SignalIcon, Smartphone, Sparkles, Target, Upload, UserCheck, Users, XCircle,
} from "lucide-react";
import type { Activity as ActivityType, Approval, Campaign, DashboardData, Lead, Signal, Source } from "../lib/types";
import { MetricCard, Modal, PageHeader, ScoreRing, StatusBadge, EmptyState, timeAgo } from "./ui";

type Action = (path: string, body?: unknown) => Promise<void>;

export function DashboardPage({ dashboard, leads, activity, onNavigate, onAction }: { dashboard: DashboardData; leads: Lead[]; activity: ActivityType[]; onNavigate: (page: "leads" | "signals" | "approvals" | "analytics" | "sources") => void; onAction: Action }) {
  const maxFunnel = Math.max(...dashboard.funnel.map((item) => item.value), 1);
  return <>
    <PageHeader eyebrow="Autonomous signal operations" title="Nevada Educator Signal OS" description="The hourly pipeline searches, verifies, enriches, validates, qualifies, and blocks unsafe records automatically." actions={<><button className="button secondary" onClick={() => onNavigate("analytics")}><BarChart3 size={16} /> View report</button><button className="button primary" onClick={() => onAction("/api/discovery/run-batch", { limit: 8 })}><Sparkles size={16} /> Run signal batch</button></>} />
    <section className="metrics-grid">
      <MetricCard label="Qualified leads" value={dashboard.metrics.totalLeads} detail="in the active workspace" icon={<Users size={20} />} tone="blue" trend={12} />
      <MetricCard label="High-intent leads" value={dashboard.metrics.highIntent} detail="scored 75 or higher" icon={<Target size={20} />} tone="green" trend={8} />
      <MetricCard label="New signals" value={dashboard.metrics.newSignals} detail="detected this week" icon={<Radar size={20} />} tone="purple" trend={24} />
      <MetricCard label="Booked reviews" value={dashboard.metrics.upcomingBookings} detail="upcoming appointments" icon={<CalendarCheck size={20} />} tone="orange" trend={3} />
    </section>
    <section className="metrics-grid">
      <MetricCard label="Live signals gathered" value={dashboard.metrics.signalsGathered} detail="total, all-time" icon={<SignalIcon size={20} />} tone="purple" />
      <MetricCard label="Leads extracted" value={dashboard.metrics.leadsExtracted} detail="candidates discovered from signals" icon={<DatabaseZap size={20} />} tone="blue" />
      <MetricCard label="Leads enriched" value={dashboard.metrics.leadsEnriched} detail="matched via Apollo / PDL" icon={<UserCheck size={20} />} tone="green" />
      <MetricCard label="Email validated" value={dashboard.metrics.leadsValidated} detail="Bouncer / Clearout verified" icon={<MailCheck size={20} />} tone="orange" />
      <MetricCard label="Emails delivered" value={dashboard.metrics.delivered} detail="confirmed by provider webhook" icon={<Send size={20} />} tone="blue" />
    </section>
    <section className="dashboard-grid">
      <article className="panel attention-panel">
        <div className="panel-header"><div><span className="section-kicker">Fail-closed controls</span><h2>Automatically blocked</h2></div><span className="count-pill">{dashboard.metrics.pendingApprovals + dashboard.metrics.sourceCandidates}</span></div>
        <div className="attention-list">
          <button onClick={() => onNavigate("approvals")}><span className="attention-icon amber"><FileCheck2 size={18} /></span><div><strong>{dashboard.metrics.pendingApprovals} message blocks</strong><span>Preflight failures are recorded and never sent</span></div><ChevronRight size={17} /></button>
          <button onClick={() => onNavigate("sources")}><span className="attention-icon blue"><Globe2 size={18} /></span><div><strong>{dashboard.metrics.sourceCandidates} quarantined sources</strong><span>Policy or robots checks prevented crawling</span></div><ChevronRight size={17} /></button>
          <button onClick={() => onNavigate("leads")}><span className="attention-icon green"><UserCheck size={18} /></span><div><strong>{dashboard.metrics.highIntent} qualified leads</strong><span>Signal-backed, employer-matched, and validated</span></div><ChevronRight size={17} /></button>
        </div>
      </article>
      <article className="panel funnel-panel">
        <div className="panel-header"><div><span className="section-kicker">Conversion</span><h2>Lead-to-meeting funnel</h2></div><button className="text-button" onClick={() => onNavigate("analytics")}>Details <ArrowRight size={14} /></button></div>
        <div className="funnel-chart">
          {dashboard.funnel.map((item, index) => <div className="funnel-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max((item.value / maxFunnel) * 100, item.value ? 8 : 0)}%` }} /></div><strong>{item.value}</strong>{index < dashboard.funnel.length - 1 && <small>{item.value ? Math.round((dashboard.funnel[index + 1]?.value ?? 0) / item.value * 100) : 0}%</small>}</div>)}
        </div>
      </article>
      <article className="panel leads-panel">
        <div className="panel-header"><div><span className="section-kicker">Opportunity</span><h2>Top retirement-ready leads</h2></div><button className="text-button" onClick={() => onNavigate("leads")}>All leads <ArrowRight size={14} /></button></div>
        <div className="compact-leads">
          {leads.slice(0, 4).map((lead) => <div key={lead.id}><ScoreRing score={lead.score} /><div><strong>{lead.first_name} {lead.last_name}</strong><span>{lead.title ?? "Educator"} · {lead.city}, NV</span></div><div className="lead-signal"><SignalIcon size={13} /> {lead.signal_count} signals</div><StatusBadge value={lead.email_status} /></div>)}
        </div>
      </article>
      <article className="panel activity-panel">
        <div className="panel-header"><div><span className="section-kicker"><span className="live-dot" /> Live operations</span><h2>Agent activity</h2></div><button className="icon-button"><MoreHorizontal size={18} /></button></div>
        <ActivityList activity={activity.slice(0, 6)} />
      </article>
    </section>
  </>;
}

export function LeadsPage({ leads, onAction }: { leads: Lead[]; onAction: Action }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Lead | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => leads.filter((lead) => {
    const matchQuery = `${lead.first_name} ${lead.last_name} ${lead.email ?? ""} ${lead.title ?? ""} ${lead.organization_name ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchQuery && (filter === "all" || lead.status === filter || (filter === "high" && lead.score >= 75));
  }), [leads, query, filter]);

  const importCsv = async (file?: File) => {
    if (!file) return;
    const rows = parseCsv(await file.text());
    const normalized = rows.map((row) => ({ firstName: row.first_name || row.firstName || row.firstname, lastName: row.last_name || row.lastName || row.lastname, email: row.email || "", phone: row.phone || "", title: row.title || "", organization: row.organization || row.school || "", city: row.city || "", state: row.state || "NV", yearsInEducation: row.years_in_education ? Number(row.years_in_education) : undefined, sourceUrl: row.source_url || "" })).filter((lead) => lead.firstName && lead.lastName);
    if (normalized.length) await onAction("/api/leads/import", { leads: normalized });
  };

  return <>
    <PageHeader eyebrow="Lead intelligence" title="Qualified Nevada educators" description="Only signal-backed, currently employed educators with validated employer-domain work emails appear here." />
    <section className="panel table-panel">
      <div className="table-toolbar"><label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search educators, schools, districts…" /></label><div className="filter-tabs">{[["all", "All"], ["high", "High intent"], ["ready", "Ready"], ["review", "Review"], ["enriching", "Enriching"]].map(([id, label]) => <button className={filter === id ? "active" : ""} onClick={() => setFilter(id!)} key={id}>{label}</button>)}</div><button className="button ghost"><Filter size={15} /> More filters</button></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th><input type="checkbox" aria-label="Select all" /></th><th>Lead</th><th>Role & organization</th><th>Evidence</th><th>Email</th><th>Score</th><th>Status</th><th /></tr></thead><tbody>
        {filtered.map((lead) => <tr key={lead.id} onClick={() => setSelected(lead)}><td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${lead.first_name}`} /></td><td><div className="person-cell"><span className="initial-avatar">{lead.first_name[0]}{lead.last_name[0]}</span><div><strong>{lead.first_name} {lead.last_name}</strong><span>{lead.email ?? "Email not found"}</span></div></div></td><td><div className="stack-cell"><strong>{lead.title ?? "Educator"}</strong><span>{lead.organization_name ?? "Organization pending"}</span></div></td><td><div className="evidence-cell"><span><SignalIcon size={13} /> {lead.signal_count}</span><span><FileCheck2 size={13} /> {lead.evidence_count}</span></div></td><td><StatusBadge value={lead.email_status} /></td><td><ScoreRing score={lead.score} /></td><td><StatusBadge value={lead.status} /></td><td><button className="icon-button"><ChevronRight size={17} /></button></td></tr>)}
      </tbody></table>{!filtered.length && <EmptyState icon={<Users size={28} />} title="No matching leads" copy="Try changing your search or filters." />}</div>
      <div className="table-footer"><span>Showing {filtered.length} of {leads.length} leads</span><div><button disabled>Previous</button><button className="active">1</button><button>2</button><button>Next</button></div></div>
    </section>
    {selected && <LeadDrawer lead={selected} onClose={() => setSelected(null)} onAction={onAction} />}
  </>;
}

function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void; onAction: Action }) {
  return <Modal title={`${lead.first_name} ${lead.last_name}`} description={`${lead.title ?? "Educator"} · ${lead.city ?? "Nevada"}, ${lead.state}`} onClose={onClose}>
    <div className="lead-profile-hero"><ScoreRing score={lead.score} /><div><span>Retirement relevance</span><strong>{lead.score >= 75 ? "High intent" : lead.score >= 50 ? "Developing" : "Early stage"}</strong><small>Deterministic score—no age inference</small></div></div>
    <div className="detail-grid"><div><span>Email</span><strong>{lead.email ?? "Not available"}</strong><StatusBadge value={lead.email_status} /></div><div><span>Years in education</span><strong>{lead.years_in_education ?? "Unknown"}</strong><small>Source-supported only</small></div><div><span>Organization</span><strong>{lead.organization_name ?? "Pending enrichment"}</strong><small>{lead.district ?? ""}</small></div><div><span>Evidence coverage</span><strong>{lead.evidence_count} records</strong><small>{lead.signal_count} current signals</small></div></div>
    <div className="compliance-note"><ShieldCheck size={18} /><div><strong>Safe personalization boundary</strong><p>Use only cited professional facts. Do not infer age, assets, retirement date, or financial need.</p></div></div>
  </Modal>;
}

export function SignalsPage({ signals }: { signals: Signal[] }) {
  const [type, setType] = useState("all");
  const visible = signals.filter((signal) => type === "all" || signal.signal_type === type);
  return <>
    <PageHeader eyebrow="Signal intelligence" title="Retirement signal feed" description="Cited, confidence-scored public Nevada retirement evidence retained for qualification and message preflight." />
    <div className="signal-layout"><aside className="filter-panel panel"><h3>Signal types</h3>{[["all", "All signals"], ["retirement_update", "Retirement updates"], ["pers_update", "Nevada PERS"], ["career_tenure", "Career tenure"], ["role_change", "Role changes"]].map(([id, label]) => <button key={id} className={type === id ? "active" : ""} onClick={() => setType(id)}><CircleDot size={15} />{label}<span>{id === "all" ? signals.length : signals.filter((s) => s.signal_type === id).length}</span></button>)}<div className="filter-note"><ShieldCheck size={17} /><p>Signals are research prompts, not proof of retirement intent.</p></div></aside><section className="signal-feed">
      {visible.map((signal) => <article className="signal-card panel" key={signal.id}><div className="signal-card-top"><span className={`signal-type ${signal.signal_type}`}><Radar size={14} />{signal.signal_type.replaceAll("_", " ")}</span><span className="confidence"><i style={{ width: `${signal.confidence * 100}%` }} />{Math.round(signal.confidence * 100)}% confidence</span><span>{timeAgo(signal.discovered_at)}</span></div><h3>{signal.title}</h3><p>{signal.summary}</p>{signal.lead_name && <div className="signal-person"><span className="initial-avatar">{signal.lead_name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{signal.lead_name}</strong><span>{signal.organization_name}</span></div></div>}<blockquote>“{signal.source_excerpt ?? "Source excerpt unavailable."}”</blockquote><div className="signal-footer"><div><Globe2 size={15} /><span>{signal.source_name ?? new URL(signal.source_url).hostname}</span></div><a href={signal.source_url} target="_blank" rel="noreferrer">View source <ExternalLink size={13} /></a></div></article>)}
    </section></div>
  </>;
}

export function CampaignsPage({ campaigns }: { campaigns: Campaign[]; leads: Lead[]; onAction: Action }) {
  return <>
    <PageHeader eyebrow="Autonomous engagement" title="Campaigns and sequences" description="Qualified leads are enrolled automatically; every step rechecks signal evidence, validation, suppression, caps, and sending windows." />
    <section className="campaign-summary"><div><Send size={19} /><span><strong>{campaigns.reduce((sum, c) => sum + Number(c.sent_count), 0)}</strong> messages sent</span></div><div><MessageSquareReply size={19} /><span><strong>Immediate</strong> reply stops</span></div><div><CalendarCheck size={19} /><span><strong>Immediate</strong> booking stops</span></div><div><ShieldCheck size={19} /><span><strong>Fail closed</strong> preflight</span></div></section>
    <section className="campaign-grid">{campaigns.map((campaign) => { const compliance = JSON.parse(campaign.compliance_result_json) as { passed: boolean; warnings: string[] }; return <article className="campaign-card panel" key={campaign.id}><div className="campaign-card-top"><span className={`channel-icon ${campaign.campaign_type}`}>{campaign.campaign_type === "newsletter" ? <Mail size={18} /> : <Activity size={18} />}</span><StatusBadge value={campaign.status} /></div><span className="section-kicker">{campaign.campaign_type}</span><h3>{campaign.name}</h3><p>{campaign.audience_description}</p><div className="campaign-subject"><span>Step 1 subject</span><strong>{campaign.subject}</strong></div><div className="campaign-stats"><div><span>Enrolled</span><strong>{campaign.enrollment_count}</strong></div><div><span>Sent</span><strong>{campaign.sent_count}</strong></div><div><span>Sequence</span><strong>Day 1–7</strong></div></div><div className="campaign-card-footer"><span className={compliance.passed ? "guard-pass" : "guard-warn"}>{compliance.passed ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}{compliance.passed ? "Deterministic guard active" : "Configuration blocked"}</span><span>{timeAgo(campaign.updated_at)}</span></div></article>; })}</section>
  </>;
}

export function ApprovalsPage({ approvals }: { approvals: Approval[]; onAction: Action }) {
  return <><PageHeader eyebrow="Compliance runtime" title="Safety blocks" description="There is no routine approval queue. Invalid sources, stale signals, unsafe contacts, and failed messages stop automatically with an audit reason." /><div className="panel"><EmptyState icon={<CheckCircle2 size={30} />} title={approvals.length ? `${approvals.length} legacy items ignored` : "No manual approvals required"} copy="Use the activity log for blocked rule failures. OUTREACH_MODE remains disabled until one-time production activation gates pass." /></div></>;
}

export function AnalyticsPage({ dashboard, campaigns }: { dashboard: DashboardData; campaigns: Campaign[] }) {
  const max = Math.max(...dashboard.funnel.map((item) => item.value), 1);
  return <><PageHeader eyebrow="Performance" title="Outreach analytics" description="A source-to-booking view of the metrics that matter. Opens are intentionally treated as directional only." actions={<button className="button secondary"><Download size={16} /> Export report</button>} />
    <section className="metrics-grid"><MetricCard label="Messages sent" value={dashboard.metrics.sent} detail="approved outbound only" icon={<Send size={20} />} tone="blue" trend={14} /><MetricCard label="Human replies" value={dashboard.metrics.replies} detail="primary engagement metric" icon={<MessageSquareReply size={20} />} tone="green" trend={9} /><MetricCard label="Booked reviews" value={dashboard.metrics.upcomingBookings} detail="attributed conversions" icon={<CalendarCheck size={20} />} tone="purple" trend={5} /><MetricCard label="Reply rate" value={dashboard.metrics.sent ? `${(dashboard.metrics.replies / dashboard.metrics.sent * 100).toFixed(1)}%` : "0%"} detail="sent to reply" icon={<Target size={20} />} tone="orange" /></section>
    <div className="analytics-grid"><article className="panel big-chart"><div className="panel-header"><div><span className="section-kicker">Full journey</span><h2>Conversion by stage</h2></div><span className="period-pill">Last 30 days</span></div><div className="vertical-chart">{dashboard.funnel.map((item) => <div key={item.label}><div className="chart-value">{item.value}</div><div className="chart-bar"><i style={{ height: `${Math.max(item.value / max * 100, item.value ? 6 : 0)}%` }} /></div><span>{item.label}</span></div>)}</div></article><article className="panel attribution-panel"><div className="panel-header"><div><span className="section-kicker">Attribution</span><h2>Campaign performance</h2></div></div>{campaigns.map((campaign) => <div className="attribution-row" key={campaign.id}><span className={`channel-icon ${campaign.campaign_type}`}>{campaign.campaign_type === "newsletter" ? <Mail size={16} /> : <Activity size={16} />}</span><div><strong>{campaign.name}</strong><span>{campaign.sent_count} sent · {campaign.enrollment_count} enrolled</span></div><strong>{campaign.sent_count ? `${Math.round(campaign.sent_count / Math.max(campaign.enrollment_count, 1) * 100)}%` : "—"}</strong></div>)}</article></div>
    <div className="data-integrity panel"><ShieldCheck size={22} /><div><strong>Measurement integrity</strong><p>Bookings, replies, bounces, complaints, and opt-outs are authoritative provider events. Email opens are excluded from headline metrics because privacy protections make them unreliable.</p></div></div>
  </>;
}

export function SourcesPage({ sources, activity, onAction }: { sources: Source[]; activity: ActivityType[]; onAction: Action }) {
  return <><PageHeader eyebrow="Agent operations" title="Sources and agents" description="Parallel and TinyFish discover public evidence; policy, robots, response, and privacy checks automatically allow or quarantine each URL." actions={<button className="button primary" onClick={() => onAction("/api/discovery/run-batch", { limit: 12 })}><Sparkles size={16} /> Run retirement search pool</button>} />
    <section className="agent-strip">{[["Multi-Source Scout", "Parallel + TinyFish", "active", <Globe2 size={18} />], ["Crawler Pool", "Robots-aware and bounded", "active", <Radar size={18} />], ["Signal Extractor", "Evidence snapshots in R2", "active", <DatabaseZap size={18} />], ["Enrichment Agent", "Apollo + optional PDL", "active", <UserCheck size={18} />], ["Writer Agent", "Signal-specific copy", "active", <Mail size={18} />], ["Email Validator", "Bouncer runtime gate", "ready", <MailCheck size={18} />], ["Compliance Guard", "Deterministic fail-closed", "active", <ShieldCheck size={18} />], ["Sequence Agent", "Day 1, 3, 5, 7", "ready", <Activity size={18} />]].map(([name, provider, status, icon]) => <article key={String(name)}><span>{icon}</span><div><strong>{name}</strong><small>{provider}</small></div><i className={String(status)} /></article>)}</section>
    <div className="source-grid"><section className="panel table-panel"><div className="panel-header"><div><span className="section-kicker">Automatic policy</span><h2>Source registry</h2></div></div><div className="source-list">{sources.map((source) => <div key={source.id}><span className={`source-state ${source.approved ? "approved" : "candidate"}`}>{source.approved ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}</span><div><strong>{source.name}</strong><a href={source.url} target="_blank" rel="noreferrer">{new URL(source.url).hostname}<ExternalLink size={11} /></a></div><span className="source-meta">{source.source_type}<small>{source.crawl_frequency}</small></span><StatusBadge value={source.last_status ?? "pending"} /><span className="last-crawl">{timeAgo(source.last_crawled_at)}</span></div>)}</div></section><aside className="panel agent-log"><div className="panel-header"><div><span className="section-kicker"><span className="live-dot" /> Runtime</span><h2>Agent log</h2></div></div><ActivityList activity={activity.slice(0, 8)} /></aside></div>
  </>;
}

export function SettingsPage({ providerStatus }: { providerStatus: { tinyfish: boolean; parallel: boolean; apollo: boolean; peopleDataLabs: boolean; bouncer: boolean; agentmail: boolean; autosend: boolean } }) {
  const providers = [["Parallel", "Web search and structured extraction", providerStatus.parallel, "PARALLEL_API_KEY"], ["TinyFish", "Search and rendered Fetch", providerStatus.tinyfish, "TINYFISH_API_KEY"], ["Apollo", "Primary professional enrichment", providerStatus.apollo, "APOLLO_API_KEY"], ["People Data Labs", "Optional enrichment fallback", providerStatus.peopleDataLabs, "PDL_API_KEY"], ["Bouncer", "Authoritative runtime email validation", providerStatus.bouncer, "BOUNCER_API_KEY"], ["Abstract MCP", "Optional operator-side validation checks", true, ".mcp.json"], ["AgentMail", "Primary delivery and reply events", providerStatus.agentmail, "AGENTMAIL_API_KEY"], ["AutoSend", "Controlled optional fallback", providerStatus.autosend, "AUTOSEND_API_KEY"], ["Calendly", "Booking-stop webhook", false, "CALENDLY_WEBHOOK_SECRET"]];
  return <><PageHeader eyebrow="Governance" title="Compliance and integrations" description="Production gates stay closed until identity, disclosures, domains, consent language, and providers are verified." />
    <div className="settings-grid"><section className="panel settings-section"><div className="panel-header"><div><span className="section-kicker">Launch controls</span><h2>Compliance readiness</h2></div><span className="readiness-score">4 / 8 complete</span></div><div className="checklist">{[[true, "Automatic source policy", "Allowed public sources crawl; restricted sources quarantine."], [true, "Deterministic email preflight", "Unsupported claims, stale evidence, and missing disclosures block."], [true, "Newsletter consent separation", "Qualified leads are candidates only until explicit consent is recorded."], [true, "Global suppression", "Replies, bookings, bounces, complaints, and opt-outs stop sequences."], [false, "Supervisory sign-off", "Confirm adviser status, disclosures, retention, and outreach policy."], [false, "Signed webhook tests", "Exercise reply, booking, bounce, complaint, rejection, and unsubscribe stops."], [false, "Sending-domain authentication", "Verify SPF, DKIM, DMARC, and active sender identity."], [false, "Production mode", "OUTREACH_MODE remains disabled until every activation gate passes."]].map(([done, title, copy]) => <div key={String(title)} className={done ? "done" : "pending"}>{done ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}<div><strong>{title}</strong><span>{copy}</span></div></div>)}</div></section><section className="panel settings-section"><div className="panel-header"><div><span className="section-kicker">Provider adapters</span><h2>Integration status</h2></div></div><div className="provider-list">{providers.map(([name, copy, connected, secret]) => <div key={String(name)}><span className="provider-logo"><KeyRound size={18} /></span><div><strong>{name}</strong><span>{copy}</span><code>{secret}</code></div><StatusBadge value={connected ? "connected" : "not_configured"} /></div>)}</div></section></div>
    <section className="panel policy-panel"><div><ShieldAlert size={22} /><h3>Production policy</h3></div><p>This software enforces technical controls but does not determine Benjamin's regulatory obligations. His compliance officer or counsel must approve the source policy, retention period, campaign disclosures, consent language, vendor agreements, and production sending configuration.</p></section>
  </>;
}

function ActivityList({ activity }: { activity: ActivityType[] }) {
  return <div className="activity-list">{activity.map((item) => <div key={item.id}><span className={`activity-indicator ${item.severity}`}>{item.actor_type === "agent" ? <Bot size={15} /> : item.severity === "warning" ? <ShieldAlert size={15} /> : <Activity size={15} />}</span><div><strong>{item.actor_name}</strong><p>{item.detail}</p><span>{timeAgo(item.occurred_at)}</span></div></div>)}</div>;
}

function parseCsv(input: string): Array<Record<string, string>> {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let i = 0; i < input.length; i += 1) { const char = input[i]; const next = input[i + 1]; if (char === '"' && quoted && next === '"') { value += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { row.push(value.trim()); value = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") i += 1; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; } else value += char; }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row); const headers = (rows.shift() ?? []).map((header) => header.toLowerCase().replace(/\s+/g, "_"));
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}
