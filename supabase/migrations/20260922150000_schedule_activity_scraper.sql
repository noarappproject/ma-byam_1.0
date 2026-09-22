-- Schedules scrape-activities to run once a day at 04:00 UTC (07:00 Israel
-- winter time / 06:00 summer) — club schedules and prices don't change
-- hourly, and this keeps Firecrawl credit usage to one pass over SOURCES per
-- day. Change the cron expression below and re-run this file's `select
-- cron.alter_job(...)` (or unschedule + reschedule) to adjust cadence.
--
-- Calls the function with the publishable/anon key, not the service-role key
-- — the function only needs *a* valid Supabase-issued JWT to pass its default
-- verify_jwt check; the privileged write to `activities` happens inside the
-- function using its own SUPABASE_SERVICE_ROLE_KEY (auto-injected, never
-- passed over the network). That keeps the service-role key out of
-- `cron.job`, which anyone able to query the `cron` schema could otherwise
-- read back out.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'scrape-activities-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url := 'https://soncpzmasqcjxcawhqqw.supabase.co/functions/v1/scrape-activities',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_Js1OgoSr1x7INhSfR_hfwQ_0aTH1vIW',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
