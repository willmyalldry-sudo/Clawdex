import type { ComplianceCheckResult } from "./schemas";

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\bguarantee(?:d)?\b/i, "Remove guarantees or promised outcomes."],
  [/\brisk[- ]?free\b/i, "Do not describe an investment or strategy as risk-free."],
  [/\bbeat(?:s|ing)? the market\b/i, "Remove unsubstantiated performance comparisons."],
  [/\bwill (?:earn|return|grow|save)\b/i, "Remove promissory future-result language."],
  [/\bIRS approved\b/i, "Do not imply IRS endorsement or approval."],
];

export function checkCampaignCompliance(input: {
  subject: string;
  bodyHtml: string;
  disclosure: string;
  hasPhysicalAddress: boolean;
  hasUnsubscribeToken: boolean;
  evidenceCount?: number;
}): ComplianceCheckResult {
  const combined = `${input.subject} ${stripHtml(input.bodyHtml)}`;
  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const [pattern, message] of BLOCKED_PATTERNS) {
    if (pattern.test(combined)) blockers.push(message);
  }
  if (input.disclosure.trim().length < 10) blockers.push("Add the approved adviser disclosure.");
  if (!input.hasPhysicalAddress) blockers.push("Add a valid physical postal address.");
  if (!input.hasUnsubscribeToken) blockers.push("Add the required unsubscribe link token.");
  const subjectWords = input.subject.trim().split(/\s+/).filter(Boolean);
  if (subjectWords.length > 7) blockers.push("Keep the subject line to seven words or fewer.");
  if (/^(?:re|fw|fwd)\s*:/i.test(input.subject)) blockers.push("Do not use deceptive reply or forward subject prefixes.");
  if (!input.bodyHtml.includes("{{first_name}}")) blockers.push("Add the recipient first-name token.");
  if (!input.bodyHtml.includes("{{personalization_detail}}")) warnings.push("Add one reviewed, source-backed professional personalization detail.");
  const questionCount = (stripHtml(input.bodyHtml).match(/\?/g) ?? []).length;
  if (questionCount > 1) warnings.push("Use one clear call to action.");
  if (/\b(?:best|top|leading|number one|#1)\b/i.test(combined)) {
    warnings.push("Substantiate or remove superlative claims.");
  }
  if (/\b(?:tax savings?|tax-free|deductible)\b/i.test(combined)) {
    warnings.push("Compliance must verify all tax-related language and applicable limitations.");
  }
  if ((input.evidenceCount ?? 0) === 0) {
    warnings.push("Personalization should cite at least one approved source signal.");
  }
  return { passed: blockers.length === 0, blockers: [...new Set(blockers)], warnings: [...new Set(warnings)] };
}

export function stripHtml(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
