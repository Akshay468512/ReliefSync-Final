ALTER TABLE public.emergency_requests
ADD COLUMN IF NOT EXISTS triage_summary TEXT;
