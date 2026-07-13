# Architecture

```text
React dashboard
      |
      v
Hono Worker API -- Cloudflare Access
      |
      +--> Neon Postgres via Hyperdrive (authoritative state)
      +--> R2 (evidence and webhook payloads)
      +--> Queue + DLQ (at-least-once jobs)
      +--> Workflow (Day 1, 3, 5, 7 sequence)
      +--> Durable Object + Workers AI (Access-protected MCP control agent)

Cron 5 * * * *
      -> query cooldown and budget locks
      -> Parallel + TinyFish search
      -> URL canonicalization + automatic policy + robots
      -> bounded extract/fetch/native crawl
      -> evidence-backed signal
      -> educator candidate/profile/link
      -> Apollo -> optional PDL
      -> Bouncer + employer-domain validation
      -> deterministic qualification
      -> enrollment and signal-specific preflight
      -> AgentMail / controlled AutoSend
      -> signed events -> terminal stop + suppression
```

## Trust boundaries

- Only `/api/health`, provider webhooks, unsubscribe, booking redirect, crawler policy, and static assets are public.
- Operational routes require Cloudflare Access; the Worker verifies the `cf-access-jwt-assertion` JWT signature against the team's JWKS (`iss`/`aud` checked via `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD`), not just header presence, and fails closed if those vars are unset.
- Provider secrets are Worker secrets; database credentials are in Hyperdrive/secret storage.
- Queue jobs are Zod-validated and idempotent; each message is explicitly acknowledged or retried.
- External content is bounded, archived, policy-checked, and treated as untrusted.
- Database state transitions use PostgreSQL transactions and unique constraints.
- Qualification and preflight are deterministic and fail closed.
- D1 is legacy/demo only; Neon owns business records.

## Data flow invariants

1. A qualified lead references one current verified signal.
2. A signal retains its source URL, evidence excerpt, content hash, and R2 artifact.
3. A professional email must match the verified employer domain and have a current `valid` Bouncer record.
4. A terminal event cancels scheduled messages before another step can send.
5. Newsletter subscription requires explicit timestamped consent evidence.
6. Provider fallback is allowed only before the primary provider accepted the message.
