-- Real activities sourced from live Jerusalem municipal/community-center pages,
-- replacing nothing — additive to the existing 18 seeded rows. Each row's
-- source_url is the actual page it was read from as of 2026-09-22; verify
-- against that page before reusing this file as a template for more.
--
-- Provenance:
--   1. Western Wall Tunnels tour — municipal events catalog
--      (jerusalem.muni.il/he/experience/lobbyevents/), tagged קהל יעד=נוער by
--      the municipality itself, detail at .../allevents/walltunnels/.
--   2–4. Beit Hakerem community center (מנהל קהילתי בית הכרם,
--      beithakerem.org.il/page.php?type=hugim) — a real matnas whose own
--      catalog lists dozens of חוגים; these three are the ones whose stated
--      grade range genuinely falls in this app's 12–18 audience (most of that
--      catalog is kindergarten/elementary and was left out, not scraped).
--
-- Fields not confirmed at the source (price on the tour, accessibility on all
-- four) are left null rather than guessed — priceCompact()/detail rendering
-- already treat a null price as "—", not zero or invented.

-- Explicit ids: docs/index.html's hardcoded `activities` array mirrors these
-- same four rows (see CLAUDE.md — the demo array is not a live query, and a
-- mock object needs its real Supabase id for favorites to reference a genuine
-- row), so the id has to be pinned rather than left to gen_random_uuid().
insert into public.activities (
  id, item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, recurrence_days,
  attendance_mode, location_name, address, neighborhood, age_min, age_max, is_accessible,
  price, price_period, registration_required, registration_url, contact_phone, status, is_published, source_url, source_name
) values (
  'b9ce02d9-8b9b-4f83-a3e9-d189b999ed3d',
  'activity', 'recurring', 'nature', array['סיורים', 'ארכיאולוגיה'],
  'מנהרות הכותל | סיור',
  '3000 שנות היסטוריה ברדיוס של 300 מטר',
  'סיור מודרך במנהרות הכותל המערבי, החושף חלקים נסתרים של הכותל ומאפשר להתקרב לאבניו המקוריות מימי בית המקדש השני. הסיור כולל הליכה בחללים תת-קרקעיים עתיקים ומלווה בדגמים וירטואליים. יש להירשם מראש; קבוצות מודרכות מוגבלות ל-35 משתתפים.',
  'מנהרות הכותל', date '2026-09-27', null, time '09:00', time '21:00', 'weekly', array[0,1,2,3,4],
  'onsite', 'הכותל המערבי', null, 'העיר העתיקה', 12, 18, null,
  null, null, true, 'https://www.jerusalem.muni.il/he/experience/allevents/walltunnels/', '*5958', 'open', true,
  'https://www.jerusalem.muni.il/he/experience/allevents/walltunnels/', 'עיריית ירושלים'
);

insert into public.activities (
  id, item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, recurrence_days,
  attendance_mode, location_name, address, neighborhood, age_min, age_max, grades, is_accessible,
  price, price_period, registration_required, registration_url, contact_phone, contact_email, status, is_published, source_url, source_name
) values (
  '166adcec-5618-4e93-807d-5bc174c7a677',
  'activity', 'recurring', 'sport', array['כדורגל'],
  'כדורגל נוער כיתות ט׳-י׳',
  'אימוני כדורגל שבועיים לבני נוער בהדרכת רון סעדון',
  'חוג כדורגל לבני נוער בכיתות ט׳-י׳, בהדרכת המאמן רון סעדון. האימונים מתקיימים פעמיים בשבוע במרכז הקהילתי בית הכרם.',
  'מנהל קהילתי בית הכרם', date '2026-09-27', null, time '19:00', time '20:00', 'weekly', array[0,4],
  'onsite', 'מרכז קהילתי ע"ש זיו ומרקס (בית הכרם)', 'שדרות הרצל 137', 'בית הכרם', 14, 16, 'ט׳-י׳', null,
  255.00, 'monthly', true, 'http://www.beithakerem.org.il/page.php?type=hug&id=88365',
  '02-5020721', 'betkerem@matnasim.org.il', 'open', true,
  'http://www.beithakerem.org.il/page.php?type=hug&id=88365', 'מנהל קהילתי בית הכרם'
);

insert into public.activities (
  id, item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, recurrence_days, schedule_note,
  attendance_mode, location_name, address, neighborhood, age_min, age_max, is_accessible,
  price, price_period, registration_required, registration_url, contact_phone, contact_email, status, is_published, source_url, source_name
) values (
  '0c0d7257-62c1-40e4-96f7-2d7d2a7751bd',
  'activity', 'recurring', 'sport', array['קראטה', 'אומנויות לחימה'],
  'קראטה נוער ומבוגרים',
  'חוג קראטה משותף לבני נוער ומבוגרים, בהדרכת יואל יערי',
  'חוג קראטה בהדרכת יואל יערי, פתוח לבני נוער ומבוגרים גם יחד. מתקיים פעמיים בשבוע במרכז הקהילתי בית הכרם.',
  'מנהל קהילתי בית הכרם', date '2026-09-27', null, time '18:30', time '20:15', 'weekly', array[0,3],
  'יום ראשון 18:30–20:15, יום רביעי 19:00–20:45',
  'onsite', 'מרכז קהילתי ע"ש זיו ומרקס (בית הכרם)', 'שדרות הרצל 137', 'בית הכרם', 13, null, null,
  285.00, 'monthly', true, 'http://www.beithakerem.org.il/page.php?type=hug&id=84551',
  '02-5020721', 'betkerem@matnasim.org.il', 'open', true,
  'http://www.beithakerem.org.il/page.php?type=hug&id=84551', 'מנהל קהילתי בית הכרם'
);

insert into public.activities (
  id, item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, recurrence_days,
  attendance_mode, location_name, address, neighborhood, age_min, age_max, grades, is_accessible,
  price, price_period, registration_required, registration_url, contact_phone, contact_email, status, is_published, source_url, source_name
) values (
  '5dad1ac2-6c44-43f9-b160-520253b9fae1',
  'activity', 'recurring', 'gaming', array['משחקי תפקידים', 'מבוכים ודרקונים'],
  'מבוכים ודרקונים לבני נוער',
  'משחק תפקידים דמיוני לבני נוער, בהפעלת פגסוס',
  'חוג מבוכים ודרקונים לבני נוער מכיתה ז׳ ומעלה: מסע דמיון, הרפתקאות, עבודת צוות וחשיבה יצירתית, בהפעלת חברת פגסוס.',
  'מנהל קהילתי בית הכרם', date '2026-09-28', null, time '18:30', time '19:45', 'weekly', array[1],
  'onsite', 'מרכז קהילתי ע"ש זיו ומרקס (בית הכרם)', 'שדרות הרצל 137', 'בית הכרם', 12, null, 'ז׳ ומעלה', null,
  230.00, 'monthly', true, 'http://www.beithakerem.org.il/page.php?type=hug&id=84573',
  '02-5020721', 'betkerem@matnasim.org.il', 'open', true,
  'http://www.beithakerem.org.il/page.php?type=hug&id=84573', 'מנהל קהילתי בית הכרם'
);
