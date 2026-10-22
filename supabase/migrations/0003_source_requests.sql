create table source_requests (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  source text not null,
  label text not null,
  status text not null check (status in ('ok','failed','skipped')),
  http_status int,
  duration_ms int not null default 0,
  items_returned int not null default 0,
  error text,
  quota_remaining int,
  created_at timestamptz not null default now()
);
create index source_requests_run_id_idx on source_requests (run_id);
alter table source_requests enable row level security;
