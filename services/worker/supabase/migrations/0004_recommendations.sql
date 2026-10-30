-- Recommendations (fix the process + apply AI) are stored whole, with their statuses and decisions,
-- next to the run or process they belong to. See worklens_worker/models.py: Recommendations.
alter table public.runs add column recommendations_json jsonb;
alter table public.processes add column recommendations_json jsonb;
