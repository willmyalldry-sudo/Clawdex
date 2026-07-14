BEGIN;

UPDATE public.sequence_steps ss
SET
  subject_template = v.subject_template,
  body_template = v.body_template,
  updated_at = now()
FROM (
  SELECT s.id AS sequence_id, x.step_number, x.subject_template, x.body_template
  FROM public.sequences s
  CROSS JOIN (VALUES
    (1, 'Quick Nevada PERS checklist', 'Hi {{first_name}},

{{signal_sentence}} That got me thinking you might want something simple on hand before making any moves with a 403(b), 401(k), 457(b), or IRA.

I put together a short Nevada PERS checklist that covers the basics. Want me to send it over?

{{signature}}
{{disclosure}}
{{postal_address}}
{{unsubscribe_url}}'),
    (2, 'One-page retirement checklist', 'Hi {{first_name}},

Quick follow-up. A few things worth double-checking: your service credit, any supplemental accounts you''re holding, your beneficiary picks, and when health coverage actually kicks in. {{signal_context}}

Want the one-page version of this?

{{signature}}
{{disclosure}}
{{postal_address}}
{{unsubscribe_url}}'),
    (3, 'Lining up your PERS decisions', 'Hi {{first_name}},

Nevada PERS rarely works on its own. It usually needs to line up with any supplemental accounts you have and when you actually want income to start. {{signal_context}}

Would a short worksheet help you sort that out?

{{signature}}
{{disclosure}}
{{postal_address}}
{{unsubscribe_url}}'),
    (4, 'Last note from me', 'Hi {{first_name}},

This is my last note on this. If the resource about {{signal_context_lower}} still sounds useful, I''m happy to send it over.

Want a copy?

{{signature}}
{{disclosure}}
{{postal_address}}
{{unsubscribe_url}}')
  ) AS x(step_number, subject_template, body_template)
  WHERE s.name = 'Seven-Day Signal Sequence'
) v
WHERE ss.sequence_id = v.sequence_id AND ss.step_number = v.step_number;

COMMIT;
