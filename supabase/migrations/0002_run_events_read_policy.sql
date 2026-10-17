create policy "anon can read run_events"
  on run_events for select to anon using (true);