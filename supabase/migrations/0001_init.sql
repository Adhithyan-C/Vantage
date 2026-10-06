create table seller_profiles (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  problem_description text not null,
  ideal_customer text,
  competitors text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  seller_profile_id uuid not null references seller_profiles(id),
  status text not null check (status in
    ('running','completed','completed_with_warnings','failed')),
  demo boolean not null default false,
  params jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table run_sources (
  run_id uuid references runs(id) on delete cascade,
  source text not null,
  status text not null check (status in
    ('pending','running','ok','degraded','failed','skipped')),
  fetched_count int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  primary key (run_id, source)
);

create table signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  author_handle text not null,
  community text,
  url text not null,
  text_snapshot text not null,
  created_at_source timestamptz not null,
  engagement jsonb not null default '{}',
  content_hash text not null,
  removed_at_source boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table run_signals (
  run_id uuid references runs(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  primary key (run_id, signal_id)
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  signal_id uuid references signals(id) on delete cascade,
  agent text not null,
  model text,
  prompt_version text,
  input_hash text not null,
  output jsonb not null,
  evidence jsonb not null default '[]',
  evidence_verified boolean not null default false,
  status text not null check (status in ('ok','invalid_output','error')),
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  signal_id uuid not null references signals(id) on delete cascade,
  label text not null,
  score int not null check (score between 0 and 100),
  score_breakdown jsonb not null,
  rank int not null,
  status text not null default 'new'
    check (status in ('new','accepted','rejected')),
  created_at timestamptz not null default now(),
  unique (run_id, signal_id)
);

create table themes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  competitor text not null,
  title text not null,
  summary text not null,
  signal_ids uuid[] not null default '{}',
  quotes jsonb not null default '[]'
);

create table suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  channel text not null,
  draft text not null,
  angle_note jsonb not null,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  action text not null check (action in ('accept','reject','reset')),
  note text,
  created_at timestamptz not null default now()
);

create table run_events (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  agent text not null,
  kind text not null check (kind in ('info','progress','warning','error')),
  message text not null,
  counts jsonb,
  created_at timestamptz not null default now()
);

alter table seller_profiles enable row level security;
alter table runs enable row level security;
alter table run_sources enable row level security;
alter table signals enable row level security;
alter table run_signals enable row level security;
alter table decisions enable row level security;
alter table leads enable row level security;
alter table themes enable row level security;
alter table suggestions enable row level security;
alter table feedback enable row level security;
alter table run_events enable row level security;
