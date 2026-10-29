-- A process is several recordings, one per role, in handoff order. The merge result
-- (Process JSON, see worklens_worker/models.py) is stored whole in process_json; each
-- recording stays a runs row and keeps its own run_json.
create table public.processes (
  id text primary key,
  name text not null,
  status text not null default 'created' check (status in ('created','building','built','failed')),
  process_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger processes_touch before update on public.processes for each row execute function public.touch_updated_at();
alter table public.processes enable row level security;   -- service role only

alter table public.runs
  add column process_id text references public.processes(id) on delete set null,
  add column role text,                     -- who recorded it, as typed at upload: 'AP clerk', 'Approver'
  add column position integer not null default 0;   -- order inside the process (handoff order)
create index runs_process_idx on public.runs (process_id, position);
