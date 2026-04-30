ALTER TABLE public.emergency_requests
ADD COLUMN IF NOT EXISTS ai_summary TEXT;
