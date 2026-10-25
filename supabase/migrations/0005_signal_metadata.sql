alter table signals
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists content_completeness text;

alter table signals
  drop constraint if exists signals_content_completeness_check;

alter table signals
  add constraint signals_content_completeness_check
  check (content_completeness is null or content_completeness in ('complete', 'snippet', 'title_only'));
