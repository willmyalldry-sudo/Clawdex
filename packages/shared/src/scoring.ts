import type { LeadScoreInput } from "./schemas";

const EDUCATOR_TERMS = ["teacher", "educator", "principal", "counselor", "administrator", "faculty", "school"];

export function scoreLead(input: LeadScoreInput): number {
  let score = 0;
  if (input.state?.toUpperCase() === "NV") score += 25;
  const title = input.title?.toLowerCase() ?? "";
  if (EDUCATOR_TERMS.some((term) => title.includes(term))) score += 20;
  if ((input.yearsInEducation ?? 0) >= 20) score += 15;
  else if ((input.yearsInEducation ?? 0) >= 10) score += 8;
  score += Math.min(input.signalCount ?? 0, 3) * 8;
  if ((input.latestSignalDays ?? Number.POSITIVE_INFINITY) <= 30) score += 10;
  else if ((input.latestSignalDays ?? Number.POSITIVE_INFINITY) <= 90) score += 5;
  if (input.emailStatus === "valid") score += 10;
  if (input.hasOrganization) score += 5;
  if (input.hasSourceEvidence) score += 5;
  if (input.replied) score += 10;
  if (input.booked) score = 100;
  return Math.max(0, Math.min(100, score));
}

export function scoreLabel(score: number): "hot" | "warm" | "developing" {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  return "developing";
}
