# Cleanup: Legacy Schema Removal (V2.0 → V2.1)

## Summary

V1 schemas (`queueMessageSchema`, `scoreLead`, `LeadInput`, `CampaignInput`) describe the **human-in-the-loop** lead management system. The current production system (v2.0) is **fully autonomous** and uses `signalJobSchema` exclusively.

This document tracks the deprecation path for v1 artifacts.

---

## What's Deprecated

| Item | Location | Usage | Status |
|------|----------|-------|--------|
| `queueMessageSchema` | `packages/shared/src/schemas.ts` | Not used; queue dispatcher only recognizes `signalJobSchema` | **Dead code** |
| `scoreLead()` | `packages/shared/src/scoring.ts` | Not called in worker or web | **Dead code** |
| `scoreLabel()` | `packages/shared/src/scoring.ts` | Not called anywhere | **Dead code** |
| `LeadInput`, `CampaignInput` | `packages/shared/src/schemas.ts` | Only in web UI (if at all); not in production pipeline | **Possible legacy UI** |
| `leadStatusSchema`, `sequenceStepSchema` | `packages/shared/src/schemas.ts` | Not in active code paths | **Dead code** |

---

## Production Evidence: V1 is NOT Used

### Queue Dispatcher (apps/worker/src/index.ts, lines 87–89)

```typescript
if (["search-query", "crawl-source", "resolve-teachers"].includes(job.kind)) await processSignalJob(env, job);
else if (["enrich-teacher", "validate-email", "qualify-lead", "enroll-lead"].includes(job.kind)) await processLeadPipelineJob(env, job);
else await processSendJob(env, job);
```

**All 8 kinds routed belong to `signalJobSchema` (v2).** The old `queueMessageSchema` kinds (`discover-web`, old `crawl-source`, `enrich-lead`, old `validate-email`) are **never dispatched**.

### Lead Pipeline Imports (apps/worker/src/lib/lead-pipeline.ts, line 1)

```typescript
import { qualifyTeacher, signalJobSchema, type SignalJob, professionalEmailGate } from "@agent-os/shared";
```

Only imports from `signal-os.ts` (v2), **not from `schemas.ts`** (v1).

### Autonomous Pipeline Imports (apps/worker/src/lib/autonomous-pipeline.ts, line 1)

```typescript
import { signalJobSchema, type SignalJob, professionalEmailGate } from "@agent-os/shared";
```

Only v2 schemas imported.

---

## Removal Timeline

### v2.0 (Current)
- ✅ All v2 schemas finalized and in use
- ✅ All queue messages use `signalJobSchema`
- ✅ Qualification gates use `qualifyTeacher()` deterministic logic
- ⚠️ V1 schemas still present but marked `@deprecated`
- ⚠️ V1 exports in `packages/shared/src/index.ts` for backward compat

### v2.0.1 (Bugfix)
- 📝 Audit: Check if any external consumers depend on v1 schemas
- 📝 Document: Provide migration path if needed

### v2.1.0 (Minor)
- 🗑️ **Remove** `packages/shared/src/scoring.ts` entirely
- 🗑️ **Remove** `scoring.test.ts`
- 🗑️ **Remove** v1 schema exports from `packages/shared/src/index.ts`
- ✏️ **Keep** `schemas.ts` for reference only (or delete entirely if no legacy UI)
- 📋 Update `CHANGELOG.md` with breaking change notice

---

## Safe-to-Remove Checklist

Before v2.1.0 release:

- [ ] Confirm `apps/web` does not import `LeadInput`, `CampaignInput`, `scoreLead`, or `queueMessageSchema`
- [ ] Search all repos for external `@agent-os/shared` consumers
- [ ] No GitHub Actions workflows reference v1 schemas
- [ ] No documentation examples use v1 kinds (`discover-web`, `enrich-lead`)
- [ ] All tests updated to use v2 `signalJobSchema`

---

## Migration Path for External Systems

If external code depends on v1 schemas:

**Old (v1)**:
```typescript
import { queueMessageSchema, type QueueMessage } from "@agent-os/shared";
const msg: QueueMessage = { kind: "discover-web", query: "...", runId: "..." };
await queue.send(msg);
```

**New (v2)**:
```typescript
import { signalJobSchema, type SignalJob } from "@agent-os/shared";
const msg: SignalJob = { kind: "search-query", searchRunId: "...", queryId: "...", idempotencyKey: "..." };
await queue.send(msg);
```

Key differences:
- `discover-web` → `search-query` + `queryId` parameter
- `enrich-lead` → `enrich-teacher` + `teacherProfileId` parameter
- `validate-email` → `validate-email` (same name, but different fields)
- All v2 jobs require `idempotencyKey` for deduplication

---

## References

- Production queue dispatcher: `apps/worker/src/index.ts` (lines 74–96)
- V2 schemas: `packages/shared/src/signal-os.ts`
- V2 qualification gates: `packages/shared/src/signal-os.ts` (lines 70–102)
- V2 compliance checks: `packages/shared/src/compliance.ts`
- Old v1 schemas: `packages/shared/src/schemas.ts` (legacy only)
- Old v1 scoring: `packages/shared/src/scoring.ts` (legacy only)
