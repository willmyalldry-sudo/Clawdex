import { z } from "zod";

export const signalJobSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search-query"), searchRunId: z.string().uuid(), queryId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("crawl-source"), searchRunId: z.string().uuid(), sourceId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("resolve-teachers"), searchRunId: z.string().uuid(), signalEventId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("enrich-teacher"), teacherProfileId: z.string().uuid(), signalEventId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("validate-email"), teacherProfileId: z.string().uuid(), signalEventId: z.string().uuid(), email: z.string().email(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("qualify-lead"), teacherProfileId: z.string().uuid(), signalEventId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("enroll-lead"), qualifiedLeadId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
  z.object({ kind: z.literal("send-message"), messageId: z.string().uuid(), idempotencyKey: z.string().min(8).max(300) }),
]);

export type SignalJob = z.infer<typeof signalJobSchema>;

const TARGET_ROLES = ["teacher", "senior teacher", "lead teacher", "classroom teacher", "special education teacher", "instructional coach", "counselor", "librarian", "faculty", "professor", "instructor"];
const BLOCKED_ROLES = ["student", "parent", "vendor", "volunteer", "principal", "superintendent", "administrator", "executive"];
const PERSONAL_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"]);
const ROLE_LOCALS = /^(?:admin|admissions|benefits|contact|hello|hr|info|office|support|team|webmaster)$/i;

export function isTargetEducatorRole(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return TARGET_ROLES.some((role) => normalized.includes(role)) && !BLOCKED_ROLES.some((role) => normalized.includes(role));
}

export function professionalEmailGate(email: string, employerDomain: string): { passed: boolean; reasons: string[] } {
  const normalized = email.trim().toLowerCase();
  const [local = "", domain = ""] = normalized.split("@");
  const employer = employerDomain.trim().toLowerCase().replace(/^www\./, "");
  const reasons: string[] = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) reasons.push("invalid_email_syntax");
  if (PERSONAL_DOMAINS.has(domain)) reasons.push("personal_or_free_email");
  if (ROLE_LOCALS.test(local)) reasons.push("role_address");
  if (!employer || (domain !== employer && !domain.endsWith(`.${employer}`))) reasons.push("employer_domain_mismatch");
  return { passed: reasons.length === 0, reasons };
}

export interface QualificationInput {
  jobTitle: string;
  currentDistrict: string;
  employerDomain: string;
  identityConfidence: number;
  employmentConfidence: number;
  employmentStatus: string;
  signalStatus: string;
  signalScore: number;
  signalDate: Date;
  evidenceExcerpt: string;
  sourceUrl: string;
  email: string;
  validationStatus: string;
  validatedAt: Date;
  isDisposable: boolean;
  isRoleAddress: boolean;
  isFreeProvider: boolean;
  isCatchAll: boolean;
  isEmployerDomainMatch: boolean;
  isSuppressed: boolean;
  hasTerminalEvent: boolean;
  hasActiveEnrollment: boolean;
  now?: Date;
  minSignalScore?: number;
  minQualificationScore?: number;
  minIdentityConfidence?: number;
  minEmploymentConfidence?: number;
  maxSignalAgeDays?: number;
  validationMaxAgeDays?: number;
}

export function qualifyTeacher(input: QualificationInput): { qualified: boolean; score: number; blockers: string[] } {
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const ageDays = (now.getTime() - input.signalDate.getTime()) / 86_400_000;
  const validationAge = (now.getTime() - input.validatedAt.getTime()) / 86_400_000;
  if (!isTargetEducatorRole(input.jobTitle)) blockers.push("target_role_not_verified");
  if (!input.currentDistrict.trim() || !input.employerDomain.trim()) blockers.push("nevada_public_employer_not_verified");
  if (input.employmentStatus !== "verified_current") blockers.push("current_employment_not_verified");
  if (input.signalStatus !== "active" || input.signalScore < (input.minSignalScore ?? 60)) blockers.push("signal_gate_failed");
  if (!input.evidenceExcerpt.trim() || !input.sourceUrl.startsWith("http")) blockers.push("signal_evidence_missing");
  if (ageDays < 0 || ageDays > (input.maxSignalAgeDays ?? 90)) blockers.push("signal_stale");
  if (input.identityConfidence < (input.minIdentityConfidence ?? 0.8)) blockers.push("identity_confidence_low");
  if (input.employmentConfidence < (input.minEmploymentConfidence ?? 0.8)) blockers.push("employment_confidence_low");
  blockers.push(...professionalEmailGate(input.email, input.employerDomain).reasons);
  if (input.validationStatus !== "valid" || validationAge > (input.validationMaxAgeDays ?? 30)) blockers.push("email_validation_gate_failed");
  if (input.isDisposable || input.isRoleAddress || input.isFreeProvider || input.isCatchAll || !input.isEmployerDomainMatch) blockers.push("email_hygiene_gate_failed");
  if (input.isSuppressed) blockers.push("suppressed");
  if (input.hasTerminalEvent) blockers.push("terminal_event_exists");
  if (input.hasActiveEnrollment) blockers.push("active_enrollment_exists");

  let score = 0;
  score += Math.min(35, Math.round(input.signalScore * 0.35));
  if (input.signalScore >= 85) score += 15;
  if (input.identityConfidence >= 0.8) score += 15;
  if (input.employmentConfidence >= 0.8) score += 15;
  if (input.isEmployerDomainMatch) score += 10;
  if (input.validationStatus === "valid") score += 20;
  if (ageDays > 90) score -= 30;
  if (input.isCatchAll) score -= 40;
  score = Math.max(0, Math.min(100, score));
  const uniqueBlockers = [...new Set(blockers)];
  return { qualified: uniqueBlockers.length === 0 && score >= (input.minQualificationScore ?? 75), score, blockers: uniqueBlockers };
}

const PROHIBITED_MESSAGE = /\b(?:guaranteed?|risk[- ]?free|definitely retiring|you are retiring|your pension value|your age|your health|tracking you|scraped your|laid off)\b/i;

export function deterministicPreflight(input: {
  subject: string;
  body: string;
  sourceUrl: string;
  evidenceExcerpt: string;
  signalDate: Date;
  emailValidationStatus: string;
  validationExpiresAt: Date;
  suppressed: boolean;
  sequenceActive: boolean;
  providerAvailable: boolean;
  duplicateMessage: boolean;
  withinVolumeCaps: boolean;
  withinSendingWindow: boolean;
  senderIdentity: string;
  disclosure: string;
  postalAddress: string;
  unsubscribeUrl: string;
  now?: Date;
  maxSignalAgeDays?: number;
}): { passed: boolean; failures: string[] } {
  const now = input.now ?? new Date();
  const failures: string[] = [];
  const subjectWords = input.subject.trim().split(/\s+/).filter(Boolean);
  const questionCount = (input.body.match(/\?/g) ?? []).length;
  const signalAge = (now.getTime() - input.signalDate.getTime()) / 86_400_000;
  if (!input.sourceUrl.startsWith("http") || !input.evidenceExcerpt.trim()) failures.push("signal_evidence_missing");
  if (signalAge < 0 || signalAge > (input.maxSignalAgeDays ?? 90)) failures.push("signal_stale");
  if (input.emailValidationStatus !== "valid" || input.validationExpiresAt <= now) failures.push("email_not_current_valid");
  if (input.suppressed) failures.push("lead_suppressed");
  if (!input.sequenceActive) failures.push("sequence_inactive");
  if (!input.providerAvailable) failures.push("provider_unavailable");
  if (input.duplicateMessage) failures.push("duplicate_message");
  if (!input.withinVolumeCaps) failures.push("volume_cap_exceeded");
  if (!input.withinSendingWindow) failures.push("outside_sending_window");
  if (subjectWords.length === 0 || subjectWords.length > 7) failures.push("subject_word_limit");
  if (questionCount !== 1) failures.push("cta_count_must_equal_one");
  if (!input.senderIdentity.trim() || !input.body.includes(input.senderIdentity)) failures.push("sender_identity_missing");
  if (!input.disclosure.trim() || !input.body.includes(input.disclosure)) failures.push("disclosure_missing");
  if (!input.postalAddress.trim() || !input.body.includes(input.postalAddress)) failures.push("postal_address_missing");
  if (!input.unsubscribeUrl || !input.body.includes(input.unsubscribeUrl)) failures.push("unsubscribe_missing");
  if (PROHIBITED_MESSAGE.test(`${input.subject} ${input.body}`)) failures.push("prohibited_claim");
  return { passed: failures.length === 0, failures: [...new Set(failures)] };
}
