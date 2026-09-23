-- Remove every activity that did not come from the listing scraper: the 18
-- invented demo rows seeded in August, the hand-verified batch of 2026-09-22,
-- and the three rows the old one-page-per-URL scraper wrote. From here on the
-- table holds only what scrape-activities extracts from the pages in
-- supabase/functions/scrape-activities/sources.json.
--
-- A scraper-written row always has source_page set, so that is the test.
-- Favorites, registrations and reviews on these rows go with them
-- (on delete cascade) — they pointed at activities that were not real.
delete from public.activities where source_page is null;
