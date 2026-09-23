-- The scraper now reads whole listing pages (every club/course/show on a
-- community center's page) instead of one hand-picked activity per URL.
-- See supabase/functions/scrape-activities/index.ts and sources.json.

-- Which listing page produced a row, and when the scraper last saw it. A row
-- with no source_page did not come from the scraper.
alter table public.activities
  add column source_page text,
  add column last_seen_at timestamptz;

-- Most listing pages state a club's name and ages but keep its days and hours
-- on the club's own page. Rather than fill those with the scrape date and
-- "00:00" (which the app would print as fact), they are allowed to be empty.
alter table public.activities
  alter column start_date drop not null,
  alter column start_time drop not null;

create index activities_source_page_idx on public.activities (source_page, last_seen_at);

-- One row per source: whether it ran today and how it went. This is what lets
-- the cron hand out one source per call, and it is the place to look when a
-- source stops producing activities.
create table public.scrape_runs (
  source_url text primary key,
  last_run_on date not null,
  last_run_at timestamptz not null default now(),
  last_status text not null check (last_status in ('ok', 'error')),
  found int,
  kept int,
  inserted int,
  updated int,
  skipped jsonb,
  last_error text
);

-- Not client-readable: RLS on with no policies. The Edge Function writes it
-- with the service role, which needs an explicit grant because
-- auto_expose_new_tables is unset (see HANDOFF.md).
alter table public.scrape_runs enable row level security;
grant select, insert, update, delete on public.scrape_runs to service_role;

-- Replace the single daily call with one call every 3 minutes between 03:00
-- and 03:57 UTC on Sundays. Each call scrapes one source that has not run that
-- day, so up to 20 sources fit, each inside the function's 150 s limit; calls
-- after the last source run the cleanup pass. Weekly, not daily, because each
-- listing extraction costs 5 Firecrawl credits and the plan has 1,000 a month.
-- The secret comes from Vault at run time — it is never written in this file —
-- and the 150 s timeout lets pg_net record the function's real answer instead
-- of giving up after its 5 s default.
select cron.unschedule('scrape-activities-daily');

select cron.schedule(
  'scrape-activities-batch',
  '*/3 3 * * 0',
  $$
  select net.http_post(
    url := 'https://soncpzmasqcjxcawhqqw.supabase.co/functions/v1/scrape-activities',
    headers := jsonb_build_object(
      'Authorization', 'Bearer sb_publishable_Js1OgoSr1x7INhSfR_hfwQ_0aTH1vIW',
      'Content-Type', 'application/json',
      'x-scraper-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scraper_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
