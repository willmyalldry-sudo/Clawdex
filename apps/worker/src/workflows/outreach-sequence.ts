import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { deterministicPreflight } from "@agent-os/shared";
import { neonQuery } from "../lib/neon";
import { hmacBase64Url, sha256, uuid } from "../lib/utils";

export interface SequenceParams { enrollmentId: string; qualifiedLeadId: string; sequenceId: string; }

interface SequenceContext {
  enrollment_status: string; sequence_status: string; first_name: string; email: string; source_url: string;
  evidence_excerpt: string; signal_summary: string; signal_type: string; signal_date: string; signal_event_id: string;
  from_name: string; adviser_disclosure: string; postal_address: string; provider_mode: string;
  validation_status: string; validation_expires_at: string;
}

interface StepRow { step_number: number; delay_hours: number; message_goal: string; subject_template: string; body_template: string; }

export class OutreachSequenceWorkflow extends WorkflowEntrypoint<Env, SequenceParams> {
  override async run(event: WorkflowEvent<SequenceParams>, step: WorkflowStep): Promise<void> {
    const steps = await step.do("load-active-signal-sequence", async () => {
      const rows = await neonQuery<StepRow>(this.env,
        `SELECT step_number,delay_hours,message_goal,subject_template,body_template
         FROM sequence_steps WHERE sequence_id=$1 AND is_active ORDER BY step_number`, [event.payload.sequenceId]);
      if (rows.rows.length !== 4) throw new Error("The production signal sequence must contain exactly four active steps.");
      return rows.rows;
    });
    let previousDelay = 0;
    for (const sequenceStep of steps) {
      const waitHours = Math.max(0, sequenceStep.delay_hours - previousDelay);
      previousDelay = sequenceStep.delay_hours;
      if (waitHours) await step.sleep(`wait-to-step-${sequenceStep.step_number}`, `${waitHours} hours`);
      const context = await step.do(`eligibility-step-${sequenceStep.step_number}`, async () => this.loadContext(event.payload));
      if (!context || context.enrollment_status !== "active" || context.sequence_status !== "active") return;
      const sendAt = nextNevadaSendingTime(new Date(), this.env);
      if (sendAt.getTime() > Date.now() + 5_000) await step.sleepUntil(`sending-window-step-${sequenceStep.step_number}`, sendAt);
      const queued = await step.do(`preflight-and-queue-step-${sequenceStep.step_number}`, async () => {
        const fresh = await this.loadContext(event.payload);
        if (!fresh || fresh.enrollment_status !== "active") return null;
        const unsubscribeToken = await hmacBase64Url(required(this.env.UNSUBSCRIBE_SECRET, "UNSUBSCRIBE_SECRET"), event.payload.qualifiedLeadId);
        const unsubscribeUrl = `${this.env.PUBLIC_APP_URL}/unsubscribe?lead=${encodeURIComponent(event.payload.qualifiedLeadId)}&token=${encodeURIComponent(unsubscribeToken)}`;
        const subject = render(sequenceStep.subject_template, fresh, unsubscribeUrl);
        const body = render(sequenceStep.body_template, fresh, unsubscribeUrl);
        const [suppression, duplicate, sentCounts] = await Promise.all([
          neonQuery<{ blocked: boolean }>(this.env, `SELECT EXISTS(SELECT 1 FROM suppressions WHERE lower(email)=lower($1) AND (expires_at IS NULL OR expires_at>now())) AS blocked`, [fresh.email]),
          neonQuery<{ duplicate: boolean }>(this.env, `SELECT EXISTS(SELECT 1 FROM outbound_messages WHERE qualified_lead_id=$1 AND subject=$2 AND created_at>now()-interval '90 days') AS duplicate`, [event.payload.qualifiedLeadId, subject]),
          neonQuery<{ hour_count: string; day_count: string }>(this.env, `SELECT COUNT(*) FILTER (WHERE sent_at>=date_trunc('hour',now()))::text AS hour_count, COUNT(*) FILTER (WHERE sent_at>=date_trunc('day',now()))::text AS day_count FROM outbound_messages WHERE sent_at IS NOT NULL`),
        ]);
        const withinCaps = Number(sentCounts.rows[0]?.hour_count ?? 0) < numberConfig(this.env.MAX_EMAILS_PER_HOUR, 10)
          && Number(sentCounts.rows[0]?.day_count ?? 0) < numberConfig(this.env.MAX_EMAILS_PER_DAY, 50);
        const providerAvailable = fresh.provider_mode === "agentmail_only" ? Boolean(this.env.AGENTMAIL_API_KEY)
          : fresh.provider_mode === "autosend_only" ? Boolean(this.env.AUTOSEND_API_KEY)
            : Boolean(this.env.AGENTMAIL_API_KEY || this.env.AUTOSEND_API_KEY);
        const preflight = deterministicPreflight({
          subject, body, sourceUrl: fresh.source_url, evidenceExcerpt: fresh.evidence_excerpt, signalDate: new Date(fresh.signal_date),
          emailValidationStatus: fresh.validation_status, validationExpiresAt: new Date(fresh.validation_expires_at),
          suppressed: Boolean(suppression.rows[0]?.blocked), sequenceActive: fresh.sequence_status === "active", providerAvailable,
          duplicateMessage: Boolean(duplicate.rows[0]?.duplicate), withinVolumeCaps: withinCaps, withinSendingWindow: isNevadaSendingWindow(new Date(), this.env),
          senderIdentity: fresh.from_name, disclosure: fresh.adviser_disclosure, postalAddress: fresh.postal_address, unsubscribeUrl,
          maxSignalAgeDays: numberConfig(this.env.MAX_SIGNAL_AGE_DAYS, 90),
        });
        const idempotencyKey = `${event.payload.enrollmentId}:${sequenceStep.step_number}:${await sha256(subject).then((value) => value.slice(0, 16))}`;
        const messageId = uuid();
        const row = await neonQuery<{ id: string }>(this.env,
          `INSERT INTO outbound_messages (
             id,enrollment_id,qualified_lead_id,signal_event_id,provider,step_number,subject,body,source_url,
             preflight_status,preflight_failures,idempotency_key,scheduled_at,delivery_status
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13)
           ON CONFLICT (idempotency_key) DO UPDATE SET preflight_failures=EXCLUDED.preflight_failures RETURNING id`,
          [messageId,event.payload.enrollmentId,event.payload.qualifiedLeadId,fresh.signal_event_id,fresh.provider_mode,sequenceStep.step_number,
            subject,body,fresh.source_url,preflight.passed ? "passed" : "blocked",JSON.stringify(preflight.failures),idempotencyKey,
            preflight.passed ? "scheduled" : "blocked"],
        );
        await neonQuery(this.env,
          `UPDATE sequence_enrollments SET current_step=$2,next_send_at=$3 WHERE id=$1`,
          [event.payload.enrollmentId, sequenceStep.step_number, sequenceStep.step_number < 4 ? new Date(Date.now() + 48 * 3_600_000).toISOString() : null],
        );
        if (!preflight.passed) {
          await neonQuery(this.env, `INSERT INTO audit_log(entity_type,entity_id,action,workflow_run_id,rule_version,metadata) VALUES('outbound_message',$1,'preflight.blocked',$2,'signal-os-v2',$3)`, [row.rows[0]!.id,event.instanceId,JSON.stringify({ failures: preflight.failures })]);
          return null;
        }
        await this.env.AGENT_QUEUE.send({ kind: "send-message", messageId: row.rows[0]!.id, idempotencyKey: `send:${row.rows[0]!.id}` }, { contentType: "json" });
        return row.rows[0]!.id;
      });
      if (!queued) return;
    }
    await step.do("complete-seven-day-sequence", async () => {
      await neonQuery(this.env, `UPDATE sequence_enrollments SET status='completed',completed_at=now(),next_send_at=NULL WHERE id=$1 AND status='active'`, [event.payload.enrollmentId]);
    });
  }

  private async loadContext(params: SequenceParams): Promise<SequenceContext | null> {
    const rows = await neonQuery<SequenceContext>(this.env,
      `SELECT se.status AS enrollment_status,s.status AS sequence_status,ql.first_name,ql.email,ql.source_url,
              ev.evidence_excerpt,ev.signal_summary,ev.signal_type,COALESCE(ev.published_at,ev.created_at)::text AS signal_date,
              ev.id AS signal_event_id,c.from_name,c.adviser_disclosure,c.postal_address,c.provider_mode,
              val.validation_status,val.expires_at::text AS validation_expires_at
       FROM sequence_enrollments se JOIN sequences s ON s.id=se.sequence_id JOIN campaigns c ON c.id=s.campaign_id
       JOIN qualified_leads ql ON ql.id=se.qualified_lead_id JOIN signal_events ev ON ev.id=ql.primary_signal_event_id
       JOIN LATERAL (SELECT validation_status,expires_at FROM email_validations WHERE teacher_profile_id=ql.teacher_profile_id AND lower(email)=lower(ql.email) ORDER BY validated_at DESC LIMIT 1) val ON true
       WHERE se.id=$1 AND ql.id=$2
         AND NOT EXISTS(SELECT 1 FROM suppressions x WHERE lower(x.email)=lower(ql.email) AND (x.expires_at IS NULL OR x.expires_at>now()))
         AND NOT EXISTS(SELECT 1 FROM message_events me JOIN outbound_messages om ON om.id=me.outbound_message_id WHERE om.qualified_lead_id=ql.id AND me.event_type IN ('reply','positive_reply','negative_reply','booking','unsubscribe','complaint','hard_bounce','invalid_email','rejected','spam_report','manual_global_suppression','provider_suppression'))`,
      [params.enrollmentId, params.qualifiedLeadId],
    );
    return rows.rows[0] ?? null;
  }
}

function render(template: string, context: SequenceContext, unsubscribeUrl: string): string {
  const signalContext = signalContextText(context);
  return template
    .replaceAll("{{first_name}}", context.first_name)
    .replaceAll("{{signal_sentence}}", signalSentence(context))
    .replaceAll("{{signal_context}}", signalContext)
    .replaceAll("{{signal_context_lower}}", signalContext.toLowerCase())
    .replaceAll("{{signature}}", context.from_name)
    .replaceAll("{{disclosure}}", context.adviser_disclosure)
    .replaceAll("{{postal_address}}", context.postal_address)
    .replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
}

function signalSentence(context: SequenceContext): string {
  if (context.signal_type === "retirement_announcement") return `A public Nevada education source recently shared a retirement announcement connected to your school community.`;
  if (context.signal_type === "service_milestone_30" || context.signal_type === "service_milestone_33") return `A public school source recently recognized an educator service milestone in your community.`;
  return `A public update connected to your Nevada education community covered ${signalContextText(context).toLowerCase()}.`;
}
function signalContextText(context: SequenceContext): string { return context.signal_summary.replace(/\s+/g, " ").trim().slice(0, 220); }
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is not configured.`); return value; }
function numberConfig(value: unknown, fallback: number): number { const number = Number(value); return Number.isFinite(number) ? number : fallback; }

export function isNevadaSendingWindow(date: Date, env: Env): boolean {
  const timezone = String(env.SEND_TIMEZONE || "America/Los_Angeles");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
  return !["Sat", "Sun"].includes(weekday) && hour >= numberConfig(env.SEND_WINDOW_START, 9) && hour < numberConfig(env.SEND_WINDOW_END, 16);
}

export function nextNevadaSendingTime(date: Date, env: Env): Date {
  if (isNevadaSendingWindow(date, env)) return date;
  const candidate = new Date(date);
  for (let hours = 1; hours <= 120; hours += 1) {
    candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
    if (isNevadaSendingWindow(candidate, env)) return candidate;
  }
  return new Date(date.getTime() + 24 * 3_600_000);
}
