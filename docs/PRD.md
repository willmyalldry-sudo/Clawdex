# Product Requirements: Benjamin Persyn Agent OS

## Product outcome

Help Benjamin consistently identify and educate Nevada teachers who may benefit from a retirement-readiness conversation while preserving source provenance, consent, approval, and communication records.

Primary conversion: a qualified prospect books a retirement-readiness review.

Primary users: Benjamin, an authorized operations assistant, and the designated compliance reviewer.

## Core workflows

1. TinyFish Source Scout searches for recent Nevada educator retirement and benefits updates.
2. A human approves or rejects each candidate source.
3. The crawler checks robots rules, fetches approved content, archives it in R2, and extracts reviewable signals.
4. Leads enter through import, approved research, or licensed enrichment.
5. People Data Labs may complete professional fields; ZeroBounce validates email.
6. Deterministic scoring prioritizes Nevada location, educator role, supported tenure, cited signals, and validated contactability. It never infers age or assets.
7. Campaign copy must contain the approved disclosure, physical address configuration, and unsubscribe token; prohibited claims block submission.
8. A human approves the exact archived campaign version.
9. Cloudflare Workflows runs the approved schedule. Every send rechecks approval, suppression, consent, and outbound mode.
10. SendGrid, Twilio, inbound email, and Calendly events update the activity ledger and stop sequences where required.

## Functional acceptance criteria

- Every researched field displays a source URL, retrieval time, confidence, and evidence hash.
- Unapproved sources cannot crawl.
- Duplicate queue delivery cannot duplicate an outbound message.
- No campaign launches without an approved, archived version.
- Newsletters require active newsletter consent.
- Marketing SMS requires active SMS consent.
- Reply, booking, unsubscribe, complaint, hard bounce, or suppression stops future steps.
- Dashboard metrics update within ten seconds of persisted provider events.
- Failed jobs exhaust to a visible dead-letter activity item.
- Production sending remains impossible while `OUTREACH_MODE` is disabled.

## Out of scope for v1

- Individualized investment recommendations or account analysis
- Tax or legal advice
- Portfolio performance projections
- LinkedIn scraping, private portals, CAPTCHA bypass, or purchased lists without provenance
- Age, asset, health, or financial-distress inference
- Multi-tenant billing and client isolation
