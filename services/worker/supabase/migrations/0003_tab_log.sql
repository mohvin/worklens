-- The browser extension logs every tab switch during a recording: [{t: seconds from start, host, title, reason}].
-- Stored with the run so the pipeline can tie steps to applications without asking the model.
alter table public.runs add column tab_log jsonb;
