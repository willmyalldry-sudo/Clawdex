BEGIN;

INSERT INTO public.signal_queries (query_text, category, priority, cooldown_minutes) VALUES
  ('site:k12.nv.us retirement application OR retirement effective Nevada educator', 'retirement_application', 'A', 60),
  ('Nevada school district board approved retirement personnel agenda', 'board_retirement', 'A', 60),
  ('Nevada educator "Ready to Retire" workshop PERS', 'retirement_event', 'A', 60),
  ('Nevada school district retirement workshop PERS', 'district_workshop', 'A', 60),
  ('Nevada teacher public retirement announcement school district', 'retirement_announcement', 'A', 60),
  ('site:nvpers.org deadline update benefit contribution Nevada PERS', 'pers_update', 'A', 60),
  ('Nevada school district reduction in force early retirement incentive', 'workforce_change', 'A', 60),
  ('Nevada school district personnel agenda retirement minutes', 'board_records', 'B', 240),
  ('Nevada school district benefits retirement communication employees', 'benefits', 'B', 240),
  ('Nevada PERS service credit purchase educator', 'service_credit', 'B', 240),
  ('Nevada educator pre-retirement workshop retiree health Medicare', 'pre_retirement', 'B', 240),
  ('Nevada public educator 403b 401k 457b IRA transition education', 'supplemental_plans', 'B', 240),
  ('Nevada school district retirement resources employees', 'retirement_resources', 'C', 720),
  ('Nevada school district service awards 25 years 30 years teacher', 'service_milestone', 'C', 720),
  ('Nevada school district staff newsletter retirement PERS', 'staff_newsletter', 'C', 1440),
  ('Nevada public education budget legislation retirement PERS', 'legislation_budget', 'C', 1440)
ON CONFLICT (query_text) DO UPDATE SET
  category = EXCLUDED.category,
  priority = EXCLUDED.priority,
  cooldown_minutes = EXCLUDED.cooldown_minutes,
  is_active = true,
  updated_at = now();

INSERT INTO public.system_config (key, value) VALUES
  ('rule_version', '"signal-os-v2"'::jsonb),
  ('allowed_target_roles', '["teacher","senior teacher","lead teacher","classroom teacher","special education teacher","instructional coach","counselor","librarian","faculty","professor","instructor"]'::jsonb),
  ('blocked_role_terms', '["student","parent","vendor","volunteer","principal","superintendent","administrator","executive"]'::jsonb),
  ('terminal_events', '["reply","positive_reply","negative_reply","booking","unsubscribe","complaint","hard_bounce","invalid_email","rejected","spam_report","manual_global_suppression","provider_suppression"]'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.campaigns (
  name, campaign_type, target_role_scope, provider_mode, status,
  from_name, from_email, reply_to_email, adviser_disclosure, postal_address
) VALUES (
  'Nevada Educator Signal Outreach',
  'signal_sequence',
  ARRAY['teacher','senior teacher','lead teacher','classroom teacher','special education teacher','instructional coach','counselor','librarian','faculty','professor','instructor'],
  'agentmail_only',
  'active',
  'Benjamin Persyn | Appreciation Financial',
  'nevadaeducators@agentmail.to',
  'services@afinancialpartner.com',
  'Educational information only. This communication is not individualized investment, tax, or legal advice.',
  '2485 Village View Dr #190, Henderson, NV 89074'
) ON CONFLICT (name) DO UPDATE SET updated_at = now();

INSERT INTO public.sequences (campaign_id, name, duration_days, status)
SELECT id, 'Seven-Day Signal Sequence', 7, 'active'
FROM public.campaigns WHERE name = 'Nevada Educator Signal Outreach'
ON CONFLICT (campaign_id, name) DO UPDATE SET status = 'active', updated_at = now();

INSERT INTO public.sequence_steps (sequence_id, step_number, delay_hours, message_goal, subject_template, body_template)
SELECT s.id, step_number, delay_hours, message_goal, subject_template, body_template
FROM public.sequences s
CROSS JOIN (VALUES
  (1, 0, 'Signal-based introduction', 'A Nevada PERS resource', 'Hi {{first_name}},\n\n{{signal_sentence}} I put together a short Nevada PERS readiness checklist that may be useful alongside any 403(b), 401(k), 457(b), or IRA decisions.\n\nWould you like me to send it?\n\n{{signature}}\n{{disclosure}}\n{{postal_address}}\n{{unsubscribe_url}}'),
  (2, 48, 'Practical value follow-up', 'Retirement questions checklist', 'Hi {{first_name}},\n\nFollowing up with a practical checklist: confirm service credit, list supplemental accounts, review beneficiary choices, and note health-coverage timing. {{signal_context}}\n\nWould the one-page version be useful?\n\n{{signature}}\n{{disclosure}}\n{{postal_address}}\n{{unsubscribe_url}}'),
  (3, 96, 'Coordination follow-up', 'Coordinating Nevada PERS decisions', 'Hi {{first_name}},\n\nNevada PERS decisions often need to be reviewed alongside supplemental retirement accounts and income timing. {{signal_context}}\n\nWould a short coordination worksheet help?\n\n{{signature}}\n{{disclosure}}\n{{postal_address}}\n{{unsubscribe_url}}'),
  (4, 144, 'Close the loop', 'Closing the loop', 'Hi {{first_name}},\n\nI will close the loop after this note. If the resource connected to {{signal_context_lower}} would help, I am happy to send it.\n\nWould you like a copy?\n\n{{signature}}\n{{disclosure}}\n{{postal_address}}\n{{unsubscribe_url}}')
) AS steps(step_number, delay_hours, message_goal, subject_template, body_template)
WHERE s.name = 'Seven-Day Signal Sequence'
ON CONFLICT (sequence_id, step_number) DO UPDATE SET
  delay_hours = EXCLUDED.delay_hours,
  message_goal = EXCLUDED.message_goal,
  subject_template = EXCLUDED.subject_template,
  body_template = EXCLUDED.body_template,
  is_active = true,
  updated_at = now();

COMMIT;
