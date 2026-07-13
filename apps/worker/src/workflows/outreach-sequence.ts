import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { sequenceStepSchema } from "@agent-os/shared";
import { z } from "zod";
import { isSuppressed } from "../lib/db";
import { nowIso, uuid } from "../lib/utils";

export interface SequenceParams {
  enrollmentId: string;
  leadId: string;
  campaignId: string;
  campaignVersion: number;
}

interface CampaignSequenceRow {
  campaign_status: string;
  approved_version: number | null;
  sequence_json: string;
  lead_status: string;
  email_status: string;
}

const approvedSequenceSchema = z.array(sequenceStepSchema).min(1).max(8);

export class OutreachSequenceWorkflow extends WorkflowEntrypoint<Env, SequenceParams> {
  override async run(event: WorkflowEvent<SequenceParams>, step: WorkflowStep): Promise<void> {
    const sequence = await step.do("load-approved-sequence", async () => {
      const row = await this.env.DB.prepare(
        `SELECT c.status AS campaign_status, c.approved_version, cv.sequence_json, l.status AS lead_status, l.email_status
         FROM campaigns c
         JOIN campaign_versions cv ON cv.campaign_id = c.id AND cv.version = ?
         JOIN leads l ON l.id = ?
         WHERE c.id = ?`,
      ).bind(event.payload.campaignVersion, event.payload.leadId, event.payload.campaignId).first<CampaignSequenceRow>();
      if (!row || row.campaign_status !== "approved" || row.approved_version !== event.payload.campaignVersion) {
        throw new Error("Campaign version is not approved.");
      }
      return approvedSequenceSchema.parse(JSON.parse(row.sequence_json));
    });

    for (let index = 0; index < sequence.length; index += 1) {
      const item = sequence[index];
      if (!item) continue;
      if (item.delayDays > 0) await step.sleep(`wait-before-step-${index + 1}`, `${item.delayDays} days`);
      const shouldContinue = await step.do(`eligibility-step-${index + 1}`, async () => {
        const enrollment = await this.env.DB.prepare("SELECT status FROM sequence_enrollments WHERE id = ?")
          .bind(event.payload.enrollmentId).first<{ status: string }>();
        if (enrollment?.status !== "active") return false;
        return !(await isSuppressed(this.env.DB, event.payload.leadId, "email"));
      });
      if (!shouldContinue) return;

      const messageId = await step.do(`queue-email-step-${index + 1}`, async () => {
        const id = uuid();
        const idempotencyKey = `${event.payload.enrollmentId}:email:${index + 1}`;
        await this.env.DB.batch([
          this.env.DB.prepare(
            `INSERT OR IGNORE INTO messages (id, enrollment_id, campaign_id, campaign_version, lead_id, channel, sequence_step, subject, body_html, status, idempotency_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'email', ?, ?, ?, 'queued', ?, ?, ?)`,
          ).bind(id, event.payload.enrollmentId, event.payload.campaignId, event.payload.campaignVersion, event.payload.leadId, index + 1, item.subject, item.bodyHtml, idempotencyKey, nowIso(), nowIso()),
          this.env.DB.prepare("UPDATE sequence_enrollments SET current_step = ?, updated_at = ? WHERE id = ?")
            .bind(index + 1, nowIso(), event.payload.enrollmentId),
        ]);
        const existing = await this.env.DB.prepare("SELECT id FROM messages WHERE idempotency_key = ?")
          .bind(idempotencyKey).first<{ id: string }>();
        if (!existing) throw new Error("Could not create sequence message.");
        await this.env.AGENT_QUEUE.send({ kind: "send-message", messageId: existing.id });
        return existing.id;
      });
      if (!messageId) throw new Error("Message was not queued.");
    }

    await step.do("complete-sequence", async () => {
      await this.env.DB.prepare("UPDATE sequence_enrollments SET status = 'completed', updated_at = ? WHERE id = ? AND status = 'active'")
        .bind(nowIso(), event.payload.enrollmentId).run();
    });
  }
}
