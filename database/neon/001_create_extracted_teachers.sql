BEGIN;

CREATE TABLE IF NOT EXISTS public.extracted_teachers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name text,
  last_name text,
  full_name text NOT NULL,
  email text,
  phone text,
  linkedin_url text,
  school_name text,
  school_district text,
  job_title text,
  current_activity text,
  source_url text,
  source_type text,
  source_published_at timestamptz,
  source_discovered_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'pending_human_review',
  outreach_eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extracted_teachers_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT extracted_teachers_verification_status_check CHECK (
    verification_status IN ('pending_human_review', 'verified', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS extracted_teachers_name_sort_idx
  ON public.extracted_teachers (
    lower(last_name) NULLS LAST,
    lower(first_name) NULLS LAST,
    lower(full_name)
  );

CREATE INDEX IF NOT EXISTS extracted_teachers_school_district_idx
  ON public.extracted_teachers (lower(school_district));

CREATE INDEX IF NOT EXISTS extracted_teachers_current_activity_idx
  ON public.extracted_teachers (lower(current_activity));

CREATE UNIQUE INDEX IF NOT EXISTS extracted_teachers_email_uidx
  ON public.extracted_teachers (lower(email))
  WHERE email IS NOT NULL AND btrim(email) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS extracted_teachers_linkedin_uidx
  ON public.extracted_teachers (lower(linkedin_url))
  WHERE linkedin_url IS NOT NULL AND btrim(linkedin_url) <> '';

CREATE OR REPLACE VIEW public.extracted_teachers_sorted AS
SELECT
  id,
  first_name,
  last_name,
  full_name,
  email,
  phone,
  linkedin_url,
  school_name,
  school_district,
  job_title,
  current_activity,
  source_url,
  source_type,
  source_published_at,
  source_discovered_at,
  verification_status,
  outreach_eligible,
  created_at,
  updated_at
FROM public.extracted_teachers
ORDER BY
  lower(last_name) NULLS LAST,
  lower(first_name) NULLS LAST,
  lower(full_name);

COMMENT ON TABLE public.extracted_teachers IS
  'Public professional Nevada educator records extracted from approved sources; human review is required before outreach.';

COMMENT ON VIEW public.extracted_teachers_sorted IS
  'Extracted teacher records sorted by last name, first name, and full name.';

COMMIT;
