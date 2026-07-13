# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An autonomous, signal-driven lead-intelligence and email-outreach system for a Nevada financial adviser (Benjamin Persyn) targeting public educators around retirement planning (Nevada PERS, 403(b)/401(k)/IRA transitions). It runs hourly via Cloudflare Cron with **no routine human approval step** between search, extraction, enrichment, qualification, and sending. The hard rule enforced in code: no message sends without a current verified public retirement signal + a validated employer-domain work email.

This is a regulated financial-services outreach system. `OUTREACH_MODE=disabled` (in `apps/worker/wrangler.jsonc`) is the master kill switch and must stay disabled until the production activation gates in `README.md` / `docs/QA-CHECKLIST.md` are independently signed off — do not flip it as part of a coding task.

## Commands

```powershell
npm install
npm run cf:types              # regenerate apps/worker/worker-configuration.d.ts from wrangler.jsonc bindings
npm run dev                   # runs dev:web + dev:worker concurrently
npm run dev:web               # vite dev server, http://localhost:5173
npm run dev:worker            # wrangler dev --local, http://localhost:8787
npm run typecheck             # tsc -b across the three project references
npm test                      # vitest run (packages/**/*.test.ts + apps/worker/src/**/*.test.ts only)
npm run test:watch
npm run build                 # typecheck + web build + wrangler deploy --dry-run
npm run build:web
npm run deploy                # build:web + wrangler deploy (real deploy)
npm run db:migrate:neon        # applies database/neon/*.sql to DATABASE_URL (production system of record)
npm run db:seed:neon
npm run db:migrate:local       # wrangler d1 migrations (legacy D1, not the source of truth)
npm run db:seed:local
npm run mcp:catalog:sync       # refresh apps/worker/src/data/mcp-catalog.generated.ts from awesome-mcp-servers
```

Run a single test file: `npx vitest run packages/shared/src/scoring.test.ts --config vitest.config.ts`. Run by name: `npx vitest run -t "pattern"`.

There is no lint script configured; `typecheck` is the correctness gate.

## Two generations of shared logic — don't conflate them

`packages/shared/src` contains **two overlapping models**. Only the second is wired into the running system:

- **Legacy v1 (human-in-the-loop)**: `schemas.ts` (`queueMessageSchema` with kinds `discover-web`/`enrich-lead`/`validate-email`/`send-message`), `scoring.ts`. This described a human-approves-sources-and-campaigns model that has been superseded; the stale `docs/PRD.md` describing it has been removed.
- **Current v2 (autonomous signal OS)**: `signal-os.ts` (`signalJobSchema`, `qualifyTeacher`, `professionalEmailGate`, `deterministicPreflight`) and `compliance.ts` (`checkCampaignCompliance`). `README.md` and `docs/ARCHITECTURE.md` describe this model, and `apps/worker/src/index.ts` dispatches on `signalJobSchema` from this file.

When changing qualification gates, email-hygiene rules, or message-preflight rules, edit `signal-os.ts` / `compliance.ts` — these are pure, unit-tested functions and the actual enforcement points for "never send without a verified signal."

## Monorepo layout

npm workspaces: `apps/web` (React 19 + Vite dashboard), `apps/worker` (Hono on Cloudflare Workers — the actual system), `packages/shared` (Zod schemas + pure business logic, no I/O). `tsconfig.json` at the root just references the three project tsconfigs; there's no shared runtime code outside `packages/shared`.

## Database: Neon is authoritative, D1 is legacy

`apps/worker/src/lib/neon.ts` is the single Postgres access point. `connectionString()` prefers the `HYPERDRIVE` binding and falls back to `env.DATABASE_URL` for local dev (`databaseConfigured()` checks the same pair). All business state (signals, teacher profiles, qualified leads, sequences, suppressions, audit log) is Neon-only — see `database/neon/002_autonomous_signal_os.sql` for the full table set. The D1 binding (`DB`, migrations in `apps/worker/migrations/`) is legacy/demo-only; don't add new business logic against it. `scripts/neon-sql.mjs` runs `database/neon/*.sql` against `DATABASE_URL` — this is a separate migration system from the D1 `wrangler d1 migrations` one; the `:local` npm scripts hit D1, the `:neon` ones hit Postgres.

## Hourly pipeline and job dispatch

Single entry point: Cloudflare Cron `5 * * * *` → `scheduled()` in `apps/worker/src/index.ts` → `scheduleHourlyRun()` (`lib/autonomous-pipeline.ts`). That function inserts a `search_runs` row keyed uniquely on `scheduled_for` (prevents double-firing), checks hourly/daily provider cost budgets from `provider_usage`, locks a priority-ordered batch of due `signal_queries` with `FOR UPDATE SKIP LOCKED`, and enqueues `search-query` jobs onto the single Cloudflare Queue `benjamin-agent-jobs` (DLQ: `benjamin-agent-jobs-dlq`).

All queue messages are one `signalJobSchema` discriminated union (`packages/shared/src/signal-os.ts`), routed in the `queue()` handler by `kind`:
- `search-query` / `crawl-source` / `resolve-teachers` → `processSignalJob` (`lib/autonomous-pipeline.ts`)
- `enrich-teacher` / `validate-email` / `qualify-lead` / `enroll-lead` → `processLeadPipelineJob` (`lib/lead-pipeline.ts`)
- everything else (`send-message`) → `processSendJob` (`lib/message-delivery.ts`)

Every job is idempotent: `claimJob()` inserts/checks a `pipeline_jobs` row keyed on `idempotencyKey` inside a transaction before doing work, so retried or duplicate-delivered queue messages are safe. Throwing `PermanentJobError` (or a `SyntaxError`) acks the message without retrying (goes to `blocked`); anything else triggers exponential backoff retry, capped at 12 hours, then DLQ.

The 7-day (Day 1/3/5/7) send sequence runs as a Cloudflare Workflow (`OutreachSequenceWorkflow`, `apps/worker/src/workflows/outreach-sequence.ts`) for durable multi-day scheduling rather than the queue.

## Auth model

Two independent gates, both bypassed only when `AUTH_MODE=development`:
- Hono routes under `/api/*` use the `requireAccessUser` middleware (`lib/auth.ts`).
- `/agents/*` (Durable Object / Agents SDK routes) are checked inline in the `fetch()` handler in `index.ts` before `routeAgentRequest()` runs (except OAuth callback requests, which are allowed through unauthenticated so the OAuth flow can complete).

Both gates call the same `verifyAccessJwt()` in `lib/auth.ts`, which cryptographically verifies the `cf-access-jwt-assertion` JWT against the team's JWKS (`jose`'s `createRemoteJWKSet`/`jwtVerify`, checking `iss`/`aud`) rather than just trusting header presence. It requires two non-secret `wrangler.jsonc` vars, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` (the Access application's Application Audience tag) — if either is unset, verification **fails closed** (401 on every `/api/*`/`/agents/*` request), it does not fall back to trusting headers.

Public, unauthenticated routes: `/api/health`, `/webhooks/*`, `/unsubscribe`, `/book`, `/crawler-policy`, static assets.

## MCP Control Agent (separate subsystem)

A second, mostly-independent feature living alongside the signal pipeline: a Durable Object (`McpControlAgent`, `apps/worker/src/agents/mcp-control-agent.ts`) plus Workers AI that lets an operator register approved remote MCP servers and run Access-gated, plan-then-approve-then-execute tool calls. It is not part of the signal/outreach pipeline and does not affect qualification or sending. See `docs/MCP-CONTROL-AGENT.md` for the safety model (30-minute plan expiry, 3-server/6-step run limits, GitHub/npm URLs rejected as connection endpoints). Catalog data is generated into `apps/worker/src/data/mcp-catalog.generated.ts` by `npm run mcp:catalog:sync` — don't hand-edit it.

## Source/provider layer

- `lib/source-policy.ts`: automatic robots.txt + domain-class allow/reject decision for every discovered URL (no human source-approval queue in the current model).
- `lib/parallel.ts`: Parallel Search/Extract integration.
- `lib/nevada-retirement-intelligence.ts`: Nevada-specific signal detection, district list, and query-plan/priority logic (Priority A/B/C rotation cadence referenced in `README.md`).
- `lib/providers.ts`: the other external provider integrations (Apollo, Bouncer, AgentMail/AutoSend, PDL, TinyFish).
- Evidence (crawled content, webhook payloads) is archived to R2 (`EVIDENCE` binding), keyed and hashed for dedupe — never re-derive evidence text from a live re-fetch when a stored excerpt/hash exists.
- Production email validation is **Bouncer** (`api.usebouncer.com/v1.1/email/verify`, secret `BOUNCER_API_KEY`), called directly via REST from `validateEmail()` in `lib/lead-pipeline.ts` (v2 path) and `validateLeadEmail()` in `lib/providers.ts` (legacy v1 path). This replaced ZeroBounce. The `pipedream-abstract-email-validation` / `pipedream-bouncer-email-validation` entries in `.mcp.json` are a separate, interactive operator-side tool for ad-hoc checks — they do not run and cannot override the production validation calls.

## Local secrets

`apps/worker/.dev.vars` (copy from `.dev.vars.example`) holds local-dev provider keys for `wrangler dev`. Real working credentials for this project are also kept in root-level files (`env.txt`, `agentmail_api_key_*.txt`) — these are `.gitignore`d and confirmed not tracked in git; don't read them into other files or commit anything matching `*_api_key*.txt`, `env.txt`, `.env*`, or `.dev.vars`.

## Testing

Vitest, config at root `vitest.config.ts`, tests colocated as `*.test.ts` next to source. Only `packages/**/*.test.ts` and `apps/worker/src/**/*.test.ts` are picked up — `apps/web` has no test coverage. Prefer adding tests for gating logic in `packages/shared/src` (pure functions, easiest to test exhaustively) over integration-style tests against the worker routes.
