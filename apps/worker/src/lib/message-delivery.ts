import { signalJobSchema, type SignalJob } from "@agent-os/shared";
import { neonQuery, neonTransaction } from "./neon";

type SendJob = Extract<SignalJob, { kind: "send-message" }>;

interface MessageRow {
  id: string; qualified_lead_id: string; email: string; first_name: string; last_name: string; subject: string; body: string;
  provider: string; preflight_status: string; delivery_status: string; idempotency_key: string;
}

export async function processSendJob(env: Env, raw: unknown): Promise<void> {
  const job = signalJobSchema.parse(raw);
  if (job.kind !== "send-message") throw new Error("Not a send job.");
  if (!(await claim(env, job))) return;
  try {
    await sendMessage(env, job.messageId);
    await finish(env, job.idempotencyKey, "completed");
  } catch (error) {
    await finish(env, job.idempotencyKey, "failed", error);
    throw error;
  }
}

async function sendMessage(env: Env, messageId: string): Promise<void> {
  const rows = await neonQuery<MessageRow>(env,
    `SELECT om.id,om.qualified_lead_id,ql.email,ql.first_name,ql.last_name,om.subject,om.body,om.provider,om.preflight_status,om.delivery_status,om.idempotency_key
     FROM outbound_messages om JOIN qualified_leads ql ON ql.id=om.qualified_lead_id WHERE om.id=$1`, [messageId]);
  const message = rows.rows[0];
  if (!message || message.delivery_status !== "scheduled" || message.preflight_status !== "passed") return;
  if (String(env.OUTREACH_MODE) !== "enabled") {
    await neonQuery(env, "UPDATE outbound_messages SET delivery_status='sandboxed' WHERE id=$1", [messageId]);
    await neonQuery(env, `INSERT INTO audit_log(entity_type,entity_id,action,rule_version,metadata) VALUES('outbound_message',$1,'delivery.sandboxed','signal-os-v2','{"reason":"outreach_disabled"}')`, [messageId]);
    return;
  }
  const stillEligible = await neonQuery<{ allowed: boolean }>(env,
    `SELECT NOT EXISTS(SELECT 1 FROM suppressions WHERE lower(email)=lower($1) AND (expires_at IS NULL OR expires_at>now()))
       AND NOT EXISTS(SELECT 1 FROM message_events me JOIN outbound_messages om ON om.id=me.outbound_message_id WHERE om.qualified_lead_id=$2 AND me.event_type IN ('reply','positive_reply','negative_reply','booking','unsubscribe','complaint','hard_bounce','invalid_email','rejected','spam_report')) AS allowed`,
    [message.email, message.qualified_lead_id]);
  if (!stillEligible.rows[0]?.allowed) {
    await neonQuery(env, "UPDATE outbound_messages SET delivery_status='blocked',preflight_failures='[\"terminal_recheck_failed\"]'::jsonb WHERE id=$1", [messageId]);
    return;
  }
  const mode = String(env.EMAIL_PROVIDER_MODE || "agentmail_only");
  let accepted: { provider: string; messageId: string };
  if (mode === "autosend_only") accepted = await sendAutoSend(env, message);
  else {
    try { accepted = await sendAgentMail(env, message); }
    catch (error) {
      if (mode !== "agentmail_with_autosend_fallback" || !(error instanceof ProviderFailure) || !error.safeToFallback) throw error;
      accepted = await sendAutoSend(env, message);
    }
  }
  await neonTransaction(env, async (client) => {
    await client.query(`UPDATE outbound_messages SET provider=$2,provider_message_id=$3,sent_at=now(),delivery_status='sent' WHERE id=$1 AND delivery_status='scheduled'`, [message.id, accepted.provider, accepted.messageId]);
    await client.query(`UPDATE qualified_leads SET outreach_status='contacted',last_contacted_at=now() WHERE id=$1`, [message.qualified_lead_id]);
  });
}

class ProviderFailure extends Error { constructor(message: string, readonly safeToFallback: boolean) { super(message); } }

async function sendAgentMail(env: Env, message: MessageRow) {
  if (!env.AGENTMAIL_API_KEY || !env.AGENTMAIL_INBOX_ID) throw new ProviderFailure("AgentMail is not configured.", true);
  let response: Response;
  try {
    response = await fetch(`${env.AGENTMAIL_API_BASE}/inboxes/${encodeURIComponent(env.AGENTMAIL_INBOX_ID)}/messages/send`, {
      method: "POST", headers: { Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": message.idempotency_key },
      body: JSON.stringify({ to: [message.email], reply_to: [env.REPLY_TO_EMAIL], subject: message.subject, text: message.body, labels: ["benjamin-signal-os", "verified-public-signal"], headers: { "X-Signal-OS-Message-ID": message.id } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) { throw new ProviderFailure(error instanceof Error ? error.message : "AgentMail transport failed.", false); }
  if (!response.ok) throw new ProviderFailure(`AgentMail returned HTTP ${response.status}.`, response.status >= 400 && response.status < 500 && response.status !== 429);
  const data = await response.json<{ message_id?: string }>();
  if (!data.message_id) throw new ProviderFailure("AgentMail did not return a message ID.", false);
  return { provider: "agentmail", messageId: data.message_id };
}

async function sendAutoSend(env: Env, message: MessageRow) {
  if (!env.AUTOSEND_API_KEY || !env.AUTOSEND_DEFAULT_FROM_EMAIL) throw new ProviderFailure("AutoSend is not configured.", false);
  const response = await fetch(`${env.AUTOSEND_API_BASE}/mails/send`, {
    method: "POST", headers: { Authorization: `Bearer ${env.AUTOSEND_API_KEY}`, "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": message.idempotency_key },
    body: JSON.stringify({ to: { email: message.email, name: `${message.first_name} ${message.last_name}` }, from: { email: env.AUTOSEND_DEFAULT_FROM_EMAIL, name: env.FROM_NAME }, replyTo: { email: env.REPLY_TO_EMAIL, name: env.FROM_NAME }, subject: message.subject, text: message.body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new ProviderFailure(`AutoSend returned HTTP ${response.status}.`, false);
  const data = await response.json<{ data?: { emailId?: string }; success?: boolean }>();
  if (!data.success || !data.data?.emailId) throw new ProviderFailure("AutoSend did not return a message ID.", false);
  return { provider: "autosend", messageId: data.data.emailId };
}

async function claim(env: Env, job: SendJob) { return neonTransaction(env, async (client) => { await client.query(`INSERT INTO pipeline_jobs(idempotency_key,job_kind,entity_id) VALUES($1,$2,$3) ON CONFLICT(idempotency_key) DO NOTHING`, [job.idempotencyKey,job.kind,job.messageId]); const row=await client.query<{status:string}>("SELECT status FROM pipeline_jobs WHERE idempotency_key=$1 FOR UPDATE",[job.idempotencyKey]); if (["completed","blocked"].includes(row.rows[0]?.status ?? "")) return false; await client.query("UPDATE pipeline_jobs SET status='running',attempt_count=attempt_count+1,started_at=now() WHERE idempotency_key=$1",[job.idempotencyKey]); return true; }); }
async function finish(env: Env,key:string,status:string,error?:unknown){await neonQuery(env,"UPDATE pipeline_jobs SET status=$2,completed_at=now(),error_code=$3,error_message=$4 WHERE idempotency_key=$1",[key,status,error?"delivery_error":null,error instanceof Error?error.message.slice(0,1000):null]);}
