-- Applied to the live project on 2026-10-29. One row per uploaded recording; the pipeline
-- result (Run JSON) is stored whole in run_json; frames live in the "runs" bucket under <id>/frames/.
create table public.runs (
  id text primary key,
  source text not null,
  size_bytes bigint not null default 0,
  status text not null default 'uploaded'
    check (status in ('uploaded','queued','sampling','detecting','labelling','building','built','failed')),
  progress jsonb not null default '{}'::jsonb,   -- {frames, kept, boundaries, steps, labelled, calls, frames_available, log}
  error text,
  run_json jsonb,
  cost_usd numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index runs_created_at_idx on public.runs (created_at desc);
alter table public.runs enable row level security;   -- service role only

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger runs_touch before update on public.runs for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 524288000, array['video/mp4','video/quicktime','video/webm']),
       ('runs', 'runs', false, 52428800, null);
