alter table source_requests
  add column outcome text check (outcome in ('success','no_results','failed','rate_limited','unsupported_query','partial')),
  add column request jsonb,
  add column response_summary jsonb;
