# QA and Release Checklist

## Automated

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:web`
- [ ] `npm run build` completes the Worker dry run
- [ ] Local and remote D1 migrations apply cleanly
- [ ] `wrangler types` matches all bindings

## Lead intelligence

- [ ] CSV import accepts quoted values and rejects malformed lead records
- [ ] Duplicate email import does not create a second lead
- [ ] Enrichment failure retries without losing the original lead
- [ ] Validation status maps correctly and invalid email cannot send
- [ ] No age, asset, or retirement-date inference appears in lead scoring

## Crawling

- [ ] Parallel and TinyFish Search results are merged, URL-normalized, and deduplicated
- [ ] Non-registry discoveries create unapproved candidates only
- [ ] Nevada search rotation covers every official county district and is deterministic per seed/day
- [ ] Texas TRS, Rule of 80/85, DROP, and non-retirement noise are excluded
- [ ] All person-level signals remain `pending_human_review` and `outreach_eligible = 0`
- [ ] Rejected sources cannot crawl
- [ ] `robots.txt` disallow prevents fetch
- [ ] Native, TinyFish, and Parallel content limits reject oversized responses
- [ ] Same source content does not duplicate a signal
- [ ] Evidence archive includes URL, retrieval timestamp, run ID, and hash

## Outreach safety

- [ ] Prohibited guarantees and promissory claims block campaign submission
- [ ] Missing disclosure, postal address, or unsubscribe token blocks submission
- [ ] Changed campaign content requires a new approval/version
- [ ] Duplicate enrollment and queue events do not duplicate messages
- [ ] `OUTREACH_MODE=disabled` captures but never sends a message
- [ ] Newsletter send without consent fails
- [ ] Marketing SMS without consent fails
- [ ] Reply, booking, unsubscribe, complaint, and bounce stop active sequences

## Provider integration

- [ ] AgentMail key authenticates and the configured inbox ID exists
- [ ] AgentMail send uses the approved message version, Reply-To, disclosure, postal address, and one-click unsubscribe headers
- [ ] Invalid AgentMail Svix signatures return 401
- [ ] Replies stop active sequences; bounces, complaints, and rejections add suppressions
- [ ] Duplicate AgentMail lifecycle events do not duplicate the event ledger
- [ ] Apollo health authentication succeeds without exposing the API key
- [ ] Apollo enrichment requests keep personal email and phone reveal disabled
- [ ] Consumer or employer-domain-mismatched emails are rejected
- [ ] Enriched leads remain in human-review status before outreach
- [ ] SendGrid event signature passes valid payload and rejects tampering
- [ ] Twilio signature passes valid payload and rejects tampering
- [ ] Calendly signature passes valid payload and rejects tampering
- [ ] Inbound email token is rotated and not present in logs
- [ ] Provider timeouts and 429/5xx responses enter retry flow
- [ ] Exhausted jobs appear in the dead-letter review activity

## User experience

- [ ] Dashboard, tables, drawers, and modals work at 320px, 768px, and desktop widths
- [ ] Keyboard navigation reaches sidebar, filters, tables, and modal controls
- [ ] Focus remains visible and modal closing is predictable
- [ ] No broken links or console errors
- [ ] Empty, loading, error, and demo states are understandable
- [ ] Headline analytics exclude unreliable email-open metrics

## Writer policy

- [ ] Subject lines are transparent and no more than seven words
- [ ] Drafts include first name and one reviewed professional personalization detail
- [ ] Drafts use two or three short paragraphs and one clear CTA
- [ ] Sensitive, private, or inferred personalization is rejected
- [ ] Writer output cannot bypass campaign preflight or human approval
