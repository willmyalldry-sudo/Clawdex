# QA and release checklist

## Automated release checks

- [x] `npm run cf:types`
- [x] `npm run typecheck`
- [x] `npm test` — 25 tests
- [x] `npm run build:web`
- [x] `npm run build` Worker dry-run
- [x] Neon migrations and seed applied
- [x] 12 core tables verified, 16 queries seeded, 4 sequence steps seeded
- [x] Live `/api/health` confirms Neon + Hyperdrive
- [x] Live operational API rejects requests without Cloudflare Access
- [x] Live Worker reports `OUTREACH_MODE=disabled`

## Search and evidence

- [x] Query cooldown and hourly-run dedupe
- [x] Parallel/TinyFish merge and canonical URL dedupe
- [x] Automatic official-domain allow and restricted-source quarantine
- [x] `robots.txt` most-specific allow/disallow behavior
- [x] Bounded fetch, content hash, evidence excerpt, and R2 snapshot
- [x] Stale signal and missing evidence qualification blocks

## Teacher, enrichment, and validation

- [x] Target-role allowlist and administrator exclusions
- [x] Current employment and identity confidence required
- [x] Personal, free, role, guessed, catch-all, and employer-mismatch emails blocked
- [x] Apollo requests exclude personal reveal fields
- [x] ZeroBounce `valid` is the only accepted runtime status
- [x] Suppression, terminal event, and active enrollment cannot be bypassed

## Message and sequence

- [x] Day 1, 3, 5, and 7 Workflow
- [x] Signal-specific message fields
- [x] Seven-word subject, one CTA, disclosure, postal address, unsubscribe
- [x] Prohibited claims and sensitive inference block
- [x] Hourly/daily caps and Nevada sending window
- [x] AgentMail-only and controlled AutoSend routing code
- [x] Signed/timestamped webhook verification and event dedupe
- [x] Transactional stop/cancel/suppress behavior
- [ ] Signed provider sandbox fixtures for every terminal event

## Production blockers

- [ ] `PARALLEL_API_KEY`
- [ ] `ZEROBOUNCE_API_KEY`
- [ ] Optional PDL/AutoSend/Calendly credentials if enabled
- [ ] SPF, DKIM, DMARC and sender identity verification
- [ ] Imported global suppression lists
- [ ] Cloudflare Access policy reviewed in dashboard
- [ ] Compliance/supervisory activation approval
- [ ] End-to-end internal sequence tests
- [ ] Visual desktop/mobile browser QA (browser connector unavailable during this release run)

Keep `OUTREACH_MODE=disabled` until every production blocker is closed.
