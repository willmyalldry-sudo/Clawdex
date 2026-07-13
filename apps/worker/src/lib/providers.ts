import { escapeHtml, hmacBase64Url, nowIso, sha256, uuid } from "./utils";
import { hasActiveConsent, isSuppressed, stopEnrollments, writeActivity } from "./db";

interface LeadRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  city: string | null;
  state: string | null;
  organization_name: string | null;
  organization_website: string | null;
}

interface EnrichmentResult {
  provider: "apollo" | "people_data_labs";
  email: string | null;
  jobTitle: string | null;
  organizationName: string | null;
  linkedinUrl: string | null;
  confidence: number;
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "aol.com", "gmail.com", "googlemail.com", "hotmail.com", "icloud.com",
  "live.com", "mail.com", "outlook.com", "proton.me", "protonmail.com",
  "yahoo.com", "ymail.com",
]);

interface MessageRow extends LeadRow {
  message_id: string;
  channel: "email" | "sms";
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  idempotency_key: string;
  status: string;
  email_status: string;
  campaign_type: string | null;
  source_summary: string | null;
}

export async function enrichLead(env: Env, leadId: string, runId: string): Promise<void> {
  const lead = await env.DB.prepare(
    `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.title, l.city, l.state,
            o.name AS organization_name, o.website AS organization_website
     FROM leads l LEFT JOIN organizations o ON o.id = l.organization_id WHERE l.id = ?`,
  )
    .bind(leadId).first<LeadRow>();
  if (!lead) throw new Error("Lead not found.");
  if (!env.APOLLO_API_KEY && !env.PDL_API_KEY) {
    await finishProviderRun(env, runId, "skipped", { reason: "No enrichment provider is configured" });
    return;
  }

  const providersTried: string[] = [];
  const providerErrors: Error[] = [];
  let result: EnrichmentResult | null = null;

  if (env.APOLLO_API_KEY && String(env.ENRICHMENT_PROVIDER_MODE) !== "pdl_only") {
    providersTried.push("apollo");
    try {
      result = await enrichWithApollo(env, lead);
    } catch (error) {
      providerErrors.push(error instanceof Error ? error : new Error("Apollo enrichment failed."));
    }
  }

  if (!result && env.PDL_API_KEY && String(env.ENRICHMENT_PROVIDER_MODE) !== "apollo_only") {
    providersTried.push("people_data_labs");
    try {
      result = await enrichWithPeopleDataLabs(env, lead);
    } catch (error) {
      providerErrors.push(error instanceof Error ? error : new Error("People Data Labs enrichment failed."));
    }
  }

  if (!result) {
    if (providerErrors.length === providersTried.length && providerErrors.length > 0) throw providerErrors[0];
    await finishProviderRun(env, runId, "completed", { matched: false, providersTried });
    return;
  }

  const evidence = {
    provider: result.provider,
    email: result.email,
    jobTitle: result.jobTitle,
    organizationName: result.organizationName,
    linkedinUrl: result.linkedinUrl,
  };
  const evidenceId = uuid();
  const sourceUrl = result.linkedinUrl ?? (result.provider === "apollo" ? "https://www.apollo.io" : "https://www.peopledatalabs.com");
  await env.DB.batch([
    env.DB.prepare("UPDATE leads SET email = COALESCE(email, ?), title = COALESCE(title, ?), status = 'review', updated_at = ? WHERE id = ?")
      .bind(result.email, result.jobTitle, nowIso(), leadId),
    env.DB.prepare(
      `INSERT INTO lead_evidence (id, lead_id, source_url, field_name, field_value, excerpt, confidence, content_hash, retrieved_at)
       VALUES (?, ?, ?, 'licensed_enrichment', ?, ?, ?, ?, ?)`,
    ).bind(
      evidenceId,
      leadId,
      sourceUrl,
      JSON.stringify(evidence),
      `Licensed professional-data enrichment result from ${result.provider === "apollo" ? "Apollo" : "People Data Labs"}.`,
      result.confidence,
      await sha256(JSON.stringify(evidence)),
      nowIso(),
    ),
  ]);
  await finishProviderRun(env, runId, "completed", { matched: true, provider: result.provider, evidenceId, fields: Object.entries(evidence).filter(([, value]) => Boolean(value)).map(([field]) => field) });
  await writeActivity(env.DB, { actorType: "agent", actorName: "Enrichment Agent", action: "lead.enriched", entityType: "lead", entityId: leadId, detail: `Completed ${result.provider === "apollo" ? "Apollo" : "People Data Labs"} professional enrichment for ${lead.first_name} ${lead.last_name}; human review is required.`, severity: "success" });
}

async function enrichWithApollo(env: Env, lead: LeadRow): Promise<EnrichmentResult | null> {
  const organizationDomain = domainFromUrl(lead.organization_website);
  const response = await fetch(`${env.APOLLO_API_BASE}/people/match`, {
    method: "POST",
    headers: { "x-api-key": env.APOLLO_API_KEY ?? "", Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email ?? undefined,
      organization_name: lead.organization_name ?? undefined,
      domain: organizationDomain ?? undefined,
      reveal_personal_emails: false,
      reveal_phone_number: false,
      run_waterfall_email: false,
      run_waterfall_phone: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Apollo returned HTTP ${response.status}.`);
  const data = await response.json<{ person?: Record<string, unknown> | null }>();
  const person = data.person;
  if (!person) return null;
  const organization = person.organization && typeof person.organization === "object" ? person.organization as Record<string, unknown> : null;
  const providerDomain = stringValue(organization?.primary_domain) ?? domainFromUrl(stringValue(organization?.website_url));
  const email = stringValue(person.email);
  const trustedEmail = email && isProfessionalEmail(email, organizationDomain ?? providerDomain) ? email : null;
  const emailStatus = stringValue(person.email_status)?.toLowerCase();
  return {
    provider: "apollo",
    email: emailStatus === "invalid" ? null : trustedEmail,
    jobTitle: stringValue(person.title) ?? lead.title,
    organizationName: stringValue(organization?.name) ?? lead.organization_name,
    linkedinUrl: stringValue(person.linkedin_url),
    confidence: emailStatus === "verified" ? 0.9 : 0.75,
  };
}

async function enrichWithPeopleDataLabs(env: Env, lead: LeadRow): Promise<EnrichmentResult | null> {
  const params = new URLSearchParams({ first_name: lead.first_name, last_name: lead.last_name, region: lead.state ?? "NV", country: "US", min_likelihood: "6" });
  const response = await fetch(`${env.PDL_API_BASE}/person/enrich?${params}`, {
    headers: { "X-Api-Key": env.PDL_API_KEY ?? "", Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`People Data Labs returned HTTP ${response.status}.`);
  const data = await response.json<Record<string, unknown>>();
  const emails = Array.isArray(data.emails) ? data.emails : [];
  const firstEmail = emails.find((item): item is { address: string } => Boolean(item && typeof item === "object" && typeof (item as { address?: unknown }).address === "string"));
  const employerDomain = domainFromUrl(lead.organization_website);
  const email = firstEmail?.address && isProfessionalEmail(firstEmail.address, employerDomain) ? firstEmail.address : null;
  const likelihood = typeof data.likelihood === "number" ? Math.min(1, data.likelihood / 10) : 0.6;
  return {
    provider: "people_data_labs",
    email,
    jobTitle: stringValue(data.job_title) ?? lead.title,
    organizationName: stringValue(data.job_company_name) ?? lead.organization_name,
    linkedinUrl: stringValue(data.linkedin_url),
    confidence: likelihood,
  };
}

export function isProfessionalEmail(email: string, employerDomain: string | null): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const at = normalizedEmail.lastIndexOf("@");
  if (at <= 0 || at === normalizedEmail.length - 1 || !employerDomain) return false;
  const emailDomain = normalizedEmail.slice(at + 1).replace(/^www\./, "");
  const normalizedEmployerDomain = employerDomain.trim().toLowerCase().replace(/^www\./, "");
  if (PERSONAL_EMAIL_DOMAINS.has(emailDomain)) return false;
  return emailDomain === normalizedEmployerDomain || emailDomain.endsWith(`.${normalizedEmployerDomain}`);
}

function domainFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function validateLeadEmail(env: Env, leadId: string, runId: string): Promise<void> {
  const lead = await env.DB.prepare(
    `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.title, l.city, l.state,
            o.name AS organization_name, o.website AS organization_website
     FROM leads l LEFT JOIN organizations o ON o.id = l.organization_id WHERE l.id = ?`,
  )
    .bind(leadId).first<LeadRow>();
  if (!lead?.email) {
    await env.DB.prepare("UPDATE leads SET email_status = 'unavailable', updated_at = ? WHERE id = ?").bind(nowIso(), leadId).run();
    await finishProviderRun(env, runId, "completed", { status: "unavailable" });
    return;
  }
  if (!env.BOUNCER_API_KEY) {
    await finishProviderRun(env, runId, "skipped", { reason: "BOUNCER_API_KEY is not configured" });
    return;
  }
  const params = new URLSearchParams({ email: lead.email });
  const response = await fetch(`${env.BOUNCER_API_BASE}/email/verify?${params}`, { headers: { "x-api-key": env.BOUNCER_API_KEY }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Bouncer returned HTTP ${response.status}.`);
  const data = await response.json<Record<string, unknown>>();
  const providerStatus = typeof data.status === "string" ? data.status.toLowerCase() : "unknown";
  const status = providerStatus === "deliverable" ? "valid" : providerStatus === "undeliverable" ? "invalid" : providerStatus === "unknown" ? "unavailable" : "risky";
  await env.DB.prepare("UPDATE leads SET email_status = ?, status = CASE WHEN ? = 'valid' THEN 'ready' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(status, status, nowIso(), leadId).run();
  await finishProviderRun(env, runId, "completed", { providerStatus, status });
  await writeActivity(env.DB, { actorType: "agent", actorName: "Email Validator", action: "lead.validated", entityType: "lead", entityId: leadId, detail: `Email validation completed with status: ${status}.`, severity: status === "valid" ? "success" : "warning" });
}

export async function sendQueuedMessage(env: Env, messageId: string): Promise<void> {
  const message = await env.DB.prepare(
    `SELECT m.id AS message_id, m.channel, m.subject, m.body_html, m.body_text, m.idempotency_key, m.status,
            l.id, l.first_name, l.last_name, l.email, l.email_status, l.phone, l.title, l.city, l.state, l.source_summary,
            o.name AS organization_name, o.website AS organization_website, c.campaign_type
     FROM messages m JOIN leads l ON l.id = m.lead_id
     LEFT JOIN organizations o ON o.id = l.organization_id
     LEFT JOIN campaigns c ON c.id = m.campaign_id WHERE m.id = ?`,
  ).bind(messageId).first<MessageRow>();
  if (!message) throw new Error("Message not found.");
  if (message.status !== "queued") return;
  if (String(env.OUTREACH_MODE) !== "enabled") {
    await env.DB.prepare("UPDATE messages SET status = 'sandboxed', updated_at = ? WHERE id = ?").bind(nowIso(), messageId).run();
    await writeActivity(env.DB, { actorType: "system", actorName: "Outreach Guard", action: "message.sandboxed", entityType: "message", entityId: messageId, detail: "Message was safely captured because outreach mode is disabled.", severity: "warning" });
    return;
  }

  if (await isSuppressed(env.DB, message.id, message.channel)) {
    await env.DB.prepare("UPDATE messages SET status = 'suppressed', updated_at = ? WHERE id = ?").bind(nowIso(), messageId).run();
    await stopEnrollments(env.DB, message.id, "suppressed");
    return;
  }
  if (message.channel === "email") {
    if (!message.email || message.email_status === "invalid") throw new Error("Lead does not have a sendable email.");
    if (message.campaign_type === "newsletter" && !(await hasActiveConsent(env.DB, message.id, "email_newsletter"))) throw new Error("Newsletter consent is required.");
    await sendEmail(env, message);
  } else {
    if (!message.phone) throw new Error("Lead does not have a phone number.");
    if (!(await hasActiveConsent(env.DB, message.id, "sms_marketing"))) throw new Error("Active SMS marketing consent is required.");
    await sendSms(env, message);
  }
}

async function sendEmail(env: Env, message: MessageRow): Promise<void> {
  const mode = String(env.EMAIL_PROVIDER_MODE);
  if (mode === "autosend_only") {
    await sendAutoSendEmail(env, message);
    return;
  }
  if (env.AGENTMAIL_API_KEY && env.AGENTMAIL_INBOX_ID && mode !== "sendgrid_only") {
    await sendAgentMailEmail(env, message);
    return;
  }
  if (env.AUTOSEND_API_KEY && mode === "autosend_fallback") {
    await sendAutoSendEmail(env, message);
    return;
  }
  await sendSendGridEmail(env, message);
}

async function sendAgentMailEmail(env: Env, message: MessageRow): Promise<void> {
  if (!env.AGENTMAIL_API_KEY || !env.AGENTMAIL_INBOX_ID || !env.UNSUBSCRIBE_SECRET) throw new Error("AgentMail and unsubscribe secrets must be configured.");
  const token = await hmacBase64Url(env.UNSUBSCRIBE_SECRET, message.id);
  const unsubscribeUrl = `${env.PUBLIC_APP_URL}/unsubscribe?lead=${encodeURIComponent(message.id)}&token=${encodeURIComponent(token)}`;
  const html = applyTemplate(message.body_html ?? "", message, env, unsubscribeUrl);
  const subject = applyTemplate(message.subject ?? "", message, env, unsubscribeUrl);
  const response = await fetch(`${env.AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(env.AGENTMAIL_INBOX_ID)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      to: [message.email],
      reply_to: [env.REPLY_TO_EMAIL],
      subject,
      html,
      text: message.body_text ? applyTemplate(message.body_text, message, env, unsubscribeUrl) : htmlToText(html),
      labels: ["benjamin-os", "approved-outreach"],
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-Agent-OS-Message-ID": message.message_id,
        "X-Agent-OS-Idempotency-Key": message.idempotency_key,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`AgentMail returned HTTP ${response.status}.`);
  const data = await response.json<{ message_id?: string; thread_id?: string }>();
  if (!data.message_id) throw new Error("AgentMail did not return a message ID.");
  await markSent(env, message, "agentmail", data.message_id);
}

async function sendAutoSendEmail(env: Env, message: MessageRow): Promise<void> {
  if (!env.AUTOSEND_API_KEY || !env.AUTOSEND_DEFAULT_FROM_EMAIL || !env.UNSUBSCRIBE_SECRET) {
    throw new Error("AutoSend, sender identity, and unsubscribe secrets must be configured.");
  }
  const token = await hmacBase64Url(env.UNSUBSCRIBE_SECRET, message.id);
  const unsubscribeUrl = `${env.PUBLIC_APP_URL}/unsubscribe?lead=${encodeURIComponent(message.id)}&token=${encodeURIComponent(token)}`;
  const html = applyTemplate(message.body_html ?? "", message, env, unsubscribeUrl);
  const response = await fetch(`${env.AUTOSEND_API_BASE}/mails/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.AUTOSEND_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotency_key,
    },
    body: JSON.stringify({
      to: { email: message.email, name: `${message.first_name} ${message.last_name}`.trim() },
      from: { email: env.AUTOSEND_DEFAULT_FROM_EMAIL, name: env.AUTOSEND_FROM_NAME },
      replyTo: { email: env.AUTOSEND_REPLY_TO_EMAIL, name: env.AUTOSEND_FROM_NAME },
      subject: applyTemplate(message.subject ?? "", message, env, unsubscribeUrl),
      html,
      text: message.body_text ? applyTemplate(message.body_text, message, env, unsubscribeUrl) : htmlToText(html),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`AutoSend returned HTTP ${response.status}.`);
  const data = await response.json<{ success?: boolean; data?: { emailId?: string } }>();
  if (!data.success || !data.data?.emailId) throw new Error("AutoSend did not return a queued email ID.");
  await markSent(env, message, "autosend", data.data.emailId);
}

async function sendSendGridEmail(env: Env, message: MessageRow): Promise<void> {
  if (!env.SENDGRID_API_KEY || !env.UNSUBSCRIBE_SECRET) throw new Error("SendGrid and unsubscribe secrets must be configured.");
  const token = await hmacBase64Url(env.UNSUBSCRIBE_SECRET, message.id);
  const unsubscribeUrl = `${env.PUBLIC_APP_URL}/unsubscribe?lead=${encodeURIComponent(message.id)}&token=${encodeURIComponent(token)}`;
  const personalization = applyTemplate(message.body_html ?? "", message, env, unsubscribeUrl);
  const body = {
    personalizations: [{ to: [{ email: message.email, name: `${message.first_name} ${message.last_name}` }], custom_args: { message_id: message.message_id, lead_id: message.id } }],
    from: { email: env.FROM_EMAIL, name: env.FROM_NAME },
    reply_to: { email: env.REPLY_TO_EMAIL, name: env.FROM_NAME },
    subject: applyTemplate(message.subject ?? "", message, env, unsubscribeUrl),
    content: [{ type: "text/html", value: personalization }],
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
  const response = await fetch(`${env.SENDGRID_API_BASE}/mail/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotency_key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SendGrid returned HTTP ${response.status}.`);
  const providerId = response.headers.get("x-message-id");
  await markSent(env, message, "sendgrid", providerId);
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sendSms(env: Env, message: MessageRow): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) throw new Error("Twilio secrets must be configured.");
  const form = new URLSearchParams({ To: message.phone ?? "", From: env.TWILIO_FROM_NUMBER, Body: message.body_text ?? "" });
  const response = await fetch(`${env.TWILIO_API_BASE}/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": message.idempotency_key },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Twilio returned HTTP ${response.status}.`);
  const data = await response.json<{ sid?: string }>();
  await markSent(env, message, "twilio", data.sid ?? null);
}

async function markSent(env: Env, message: MessageRow, provider: string, providerId: string | null): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE messages SET status = 'sent', provider = ?, provider_message_id = ?, sent_at = ?, updated_at = ? WHERE id = ?")
      .bind(provider, providerId, nowIso(), nowIso(), message.message_id),
    env.DB.prepare("UPDATE leads SET status = 'contacted', last_contacted_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), message.id),
  ]);
  await writeActivity(env.DB, { actorType: "agent", actorName: "Sequence Agent", action: "message.sent", entityType: "message", entityId: message.message_id, detail: `Sent ${message.channel} to ${message.first_name} ${message.last_name}.`, severity: "success" });
}

function applyTemplate(template: string, lead: MessageRow, env: Env, unsubscribeUrl: string): string {
  const personalizationDetail = lead.source_summary
    ?? (lead.title && lead.organization_name ? `your work as ${lead.title} with ${lead.organization_name}` : lead.organization_name ? `your work with ${lead.organization_name}` : "your work with Nevada educators");
  return template
    .replaceAll("{{first_name}}", escapeHtml(lead.first_name))
    .replaceAll("{{last_name}}", escapeHtml(lead.last_name))
    .replaceAll("{{city}}", escapeHtml(lead.city ?? "Nevada"))
    .replaceAll("{{personalization_detail}}", escapeHtml(personalizationDetail))
    .replaceAll("{{booking_link}}", `<a href="${escapeHtml(env.PUBLIC_APP_URL)}/book">schedule a retirement-readiness review</a>`)
    .replaceAll("{{unsubscribe_link}}", `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>`)
    .concat(`<hr><p style="font-size:12px;color:#667085">Benjamin Persyn | ${escapeHtml(env.ADVISER_FIRM)}<br>Licensed Financial Advisor | Nevada License #${escapeHtml(env.ADVISER_LICENSE_NUMBER)}<br>${escapeHtml(env.ADVISER_PHONE)} | ${escapeHtml(env.ADVISER_PUBLIC_EMAIL)} | ${escapeHtml(env.ADVISER_WEBSITE)}<br>${escapeHtml(env.ADVISER_DISCLOSURE)}<br>${escapeHtml(env.POSTAL_ADDRESS)}</p>`);
}

async function finishProviderRun(env: Env, runId: string, status: string, output: Record<string, unknown>): Promise<void> {
  await env.DB.prepare("UPDATE agent_runs SET status = ?, output_json = ?, completed_at = ? WHERE id = ?")
    .bind(status, JSON.stringify(output), nowIso(), runId).run();
}
