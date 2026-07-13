# Benjamin Persyn Agent OS

A compliance-first lead intelligence and outreach operating system for a Nevada financial advisor serving educators with retirement-readiness education around Nevada PERS, 403(b), 401(k), and IRA transitions.

The application is deliberately safe by default:

- External sending is disabled until `OUTREACH_MODE=enabled`.
- Discovered web sources require human approval before crawling.
- The crawler honors `robots.txt`, size limits, timeouts, and an explicit source registry.
- Parallel Search and TinyFish Search discover public candidates concurrently; approved sources use Parallel Extract, TinyFish Fetch, or bounded native fetching.
- The Nevada retirement profile rotates 219 district and statewide searches and runs 16 specialized signal detectors without inferring personal contact data.
- Every campaign version passes deterministic preflight and requires a recorded human decision.
- Newsletter email requires newsletter consent; marketing SMS requires active SMS consent.
- Replies, bookings, bounces, complaints, invalid addresses, and opt-outs stop sequences.
- Demo mode cannot contact real recipients.

## Stack

- React 19 + Vite frontend
- Hono API on Cloudflare Workers
- Cloudflare D1, R2, Queues, Workflows, Cron Triggers, Static Assets, and Access
- Replaceable adapters for Parallel, TinyFish, People Data Labs, ZeroBounce, SendGrid, Twilio, and Calendly
- Zod schemas shared across API and workflow boundaries

## Local setup

Requirements: Node.js 22+, npm 10+, and a Cloudflare account for remote resources.

```powershell
npm install
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run cf:types
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:8787`.

For a UI-only review, create `.env.local` at the repository root with:

```text
VITE_DEMO_MODE=true
```

All demo addresses use `.invalid`, and demo actions do not mutate external systems.

## Parallel and TinyFish

Source Scout merges and deduplicates Parallel Search and TinyFish Search results. Approved sources use Parallel Extract first, then TinyFish Fetch and bounded native HTTP as fallbacks. Every discovered URL is unapproved until reviewed unless it is one of the official sources installed by the Nevada retirement migration.

Parallel tasks are restricted to public professional evidence. The OS does not request or retain home addresses, personal phone numbers, private/member-only content, guessed email addresses, or anonymous-user identity. Employer-published work contact information remains human-review-only and never makes a lead outreach-eligible by itself.

Local secret:

```text
# apps/worker/.dev.vars
TINYFISH_API_KEY=your-key
PARALLEL_API_KEY=your-rotated-key
APOLLO_API_KEY=your-key
AGENTMAIL_API_KEY=your-key
AGENTMAIL_WEBHOOK_SECRET=whsec_your-webhook-secret
AUTOSEND_API_KEY=your-optional-project-key
UNSUBSCRIBE_SECRET=generate-a-long-random-secret
```

Production secret:

```powershell
npx wrangler secret put TINYFISH_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put PARALLEL_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put APOLLO_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put AGENTMAIL_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put AGENTMAIL_WEBHOOK_SECRET --config apps/worker/wrangler.jsonc
npx wrangler secret put AUTOSEND_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put UNSUBSCRIBE_SECRET --config apps/worker/wrangler.jsonc
```

Do not commit `.dev.vars`, `.env`, API keys, webhook secrets, or provider credentials.

## Apollo enrichment

The Worker calls Apollo's People Enrichment API directly with `APOLLO_API_KEY`; it does not use Apollo MCP, ChatGPT connectors, or OAuth. Apollo is the primary enrichment provider and People Data Labs is an optional fallback.

The request explicitly disables personal-email and phone reveal. The OS only retains job title, organization, LinkedIn URL, and a work email whose domain matches the lead's verified employer domain. Every enrichment result remains in `review` status and requires a human decision before outreach. Apollo enrichment can consume Apollo credits, so enqueue enrichment only for qualified lead candidates.

## AgentMail and Writer

Approved email is routed through `nevadaeducators@agentmail.to`, displayed as `Benjamin Persyn | Appreciation Financial`, with replies directed to `services@afinancialpartner.com`. `OUTREACH_MODE` remains disabled until production review. AgentMail webhook events update delivery analytics, route human replies, and suppress bounced, rejected, or complained recipients. Webhooks require the `AGENTMAIL_WEBHOOK_SECRET` Svix signing secret.

AgentMail mailbox-client fallback uses implicit TLS SMTP at `smtp.agentmail.to:465` and TLS IMAP at `imap.agentmail.to:993`; the inbox address is the username and `AGENTMAIL_API_KEY` is the password. The Worker itself continues to use the AgentMail API plus signed webhooks because they provide full inbox management and real-time event processing.

AutoSend project `Teachers Retirement` (`69f221ce39db849a50f16a8b`) is the Benjamin-specific optional provider. Its configured profiles are `Benjamin Persyn <benjamin@afinancial.org>` and `Benjamin Persyn <benjamin@aureviaretirement.com>`, both replying to `services@afinancialpartner.com`. Project `johnita/brian` remains registered as inactive backup metadata with `Brian Persyn <educators@403bclarity.org>` and `Brian Persyn <notification@teachersretirement.info>`.

Benjamin's AgentMail identity remains the production default. AutoSend is used only when `EMAIL_PROVIDER_MODE` is explicitly changed to `autosend_only` (or `autosend_fallback`) after sender-domain verification, campaign disclosure review, webhook setup, and human approval. AutoSend's remote OAuth MCP endpoint is `https://mcp.autosend.com/`; it is documented for optional Codex use and is not installed as a ChatGPT connector.

The Writer policy is draft-only. It produces casual, direct copy with transparent subjects of seven words or fewer, reviewed professional personalization, two or three short paragraphs, and one CTA. Private or inferred personalization is prohibited. Every version must pass deterministic preflight and human approval before enrollment.

## Cloudflare provisioning

Create the resources, then replace the placeholder D1 ID in `apps/worker/wrangler.jsonc`:

```powershell
npx wrangler login
npx wrangler d1 create agent-os-db
npx wrangler r2 bucket create benjamin-agent-os-evidence
npx wrangler queues create benjamin-agent-jobs
npx wrangler queues create benjamin-agent-jobs-dlq
npm run cf:types
npm run db:migrate:remote
```

Set production secrets with `wrangler secret put`:

- `TINYFISH_API_KEY`
- `PARALLEL_API_KEY`
- `APOLLO_API_KEY`
- `AGENTMAIL_API_KEY`
- `AGENTMAIL_WEBHOOK_SECRET`
- `PDL_API_KEY`
- `ZEROBOUNCE_API_KEY`
- `SENDGRID_API_KEY`
- `SENDGRID_WEBHOOK_PUBLIC_KEY`
- `INBOUND_WEBHOOK_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `CALENDLY_WEBHOOK_SECRET`
- `UNSUBSCRIBE_SECRET`

Update non-secret values in `wrangler.jsonc` before deployment:

- `PUBLIC_APP_URL`
- `POSTAL_ADDRESS`
- `FROM_EMAIL`
- `FROM_NAME`
- `REPLY_TO_EMAIL`
- `ADVISER_DISCLOSURE`

Deploy only after the QA and compliance gates below:

```powershell
npm run build
npm run deploy
```

Protect the custom domain with Cloudflare Access. The API accepts Access headers in production and uses a local development identity only when `AUTH_MODE=development`.

## Provider webhooks

- SendGrid events: `POST /webhooks/sendgrid/events`
- SendGrid inbound parse: `POST /webhooks/sendgrid/inbound?token=<INBOUND_WEBHOOK_TOKEN>`
- Twilio message status: `POST /webhooks/twilio/status`
- Calendly events: `POST /webhooks/calendly`
- One-click unsubscribe: `POST /unsubscribe?lead=<id>&token=<signature>`

Webhook bodies are bounded. SendGrid, Twilio, and Calendly signatures are validated before events are accepted.

## Commands

```powershell
npm run typecheck
npm test
npm run build:web
npm run build
npm run dev
npm run db:migrate:local
npm run db:seed:local
```

## Production gates

Do not set `OUTREACH_MODE=enabled` until all of the following are true:

- Benjamin's current RIA/IAR status and supervisory procedures are confirmed.
- Compliance counsel approves source policy, claims policy, disclosures, retention, and consent text.
- A valid physical postal address replaces the placeholder.
- SPF, DKIM, and DMARC are configured for the sending domain.
- Provider webhook signatures pass against real sandbox events.
- Global suppression lists are imported.
- Calendly URL is updated in the `settings` table.
- Test sends use internal addresses and demonstrate reply, unsubscribe, bounce, and booking stops.
- Cloudflare Access protects every operational route.

This software implements technical controls; it is not legal, tax, or regulatory advice.
