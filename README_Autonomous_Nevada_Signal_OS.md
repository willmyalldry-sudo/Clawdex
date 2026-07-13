# Benjamin Persyn Nevada Educator Signal OS

An autonomous, signal-driven lead intelligence and email outreach operating system for a Nevada financial advisor serving public educators with retirement-readiness education around Nevada PERS, 403(b), 401(k), IRA transitions, retirement income, and related planning decisions.

The operating model is fully automated after one-time production configuration. There is no routine human approval step between search, extraction, enrichment, validation, qualification, personalization, sequence enrollment, and delivery.

## Core operating rule

Every outreach email must be tied to a verified public retirement signal collected by the system.

The OS must never send generic retirement outreach to a teacher merely because the person appears in a staff directory. A candidate becomes outreach-eligible only when:

1. A Nevada retirement-related signal is found.
2. The signal is connected to a public Nevada education employer, school, district, event, policy, board record, benefits communication, or educator.
3. The person is verified as a target educator or eligible public-school employee.
4. A professional work email is found through a public employer source or approved enrichment provider.
5. The work email passes validation and employer-domain matching.
6. The lead passes qualification, suppression, duplication, recency, and compliance checks.
7. The personalized message accurately references the gathered signal without inventing facts.

## Safety and compliance defaults

- Public professional information only.
- Respect `robots.txt`, access controls, rate limits, response-size limits, and timeouts.
- Never access private groups, member-only portals, authenticated pages, or restricted profiles.
- Never collect home addresses, personal phone numbers, personal email addresses, sensitive personal information, or anonymous-user identities.
- Never guess or generate email addresses from naming patterns.
- Never use a public retirement signal as proof of a person’s private finances, age, health, or exact retirement decision.
- Employer-published work information may be retained only when it is relevant to the educator’s professional role.
- Every message includes sender identity, required adviser disclosure, physical postal address, and a working one-click unsubscribe link.
- Replies, bookings, opt-outs, bounces, invalid addresses, rejections, and complaints immediately stop the sequence.
- Newsletter candidates and newsletter subscribers are separate. A qualified cold lead may enter the signal-based outreach sequence, but newsletter distribution requires recorded newsletter consent.
- Demo mode cannot contact real recipients.

---

# Stack

## Application

- React 19 + Vite frontend
- Hono API on Cloudflare Workers
- Cloudflare Cron Triggers for hourly execution
- Cloudflare Queues for search, crawl, extraction, enrichment, validation, writing, and delivery jobs
- Cloudflare Workflows for durable multi-step orchestration
- Cloudflare R2 for evidence snapshots and source artifacts
- Cloudflare Access for dashboard and API protection
- Zod schemas across API, queue, workflow, and database boundaries

## Primary database

**Neon Postgres is the authoritative system of record.**

Cloudflare D1 may be retained only for optional local cache, lightweight control-plane state, or demo data. Lead, signal, enrichment, validation, outreach, sequence, newsletter, suppression, and analytics records must be written to Neon.

Recommended Worker-to-Neon connection:

- `DATABASE_URL` stored as a Cloudflare secret
- Pooled or serverless Postgres connection
- Idempotent inserts and updates
- Database transactions for state transitions
- Unique constraints for signal, person, email, campaign, and event deduplication

## Search, extraction, enrichment, validation, and delivery providers

- Parallel Search
- TinyFish Search
- Parallel Extract
- TinyFish Fetch
- Bounded native HTTP fallback
- Apollo People Enrichment as primary enrichment
- People Data Labs as optional fallback
- Bouncer as primary email validator
- AgentMail as default sending and reply-management provider
- AutoSend as optional sending provider or controlled fallback
- Calendly webhook integration for booking stops

---

# Autonomous hourly workflow

```text
Cloudflare Cron — every hour
        ↓
Create hourly search run
        ↓
Select next Nevada signal-query batch
        ↓
Parallel Search + TinyFish Search
        ↓
Normalize, merge and deduplicate results
        ↓
Automatic source-policy evaluation
        ↓
Crawl allowed public signal references
        ↓
Extract retirement signal and evidence
        ↓
Identify connected Nevada district, school or educator
        ↓
Crawl linked public staff and profile pages
        ↓
Extract target educator professional data
        ↓
Write raw signal and teacher candidates to Neon
        ↓
Resolve duplicates and link signal-to-person evidence
        ↓
Score retirement intent, evidence quality and targeting fit
        ↓
Enrich qualified candidates through Apollo
        ↓
Use People Data Labs only when configured and needed
        ↓
Validate employer domain and professional email
        ↓
Bouncer validation and hygiene checks
        ↓
Apply suppression, duplicate and recency checks
        ↓
Promote clean targeted leads to qualified_leads
        ↓
Generate signal-specific personalized email
        ↓
Run deterministic content and compliance preflight
        ↓
Enroll eligible lead in seven-day email sequence
        ↓
Send through AgentMail or AutoSend
        ↓
Process delivery, reply, booking and unsubscribe events
        ↓
Stop sequence when a terminal event occurs
        ↓
Add qualified lead to newsletter_candidates
        ↓
Promote to newsletter_subscribers only after consent
        ↓
Update analytics and next hourly run
```

---

# Hourly scheduler

The primary Cloudflare Cron expression is:

```text
5 * * * *
```

This starts the workflow at five minutes past every hour.

Each hourly run must:

1. Create a unique `search_run`.
2. Lock a batch of Nevada signal queries.
3. Skip queries successfully executed inside their configured cooldown.
4. Prioritize high-intent and high-recency signal categories.
5. Respect hourly and daily provider budgets.
6. Search through Parallel and TinyFish concurrently.
7. Queue newly discovered sources.
8. Retry transient failures with exponential backoff.
9. Send permanent failures to the dead-letter queue.
10. Record cost, latency, results, errors, and provider usage.

## Query rotation

The Nevada profile contains the district, statewide, board, legislative, event, budget, service-milestone, retirement-announcement, Nevada PERS, and financial-planning searches.

Do not execute all searches blindly every hour. Rotate them based on priority:

### Priority A — every hour

- Retirement applications
- Retirement-effective dates
- Board-approved retirements
- “Ready to Retire” events
- District retirement workshops
- Public retirement announcements
- Nevada PERS deadlines or material changes
- Reduction-in-force and retirement-incentive announcements

### Priority B — every 4 hours

- Personnel agendas and board minutes
- District benefits communications
- Service-credit purchase information
- Pre-retirement workshops
- Retiree health and Medicare transition events
- 403(b), 401(k), 457(b), and IRA transition education

### Priority C — every 12 to 24 hours

- General district retirement resources
- Service-award pages
- Staff newsletters
- General Nevada PERS educational content
- Lower-intent budget or legislative monitoring

The scheduler must use query cooldowns, source hashes, canonical URLs, content hashes, and published dates to prevent duplicate work.

---

# Automatic source-policy decision

There is no routine human source-approval queue.

Every discovered URL is evaluated automatically.

## Auto-allow

A source may be crawled when all conditions pass:

- Publicly accessible without authentication
- Allowed by `robots.txt`
- HTTP or HTTPS
- Domain is an official government, Nevada PERS, school district, school, public college, public university, recognized education association, reputable public news source, or already approved source class
- Response type is supported
- Response size is within limit
- No private, member-only, paywalled, or restricted access
- No signs of sensitive personal-data exposure

## Auto-reject

Reject or quarantine a source when it:

- Requires login or membership
- Blocks automated access
- Disallows crawling
- Contains private group content
- Exposes personal or sensitive information unrelated to professional outreach
- Is an anonymous forum profile that cannot be professionally verified
- Is unrelated to Nevada public education or retirement
- Is a duplicate or mirrored source
- Fails malware, redirect, content-type, or domain checks

Quarantined sources are not crawled and do not block the rest of the autonomous pipeline.

---

# Signal discovery and evidence model

Every signal must create a structured record containing:

```text
signal_id
search_run_id
query_id
signal_category
signal_type
signal_phrase
signal_summary
source_url
canonical_url
source_domain
source_type
source_title
published_at
discovered_at
content_hash
evidence_excerpt
evidence_r2_key
district_name
school_name
person_name
event_name
event_date
effective_date
years_of_service
retirement_system
signal_score
source_reliability_score
evidence_confidence
status
```

## Required evidence rules

A signal is valid only when:

- The evidence is public.
- The source URL is retained.
- The matching text or structured fact is retained.
- The source is connected to Nevada public education, Nevada PERS, a Nevada public employee benefit, or a verified Nevada educator.
- The extraction does not infer a private financial condition.
- The evidence has a timestamp, publication date, event date, or discovery date.
- The source and content hashes support duplicate detection.

---

# Teacher crawl and extraction workflow

After a valid signal reference is found, the OS follows public links connected to the signal, district, school, event, board record, benefits page, or named educator.

The crawler may collect:

- First name
- Last name
- Full professional name
- Public job title
- School
- School district
- Department
- Employer website
- Public staff profile URL
- Public LinkedIn URL when professionally attributable
- Employer-published work email
- Employer-published work telephone number only when operationally required and separately permitted
- Source URLs
- Signal relationship
- Employment evidence
- Last verified date

## Target role allowlist

Examples include:

- Teacher
- Senior Teacher
- Lead Teacher
- Classroom Teacher
- Special Education Teacher
- Instructional Coach
- Counselor when included in the approved campaign scope
- Librarian when included in the approved campaign scope
- Faculty
- Professor or instructor when public higher-education employees are included
- Other approved educator roles

## Default exclusions

- Students
- Parents
- Private-school employees unless the campaign explicitly supports them
- Vendors
- Volunteers
- Anonymous users
- Unverified former employees
- People with no reliable connection to the signal
- Principals, superintendents, executives, and administrators unless explicitly enabled as target roles
- Personal email addresses
- Guessed contact information

---

# Neon database tables

## 1. `signal_queries`

Stores the Nevada search library and rotation rules.

```text
id
query_text
category
priority
state
district_id
provider_scope
cooldown_minutes
is_active
last_run_at
next_run_at
created_at
updated_at
```

## 2. `search_runs`

Stores every hourly execution.

```text
id
started_at
completed_at
status
queries_selected
queries_completed
results_found
sources_queued
signals_created
provider_cost
error_count
metadata
```

## 3. `signal_sources`

Stores normalized public URLs.

```text
id
canonical_url
domain
source_type
policy_status
robots_status
http_status
content_type
content_hash
first_seen_at
last_seen_at
last_crawled_at
crawl_status
r2_key
```

## 4. `signal_events`

Stores extracted retirement and financial-planning signals.

```text
id
search_run_id
source_id
signal_category
signal_type
signal_summary
evidence_excerpt
published_at
event_date
effective_date
district_name
school_name
person_name
years_of_service
signal_score
source_reliability_score
evidence_confidence
dedupe_key
status
created_at
updated_at
```

## 5. `teacher_candidates`

Stores raw teacher records linked to signals.

```text
id
signal_event_id
first_name
last_name
full_name
job_title
department
school_name
school_district
employer_domain
staff_profile_url
linkedin_url
public_work_email
source_url
employment_confidence
signal_relationship
status
first_seen_at
last_verified_at
```

## 6. `teacher_profiles`

Stores the resolved canonical person record.

```text
id
first_name
last_name
full_name
current_job_title
current_school
current_district
employer_domain
linkedin_url
primary_source_url
identity_confidence
employment_status
created_at
updated_at
```

## 7. `teacher_signal_links`

Supports multiple signals per educator.

```text
id
teacher_profile_id
signal_event_id
relationship_type
confidence
is_primary
created_at
```

## 8. `enrichment_jobs`

```text
id
teacher_profile_id
provider
status
attempt_count
queued_at
started_at
completed_at
error_code
provider_cost
```

## 9. `enrichment_results`

```text
id
teacher_profile_id
provider
job_title
organization
employer_domain
linkedin_url
professional_email
match_confidence
raw_result_r2_key
created_at
```

## 10. `email_validations`

```text
id
teacher_profile_id
email
domain
provider
validation_status
smtp_status
is_disposable
is_role_address
is_free_provider
is_catch_all
is_employer_domain_match
risk_score
validated_at
expires_at
```

## 11. `qualified_leads`

Contains only clean, targeted and outreach-eligible contacts.

```text
id
teacher_profile_id
primary_signal_event_id
email
first_name
last_name
job_title
school_name
school_district
employer_domain
signal_category
signal_summary
source_url
signal_date
signal_score
qualification_score
email_validation_status
email_validated_at
provider_route
outreach_status
sequence_id
qualified_at
last_contacted_at
```

## 12. `newsletter_candidates`

All qualified contacts may be copied here for newsletter-conversion tracking.

This table is not itself permission to send newsletters.

```text
id
qualified_lead_id
email
first_name
last_name
school_district
primary_signal_category
source_campaign_id
newsletter_consent_status
consent_requested_at
consent_granted_at
consent_source
consent_text_version
suppressed_at
created_at
updated_at
```

## 13. `newsletter_subscribers`

Only contacts with explicit, recorded newsletter consent may enter this table.

```text
id
newsletter_candidate_id
email
first_name
last_name
consent_granted_at
consent_source
consent_text_version
subscription_status
unsubscribe_at
last_newsletter_at
created_at
updated_at
```

## 14. `campaigns`

```text
id
name
campaign_type
state
target_role_scope
signal_category
provider_mode
status
from_name
from_email
reply_to_email
adviser_disclosure
postal_address
created_at
updated_at
```

## 15. `sequences`

```text
id
campaign_id
name
duration_days
status
stop_on_reply
stop_on_booking
stop_on_unsubscribe
stop_on_bounce
created_at
updated_at
```

## 16. `sequence_steps`

```text
id
sequence_id
step_number
delay_hours
message_goal
subject_template
body_template
is_active
created_at
updated_at
```

## 17. `sequence_enrollments`

```text
id
sequence_id
qualified_lead_id
status
current_step
next_send_at
enrolled_at
completed_at
stop_reason
```

## 18. `outbound_messages`

```text
id
enrollment_id
qualified_lead_id
signal_event_id
provider
provider_message_id
step_number
subject
body
source_url
scheduled_at
sent_at
delivery_status
```

## 19. `message_events`

```text
id
outbound_message_id
event_type
provider
provider_event_id
occurred_at
payload_r2_key
```

## 20. `suppressions`

```text
id
email
teacher_profile_id
reason
source
scope
created_at
expires_at
```

## 21. `audit_log`

```text
id
entity_type
entity_id
action
workflow_run_id
rule_version
metadata
created_at
```

---

# Deduplication

The OS must deduplicate at every stage.

## Source dedupe

- Canonical URL
- Domain plus path
- Redirect destination
- Content hash

## Signal dedupe

- Source ID
- Signal type
- Person or district
- Event date or effective date
- Evidence hash

## Person dedupe

- Normalized full name
- Employer
- School or district
- LinkedIn URL
- Staff profile URL
- Verified employer email

## Email dedupe

- Lowercase normalized address
- Existing qualified lead
- Existing sequence enrollment
- Existing subscriber
- Global suppression table

A record update is preferred over a duplicate insert.

---

# Qualification and targeting

A teacher candidate is promoted to `qualified_leads` only when all mandatory gates pass.

## Mandatory gates

- Nevada public-education relationship verified
- Approved target role
- At least one active signal
- Public evidence retained
- Signal is within the configured recency window
- Identity confidence meets threshold
- Employment confidence meets threshold
- Professional work email available
- Email domain matches verified employer domain
- Email validation status is `valid`
- Email is not disposable, free-mail, role-based, invalid, abuse, or suppressed
- No prior active sequence
- No reply, booking, complaint, unsubscribe, or permanent bounce
- Signal-specific personalization fields are complete

## Recommended thresholds

```text
MIN_SIGNAL_SCORE=60
MIN_QUALIFICATION_SCORE=75
MIN_IDENTITY_CONFIDENCE=0.80
MIN_EMPLOYMENT_CONFIDENCE=0.80
MAX_SIGNAL_AGE_DAYS=90
EMAIL_VALIDATION_MAX_AGE_DAYS=30
```

## Qualification score example

```text
Board-approved retirement or exact retirement date       +35
Ready-to-Retire event or direct retirement workshop      +25
30+ years of service                                     +20
Nevada PERS material event                               +15
District HR retirement communication                     +15
Verified educator identity                               +15
Verified current employment                              +15
Employer-domain work email                               +15
Valid email                                              +20
Signal older than 90 days                                -30
Generic district article with no personal connection     -25
Unverified identity                                      -40
Catch-all or risky email                                 -40
Existing suppression                                    Disqualify
```

---

# Enrichment workflow

Apollo is the primary enrichment provider.

The enrichment request must:

- Use the teacher’s verified name, employer, school, district, domain, and public profile.
- Disable personal-email reveal.
- Disable personal-phone reveal.
- Retain only professional employment and work-contact data.
- Require employer-domain matching.
- Store provider confidence and provenance.
- Avoid enrichment when the candidate is below the qualification threshold.
- Avoid repeated enrichment inside the configured freshness period.

People Data Labs may run only when:

- Apollo returns no professional match.
- The lead is still above the enrichment threshold.
- The fallback budget allows the request.
- The same public-professional restrictions are applied.

---

# Email validation and cleaning

Bouncer is the primary validator.

The validation pipeline must:

1. Normalize the email.
2. Confirm basic syntax.
3. Confirm MX availability.
4. Check disposable and free-provider status.
5. Check role-address status.
6. Check abuse, spamtrap, toxic, and do-not-mail indicators when available.
7. Check catch-all status.
8. Confirm employer-domain match.
9. Check global and campaign suppressions.
10. Save the complete validation result.
11. Promote only clean addresses.

## Allowed status

```text
valid
```

## Default rejected statuses

```text
invalid
unknown
spamtrap
abuse
do_not_mail
disposable
free_email
role_address
toxic
```

Catch-all addresses are rejected by default unless a separate campaign policy explicitly permits them.

---

# Signal-specific personalization engine

Every outbound message must be generated from the lead’s primary or approved supporting signal.

The Writer receives:

```text
first_name
job_title
school_name
school_district
signal_category
signal_summary
signal_date
event_name
event_date
source_title
source_url
Nevada PERS topic
approved planning topic
campaign CTA
sender disclosure
postal address
unsubscribe URL
```

## Personalization rules

- Mention only facts supported by the stored signal evidence.
- Do not claim that the teacher is definitely retiring unless the public source explicitly says so.
- Do not mention age, health, family status, private finances, or inferred pension value.
- Do not say “I was tracking you,” “I scraped your information,” or similar surveillance language.
- Frame district-wide signals as district-wide, not personal.
- Frame policy signals as educational updates.
- Use a personal retirement announcement only when it is public and professionally relevant.
- Keep the message casual, direct, respectful, and easy to scan.
- Use one CTA.
- Use a transparent subject of seven words or fewer.
- Use two or three short paragraphs.
- Include disclosure, postal address, and one-click unsubscribe.
- Store `signal_event_id` and `source_url` with each outbound message.

## Signal-to-message examples

### District workshop signal

```text
Signal:
The educator’s district announced a Nevada PERS retirement-planning workshop.

Message angle:
Offer a simple checklist to help district employees prepare questions before or after the workshop.
```

### Nevada PERS change

```text
Signal:
A public Nevada PERS contribution, benefit, deadline, or educational update was published.

Message angle:
Explain that the update may be worth reviewing alongside the educator’s 403(b), 401(k), 457(b), IRA, or retirement-income plan.
```

### Public service milestone

```text
Signal:
A district publicly recognized 25, 30, 33, or more years of service.

Message angle:
Congratulate the educator and offer a retirement-readiness review without stating that retirement is imminent.
```

### Public retirement announcement

```text
Signal:
A district, board document, school page, or educator publicly announced retirement.

Message angle:
Congratulate the educator and offer a transition checklist covering Nevada PERS, supplemental accounts, beneficiary decisions, health coverage, and income coordination.
```

### Budget or reduction-in-force signal

```text
Signal:
A Nevada district announced budget pressure, restructuring, layoffs, position reductions, or an early-retirement incentive.

Message angle:
Provide calm educational guidance about reviewing retirement options before making an employment decision. Never imply the recipient is being laid off.
```

---

# Deterministic email preflight

There is no routine human campaign approval.

Every generated message must pass an automated preflight.

## Required checks

- Qualified lead exists
- Valid signal exists
- Signal evidence is stored
- Signal is not stale
- Source URL is present
- Personalization claims match evidence
- Work email is valid and current
- Lead is not suppressed
- Sequence is active
- Sending window is allowed
- Daily and hourly caps are not exceeded
- Subject is seven words or fewer
- Message has one CTA
- Message has sender identity
- Message has adviser disclosure
- Message has physical postal address
- Message has unsubscribe URL
- Message does not contain prohibited claims
- Message does not contain inferred sensitive data
- Message is not a duplicate of a recently sent message
- Provider route is available

A failed preflight sets the message to `blocked` and records the exact rule failure. It is not sent.

---

# Email provider routing

Use one active provider route per message.

## Recommended modes

```text
EMAIL_PROVIDER_MODE=agentmail_only
EMAIL_PROVIDER_MODE=autosend_only
EMAIL_PROVIDER_MODE=agentmail_with_autosend_fallback
```

## Default

```text
EMAIL_PROVIDER_MODE=agentmail_only
```

## AgentMail identity

- From mailbox: `nevadaeducators@agentmail.to`
- Display name: `Benjamin Persyn | Appreciation Financial`
- Reply-to: `services@afinancialpartner.com`

AgentMail handles:

- Outbound delivery
- Inbox and reply capture
- Delivery events
- Bounce and rejection events
- Complaint events
- Sequence-stop events

## AutoSend

AutoSend is optional.

The Benjamin project may be used only after:

- Sender domain is verified.
- SPF, DKIM, and DMARC pass.
- Sender profile is active.
- Webhook processing is configured.
- Unsubscribe handling is verified.
- The selected sender is permitted by the campaign configuration.

Do not send the same message through both providers. A fallback is allowed only when the primary provider fails before accepting the message.

---

# Seven-day email sequence

The sequence runs for one week and remains tied to the same verified signal.

## Day 1 — Signal-based introduction

Purpose:

- Mention the public signal accurately.
- Explain why it may be relevant.
- Offer one useful retirement-readiness resource or short conversation.

## Day 3 — Practical value follow-up

Purpose:

- Provide a short checklist related to the signal.
- Examples: Nevada PERS questions, service-credit review, supplemental account inventory, beneficiary review, or retirement timeline.

## Day 5 — Coordination follow-up

Purpose:

- Explain how Nevada PERS may need to be reviewed alongside 403(b), 401(k), 457(b), IRA, Social Security, Medicare, health coverage, or beneficiary decisions.
- Mention only topics relevant to the original signal.

## Day 7 — Close-the-loop email

Purpose:

- Politely close the sequence.
- Offer the resource or booking link one last time.
- State that no further sequence emails will be sent.

## Default timing

```text
Step 1: enrollment time
Step 2: 48 hours after Step 1
Step 3: 48 hours after Step 2
Step 4: 48 hours after Step 3
```

## Sending rules

- Use the recipient’s local Nevada time.
- Send only inside the configured weekday window.
- Do not send on configured holidays.
- Enforce provider, domain, campaign, mailbox, and daily volume caps.
- Apply per-domain throttling.
- Never restart a completed or stopped sequence without a new verified signal and cooldown.
- Never send a new sequence to a suppressed lead.

---

# Sequence stop conditions

Stop all remaining sequence steps immediately when any of these occurs:

```text
reply
positive_reply
negative_reply
booking
unsubscribe
complaint
hard_bounce
invalid_email
rejected
spam_report
manual_global_suppression
provider_suppression
```

A reply does not need to be positive to stop the sequence.

The stop transaction must:

1. Update the enrollment.
2. Cancel queued messages.
3. Add suppression when required.
4. Record the reason.
5. Prevent new enrollment unless policy permits it.
6. Update analytics.

---

# Newsletter workflow

All qualified leads may be copied to `newsletter_candidates` for permission tracking and future conversion.

They must not receive recurring newsletters merely because they are qualified leads.

## Newsletter promotion rule

A candidate moves to `newsletter_subscribers` only after the OS records:

- Explicit newsletter consent
- Consent timestamp
- Consent source
- Consent wording or version
- Email address
- Subscription status

Consent may be captured through:

- An explicit opt-in form
- A checked consent box that is not preselected
- A clear email reply requesting subscription
- A Calendly or landing-page form with separate newsletter permission
- Another verifiable consent mechanism approved for the campaign

The unsubscribe endpoint must update both newsletter and outreach suppression status as appropriate.

---

# Provider webhooks

Recommended internal endpoints:

```text
POST /webhooks/agentmail
POST /webhooks/autosend
POST /webhooks/calendly
POST /unsubscribe
```

Webhook processing must:

- Validate provider signatures when supported.
- Enforce body-size limits.
- Reject stale or replayed events.
- Deduplicate provider event IDs.
- Store raw event payloads in R2 when needed.
- Update message status.
- Stop active sequences.
- Apply suppressions.
- Update booking, reply, delivery, bounce, complaint, and unsubscribe analytics.

---

# Environment variables and secrets

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

## Optional secrets

```text
PDL_API_KEY
AUTOSEND_API_KEY
AUTOSEND_WEBHOOK_SECRET
CALENDLY_WEBHOOK_SECRET
```

## Required configuration

```text
OUTREACH_MODE=disabled
EMAIL_PROVIDER_MODE=agentmail_only
PUBLIC_APP_URL=
POSTAL_ADDRESS=
FROM_EMAIL=nevadaeducators@agentmail.to
FROM_NAME=Benjamin Persyn | Appreciation Financial
REPLY_TO_EMAIL=services@afinancialpartner.com
ADVISER_DISCLOSURE=
SEARCH_CRON=5 * * * *
SEARCH_BATCH_SIZE=
MAX_HOURLY_SEARCH_COST=
MAX_DAILY_SEARCH_COST=
MAX_EMAILS_PER_HOUR=
MAX_EMAILS_PER_DAY=
SEND_WINDOW_START=
SEND_WINDOW_END=
SEND_TIMEZONE=America/Los_Angeles
MIN_SIGNAL_SCORE=60
MIN_QUALIFICATION_SCORE=75
MIN_IDENTITY_CONFIDENCE=0.80
MIN_EMPLOYMENT_CONFIDENCE=0.80
MAX_SIGNAL_AGE_DAYS=90
EMAIL_VALIDATION_MAX_AGE_DAYS=30
```

Do not commit `.dev.vars`, `.env`, API keys, database credentials, provider credentials, or webhook secrets.

---

# Local setup

Requirements:

- Node.js 22+
- npm 10+
- Cloudflare account for remote resources
- Neon Postgres database

```powershell
npm install
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run cf:types
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Open:

```text
Frontend: http://localhost:5173
Worker API: http://localhost:8787
```

For UI-only review:

```text
VITE_DEMO_MODE=true
```

All demo addresses must use `.invalid`, and demo actions must not mutate external providers.

---

# Cloudflare and Neon provisioning

## Neon

1. Create the production Neon project.
2. Create the production database and restricted application role.
3. Store `DATABASE_URL` as a Cloudflare secret.
4. Run the Neon migrations.
5. Confirm unique constraints, indexes, foreign keys, and transaction behavior.
6. Enable database backups and retention appropriate to the project.

## Cloudflare

```powershell
npx wrangler login
npx wrangler r2 bucket create benjamin-agent-os-evidence
npx wrangler queues create benjamin-agent-jobs
npx wrangler queues create benjamin-agent-jobs-dlq
npm run cf:types
npm run db:migrate:remote
```

Set secrets:

```powershell
npx wrangler secret put DATABASE_URL --config apps/worker/wrangler.jsonc
npx wrangler secret put PARALLEL_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put TINYFISH_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put APOLLO_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put BOUNCER_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put AGENTMAIL_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put AGENTMAIL_WEBHOOK_SECRET --config apps/worker/wrangler.jsonc
npx wrangler secret put AUTOSEND_API_KEY --config apps/worker/wrangler.jsonc
npx wrangler secret put AUTOSEND_WEBHOOK_SECRET --config apps/worker/wrangler.jsonc
npx wrangler secret put CALENDLY_WEBHOOK_SECRET --config apps/worker/wrangler.jsonc
npx wrangler secret put UNSUBSCRIBE_SECRET --config apps/worker/wrangler.jsonc
```

Protect the dashboard and operational APIs with Cloudflare Access.

---

# Commands

```powershell
npm run typecheck
npm test
npm run build:web
npm run build
npm run dev
npm run db:migrate:local
npm run db:seed:local
npm run db:migrate:remote
npm run deploy
```

---

# Automated tests required

## Search and crawl

- Cron creates one hourly run.
- Query locking prevents duplicate execution.
- Parallel and TinyFish results merge correctly.
- Canonical URL dedupe works.
- `robots.txt` rules are honored.
- Restricted sources are rejected.
- Content limits and timeouts work.
- Retries and dead-letter behavior work.

## Signal extraction

- Each signal stores source evidence.
- Signal categories map correctly.
- Duplicate signals merge.
- Stale signals are blocked.
- District-wide signals are not falsely turned into personal retirement claims.

## Teacher resolution

- Teacher-only role rules work.
- Identity matching avoids merging different people with the same name.
- Employment verification is required.
- Public work data provenance is retained.
- Personal contact data is rejected.

## Enrichment and validation

- Apollo receives only approved professional inputs.
- Personal reveal fields remain disabled.
- Employer-domain matching works.
- Bouncer statuses map correctly.
- Invalid, risky, catch-all, role, free, and suppressed addresses are blocked.
- Validation-expiry rules work.

## Qualification

- Mandatory gates cannot be bypassed.
- Scores are deterministic.
- Qualified leads are inserted once.
- Disqualified leads cannot enter sequences.
- Existing replies, bookings, opt-outs, and suppressions block enrollment.

## Writer and preflight

- Every message references a real signal.
- Unsupported claims fail.
- Missing source URLs fail.
- Sensitive inferences fail.
- Subject-length rule works.
- CTA count rule works.
- Disclosure, postal address, and unsubscribe are required.
- Duplicate-message checks work.

## Sequence

- Day 1, 3, 5, and 7 timing works.
- Local-time sending works.
- Volume and domain throttles work.
- Replies stop the sequence.
- Bookings stop the sequence.
- Unsubscribes stop the sequence.
- Bounces, rejections, and complaints stop the sequence.
- Queued future messages are cancelled.

## Newsletter

- Qualified leads enter `newsletter_candidates`.
- They do not enter `newsletter_subscribers` without consent.
- Consent evidence is required.
- Unsubscribe status prevents future newsletter sends.

## Provider routing

- AgentMail-only mode works.
- AutoSend-only mode works.
- Controlled fallback cannot double-send.
- Provider message and event IDs are deduplicated.
- Invalid webhook signatures are rejected.

---

# Production activation gates

The normal operating workflow has no human approval loop, but production must not be enabled until the one-time system configuration is complete.

Do not set:

```text
OUTREACH_MODE=enabled
```

until all of the following pass:

- Benjamin’s current RIA/IAR status and supervisory requirements are confirmed.
- The source, claims, retention, consent, outreach, and newsletter policies are approved for production.
- A valid physical postal address is configured.
- The adviser disclosure is configured.
- SPF, DKIM, and DMARC pass for the active sending domain.
- AgentMail or AutoSend sender identity is verified.
- Provider webhooks pass signed sandbox tests.
- Neon migrations and constraints pass.
- Global suppression lists are imported.
- Calendly booking-stop logic works.
- One-click unsubscribe works.
- Internal test sequences demonstrate reply, booking, bounce, complaint, rejection, and unsubscribe stops.
- Cloudflare Access protects all operational routes.
- Search, enrichment, validation, and email cost caps are configured.
- Demo mode is disabled in production.

After activation, the pipeline operates autonomously every hour. Failed records are blocked or quarantined automatically; they are never sent merely because a workflow step failed open.

---

# Final operating model

```text
Every hour:
Search Nevada retirement signals
→ crawl public signal references
→ extract linked educator data
→ store and organize records in Neon
→ deduplicate and score
→ enrich professional profiles
→ validate employer work emails
→ clean and qualify targeted leads
→ generate emails from the exact gathered signals
→ pass deterministic preflight
→ enroll qualified leads in a seven-day sequence
→ send through AgentMail or AutoSend
→ stop on reply, booking, opt-out, bounce, rejection or complaint
→ add qualified contacts to newsletter_candidates
→ move only consented contacts to newsletter_subscribers
→ update analytics and repeat
```

This software implements technical controls and operational rules. It is not legal, tax, investment, or regulatory advice.
