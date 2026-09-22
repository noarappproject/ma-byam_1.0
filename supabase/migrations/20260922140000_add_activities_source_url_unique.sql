-- A scraper needs an idempotency key: re-running it against the same source
-- page must update that page's row, never duplicate it. source_url is that
-- key. Existing rows with source_url = null (every hand-written demo row) are
-- unaffected — Postgres does not treat two nulls as equal under a unique
-- constraint, so they don't collide with each other or with anything real.
alter table public.activities
  add constraint activities_source_url_key unique (source_url);
