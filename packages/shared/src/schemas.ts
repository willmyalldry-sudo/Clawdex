import { z } from "zod";

export const leadStatusSchema = z.enum([
  "new",
  "enriching",
  "ready",
  "review",
  "contacted",
  "replied",
  "booked",
  "suppressed",
]);

export const emailStatusSchema = z.enum([
  "unknown",
  "pending",
  "valid",
  "risky",
  "invalid",
  "unavailable",
]);

export const leadInputSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(32).optional().or(z.literal("")),
  title: z.string().trim().max(140).optional().or(z.literal("")),
  organization: z.string().trim().max(180).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  state: z.string().trim().length(2).default("NV"),
  yearsInEducation: z.coerce.number().int().min(0).max(70).optional(),
  sourceUrl: z.string().url().optional().or(z.literal("")),
});

export const leadImportSchema = z.object({
  leads: z.array(leadInputSchema).min(1).max(500),
});

export const sourceInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: z.string().url(),
  sourceType: z.enum(["district", "school", "news", "retirement", "benefits", "licensed_api"]),
  crawlFrequency: z.enum(["daily", "weekly", "monthly", "manual"]).default("weekly"),
  robotsPolicy: z.enum(["honor", "manual_only"]).default("honor"),
});

export const sequenceStepSchema = z.object({
  delayDays: z.number().int().min(0).max(90),
  subject: z.string().trim().min(3).max(180),
  bodyHtml: z.string().min(20).max(100_000),
});

export const campaignInputSchema = z.object({
  name: z.string().trim().min(3).max(160),
  campaignType: z.enum(["sequence", "newsletter"]).default("sequence"),
  subject: z.string().trim().min(3).max(180),
  previewText: z.string().trim().max(240).optional().default(""),
  bodyHtml: z.string().min(20).max(100_000),
  disclosure: z.string().trim().min(10).max(2_000),
  audienceDescription: z.string().trim().min(3).max(500),
  sequenceSteps: z.array(sequenceStepSchema).min(1).max(8).optional(),
});

export const approvalInputSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().trim().max(2_000).optional().default(""),
});

export const consentInputSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(["email_newsletter", "sms_marketing", "sms_transactional"]),
  status: z.enum(["granted", "revoked"]),
  consentText: z.string().trim().min(10).max(2_000),
  source: z.string().trim().min(2).max(180),
});

export const launchInputSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(500),
});

export const queueMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discover-web"),
    query: z.string().min(3).max(300),
    runId: z.string().uuid(),
    queryId: z.string().max(180).optional(),
    category: z.enum(["eligibility", "district", "board_records", "events", "service_milestone", "legislation", "workforce", "benefits", "financial_planning", "public_professional", "official_guidance"]).optional(),
    sourceType: z.enum(["district", "school", "news", "retirement", "benefits"]).optional(),
  }),
  z.object({ kind: z.literal("crawl-source"), sourceId: z.string().uuid(), runId: z.string().uuid() }),
  z.object({ kind: z.literal("enrich-lead"), leadId: z.string().uuid(), runId: z.string().uuid() }),
  z.object({ kind: z.literal("validate-email"), leadId: z.string().uuid(), runId: z.string().uuid() }),
  z.object({ kind: z.literal("send-message"), messageId: z.string().uuid() }),
]);

export type LeadInput = z.infer<typeof leadInputSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type QueueMessage = z.infer<typeof queueMessageSchema>;

export interface LeadScoreInput {
  state?: string | null;
  title?: string | null;
  yearsInEducation?: number | null;
  signalCount?: number | null;
  latestSignalDays?: number | null;
  emailStatus?: string | null;
  hasOrganization?: boolean;
  hasSourceEvidence?: boolean;
  replied?: boolean;
  booked?: boolean;
}

export interface ComplianceCheckResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
}
