/**
 * @deprecated Legacy scoring function from v1 (human-in-the-loop) system.
 * Use `qualifyTeacher()` from signal-os.ts instead, which implements deterministic gates.
 *
 * This function is NOT used in the autonomous signal pipeline.
 * Removal candidate: v2.1.0+
 *
 * @see packages/shared/src/signal-os.ts
 */

import type { LeadScoreInput } from "./schemas";

const EDUCATOR_TERMS = ["teacher", "educator", "principal", "counselor", "administrator", "faculty", "school"];

/**
 * @deprecated Use `qualifyTeacher()` from signal-os.ts instead.
 * This was used in the v1 model for scoring leads for human review.
 * The current v2 system uses deterministic gates (blockers) instead of simple scoring.
 */
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

/**
 * @deprecated Use the label mapping in UI layers instead.
 */
export function scoreLabel(score: number): "hot" | "warm" | "developing" {
  if (score >= 75) return "hot";
  if (score >= 50) return "warm";
  return "developing";
}
