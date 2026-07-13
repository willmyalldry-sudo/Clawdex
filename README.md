# Benjamin Persyn Nevada Educator Signal OS

Autonomous, signal-driven lead intelligence and educational outreach for a Nevada financial adviser serving public educators. Neon Postgres is the authoritative system of record; Cloudflare Workers, Cron, Queues, Workflows, R2, Hyperdrive, and Access run the system.

The core rule is enforced in code: **no message can send without a current, verified public retirement signal and a valid employer-domain work email.**

## Production status

- Live Worker: <https://benjamin-os.solutionspartner.workers.dev>
- Version: `2.0.0`
- Schedule: `5 * * * *`
- Database: Neon through Cloudflare Hyperdrive
- Outreach: `OUTREACH_MODE=disabled`
- Operational API: Cloudflare Access protected
- Demo contacts: `.invalid` addresses only

Sending must remain disabled until every activation gate below is complete.

## Autonomous pipeline

```text
Hourly Cron
  -> lock due Nevada signal queries
  -> Parallel + TinyFish search
  -> automatic source/robots policy
  -> bounded crawl and R2 evidence snapshot
  -> extract and deduplicate retirement signals
  -> resolve current public educator identity
  -> Apollo enrichment, optional PDL fallback
  -> Bouncer validation and employer-domain gate
  -> deterministic qualification
  -> Day 1, 3, 5, 7 Workflow enrollment
  -> deterministic message preflight
  -> AgentMail, or controlled AutoSend route
  -> stop on reply, booking, opt-out, bounce, rejection, or complaint
```

There is no routine human approval queue. Unsafe or incomplete records are blocked or quarantined, never passed forward.

## Safety defaults

- Public professional information only.
- No private/member-only sources, CAPTCHA bypass, Tor/proxy evasion, guessed emails, personal email, personal phone, or home address.
- `robots.txt`, timeouts, content limits, provider budgets, idempotency, and dead-letter handling are enforced.
- District-wide signals remain district-wide; they cannot become personal retirement claims.
- Every message includes cited evidence, sender identity, disclosure, postal address, one CTA, and one-click unsubscribe.
- Newsletter candidates are separate from subscribers; explicit recorded consent is required.
- External content and provider output are untrusted and cannot authorize sending.

## Stack

- React 19 + Vite
- Hono on Cloudflare Workers
- Neon Postgres + `pg` + Cloudflare Hyperdrive
- Cloudflare Cron, Queues, Workflows, R2, Access, Workers AI, Durable Objects
- Zod contracts across API, queues, workflows, and qualification logic
- Parallel, TinyFish, Apollo, optional People Data Labs, Bouncer, AgentMail, optional AutoSend, Calendly

D1 remains bound only for legacy/demo control-plane compatibility. Signal, educator, validation, qualification, outreach, sequence, newsletter, suppression, and analytics state is written to Neon.

## Database

Migrations are under [`database/neon`](database/neon). They create the signal query/run/source/event model, teacher candidate/profile/link model, enrichment and validation records, qualified leads, campaigns and sequences, newsletter consent tables, outbound/event records, suppression, audit, job, provider-usage, and system-configuration tables.

```powershell
$env:DATABASE_URL="postgresql://..."
npm run db:migrate:neon
npm run db:seed:neon
```

The seed installs 16 rotating Nevada queries and the four-step Day 1/3/5/7 sequence.

## Local setup

Requirements: Node.js 22+, npm 10+, a Neon database, and a Cloudflare account.

```powershell
npm install
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run cf:types
npm run db:migrate:neon
npm run db:seed:neon
npm run dev
```

Frontend: `http://localhost:5173`

Worker API: `http://localhost:8787`

Set `VITE_DEMO_MODE=true` for UI-only review. Demo actions do not call external providers.

## Required secrets

```text
DATABASE_URL
PARALLEL_API_KEY
TINYFISH_API_KEY
APOLLO_API_KEY
BOUNCER_API_KEY
AGENTMAIL_API_KEY
AGENTMAIL_WEBHOOK_SECRET
UNSUBSCRIBE_SECRET
```

Optional: `PDL_API_KEY`, `AUTOSEND_API_KEY`, `AUTOSEND_WEBHOOK_SECRET`, `CALENDLY_WEBHOOK_SECRET`.

Set production values with `wrangler secret put`; never commit credentials. The production Worker uses Hyperdrive for database traffic and also retains `DATABASE_URL` as the required secret/fallback.

## Webhooks

```text
POST /webhooks/agentmail
POST /webhooks/agentmail/events
POST /webhooks/autosend
POST /webhooks/calendly
GET|POST /unsubscribe?lead=<uuid>&token=<hmac>
```

Webhook bodies are bounded, signatures and timestamp freshness are checked, raw payloads are retained in R2, provider IDs are deduplicated, and terminal events stop active sequences transactionally.

## MCP and optional search tools

The root [`.mcp.json`](.mcp.json) configures Pipedream Abstract and Bouncer for optional operator-side email checks, plus Meilisearch and OpenSearch administration tools. These are separate, interactive tools; they do not replace Neon and cannot override the production Bouncer REST call or employer-domain validation.

The dashboard also contains an Access-protected MCP Control Agent for explicitly approved general tool execution. See [`docs/MCP-CONTROL-AGENT.md`](docs/MCP-CONTROL-AGENT.md).

Maigret is pinned in [`integrations/maigret/manifest.json`](integrations/maigret/manifest.json) but disabled. It is not an email validator. Its personal/social enumeration, CAPTCHA, Tor, proxy, and recursive modes are prohibited for this OS and it cannot affect qualification or outreach.

## Commands

```powershell
npm run cf:types
npm run typecheck
npm test
npm run build:web
npm run build
npm run db:migrate:neon
npm run db:seed:neon
npm run deploy
```

## Production activation gates

Do not change `OUTREACH_MODE` until all are verified:

- Benjamin’s current RIA/IAR status and supervisory requirements.
- Approved source, claims, retention, cold-outreach, consent, and newsletter policies.
- Adviser disclosure and valid physical postal address.
- SPF, DKIM, DMARC, verified sender identity, and working one-click unsubscribe.
- Signed sandbox tests for AgentMail/AutoSend/Calendly webhooks.
- Reply, booking, unsubscribe, hard-bounce, complaint, rejection, and suppression stop tests.
- Imported global suppressions and confirmed newsletter-consent workflow.
- Cloudflare Access on every operational route.
- Search, enrichment, validation, mailbox, domain, hourly, and daily caps.
- Required provider secrets, especially Parallel and Bouncer.

This software implements technical controls. It is not legal, tax, investment, or regulatory advice.
