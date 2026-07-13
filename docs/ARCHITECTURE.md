# Architecture

```text
React dashboard ──> Hono Worker API ──> D1 operational CRM
       │                    │          ├─ leads, signals, evidence metadata
       │                    │          ├─ campaigns, approvals, consent
       │                    │          └─ events, bookings, agent runs
       │                    ├────────> R2 evidence and campaign archives
       │                    ├────────> Queue ──> crawler/enrichment/send consumers
       │                    └────────> Workflow ──> approved timed sequences
       │
       └── 10-second polling <── activity and analytics ledger

Cron/manual batch ──> 219-query Nevada rotation ──> Parallel + TinyFish Search
                                      │             └─ deduplicated candidate sources ──> human approval
                                      └─ 17 district profiles + official NVPERS/IRS/government searches

approved source ──> robots check ──> Parallel Extract/TinyFish Fetch/native fallback
                                └─ 16 retirement signal scrapers ──> scored evidence ──> human verification

Apollo API ────────> primary professional enrichment (work email/title/org/LinkedIn only)
People Data Labs ──> optional enrichment fallback
ZeroBounce ────────> email validation
AgentMail ─────────> approved email + signed reply/delivery webhooks ──> event ledger/suppression
SendGrid/Twilio ──> optional fallback email + consent-gated SMS
Calendly ─────────> booking webhook ──> conversion/sequence stop
```

## Trust boundaries

- Cloudflare Access protects operational routes; webhook and unsubscribe routes use provider signatures or cryptographic tokens.
- Secrets are Worker secrets, never `vars` or source.
- Queue messages are schema-validated and idempotent because delivery is at least once.
- Workflow steps use deterministic names and store approved copy before scheduling.
- External content is untrusted, bounded, archived, and never allowed to decide sending.
- AI/web-agent output creates candidates and drafts; deterministic rules and humans control consequential actions.
- Public professional contact data is accepted only when explicitly employer-published; personal phones, home addresses, private sources, guessed emails, and anonymous-user identification are prohibited.
- Writer output is always a draft. Source-backed professional personalization, deterministic compliance checks, and human campaign-version approval are required before AgentMail enrollment.

## Data retention

The schema supports append-oriented activity, approval, consent, message, and event records plus content-addressed R2 archives. The final retention period and any write-once requirements must be configured from Benjamin's actual regulatory status and compliance policy before production use.
