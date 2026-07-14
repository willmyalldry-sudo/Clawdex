export { signalJobSchema, type SignalJob, qualifyTeacher, professionalEmailGate, deterministicPreflight, isTargetEducatorRole, type QualificationInput } from "./signal-os";
export { checkCampaignCompliance, type CampaignComplianceInput } from "./compliance";
export { type McpServer } from "./mcp";

// ============================================================================
// LEGACY EXPORTS — DEPRECATED
// ============================================================================
// These exports are kept for backward compatibility only.
// All active code should use signal-os.ts symbols instead.
// Removal candidate: v2.1.0+
// ============================================================================

/**
 * @deprecated Use `signalJobSchema` from ./signal-os.ts instead
 */
export { queueMessageSchema, type QueueMessage, leadStatusSchema, emailStatusSchema, leadInputSchema, leadImportSchema, sourceInputSchema, sequenceStepSchema, campaignInputSchema, approvalInputSchema, consentInputSchema, launchInputSchema, type LeadInput, type SourceInput, type CampaignInput, type LeadScoreInput, type ComplianceCheckResult } from "./schemas";

/**
 * @deprecated Use `qualifyTeacher()` from ./signal-os.ts instead
 */
export { scoreLead, scoreLabel } from "./scoring";
