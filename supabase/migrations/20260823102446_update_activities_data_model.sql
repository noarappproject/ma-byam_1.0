-- Replace the simple activities table with the full data model
-- (see "מודל נתוני הפעילות — מה בי״ם", 48 fields / 21 required).
-- created_by is removed in this model, replaced by organization_name.

drop table if exists public.activities cascade;

-- Enums for the new model
create type item_kind_enum as enum ('activity', 'event');
create type schedule_type_enum as enum ('one_time', 'series', 'recurring');
create type recurrence_freq_enum as enum ('none', 'daily', 'weekly', 'biweekly', 'monthly');
create type category_enum as enum (
  'sport', 'tech', 'art', 'music', 'stage', 'nature',
  'volunteer', 'leadership', 'learning', 'gaming', 'wellbeing'
);
create type attendance_mode_enum as enum ('onsite', 'online', 'hybrid');
create type gender_enum as enum ('mixed', 'boys', 'girls');
create type sector_enum as enum ('general', 'religious', 'haredi', 'arab');
create type price_period_enum as enum ('total', 'per_session', 'monthly');
create type activity_status_enum as enum ('open', 'full', 'cancelled', 'postponed', 'ended');

create table public.activities (
  -- א. זיהוי וסיווג
  id uuid primary key default gen_random_uuid(),
  item_kind item_kind_enum not null,
  schedule_type schedule_type_enum not null,
  category category_enum not null,
  topics text[],

  -- ב. תוכן ותצוגה
  title text not null,
  short_description text check (char_length(short_description) <= 140),
  description text not null,
  image_url text,
  organization_name text not null,

  -- ג. זמנים
  start_date date not null,
  end_date date,
  start_time time not null,
  end_time time,
  recurrence_freq recurrence_freq_enum not null default 'none',
  recurrence_days int[],
  sessions_count int,
  excluded_dates date[],
  schedule_note text,

  -- ד. מיקום
  attendance_mode attendance_mode_enum not null,
  location_name text not null,
  address text,
  neighborhood text,

  -- ה. קהל יעד
  age_min int,
  age_max int,
  grades text,
  gender gender_enum,
  sector sector_enum[],
  languages text[],
  is_accessible boolean,
  accessibility_note text,

  -- ו. מחיר והרשמה (price/registration_url stay null-able: documented fallback values)
  price decimal(10, 2),
  price_period price_period_enum,
  is_free boolean generated always as (price = 0) stored,
  registration_required boolean not null default false,
  registration_url text,
  registration_opens_at timestamptz,
  registration_deadline timestamptz,
  contact_phone text,
  contact_email text,

  -- ז. סטטוס וקיבולת
  status activity_status_enum not null default 'open',
  capacity int,
  spots_left int,
  is_published boolean not null default false,

  -- ח. מקור ומטא־דאטה
  source_url text,
  source_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activities_age_range_chk check (age_min is null or age_max is null or age_min <= age_max)
);

create index activities_item_kind_idx on public.activities (item_kind);
create index activities_category_idx on public.activities (category);
create index activities_start_date_idx on public.activities (start_date);
create index activities_neighborhood_idx on public.activities (neighborhood);
create index activities_status_idx on public.activities (status);
create index activities_topics_idx on public.activities using gin (topics);

-- Re-link registrations/favorites to the recreated table
alter table public.registrations
  add constraint registrations_activity_id_fkey
  foreign key (activity_id) references public.activities (id) on delete cascade;

alter table public.favorites
  add constraint favorites_activity_id_fkey
  foreign key (activity_id) references public.activities (id) on delete cascade;

-- RLS: published activities are public; only organizers/admins manage the catalog
-- (ownership per-row was dropped along with created_by, so writes are role-gated, not row-gated)
alter table public.activities enable row level security;

create policy "activities_select_published" on public.activities
  for select using (
    is_published
    or exists (select 1 from public.users where id = auth.uid() and role in ('organizer', 'admin'))
  );

create policy "activities_insert_staff" on public.activities
  for insert with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('organizer', 'admin'))
  );

create policy "activities_update_staff" on public.activities
  for update using (
    exists (select 1 from public.users where id = auth.uid() and role in ('organizer', 'admin'))
  );

create policy "activities_delete_staff" on public.activities
  for delete using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Keep updated_at current on every edit
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- Sample data: one חוג (recurring), one אירוע (one-time event), one פעילות (one-time, registered)

insert into public.activities (
  item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, start_time, end_time, recurrence_freq, recurrence_days,
  attendance_mode, location_name, address, neighborhood, age_min, age_max, gender, sector,
  is_accessible, price, price_period, registration_required, registration_url, status, is_published, source_name
) values (
  'activity', 'recurring', 'tech', array['רובוטיקה', 'תכנות'],
  'חוג רובוטיקה לנוער',
  'בונים ומתכנתים רובוטים בסביבה תומכת לבני נוער',
  'חוג שבועי לבני נוער החוקר עולם הרובוטיקה: תכנון, הרכבה ותכנות רובוטים באמצעות ערכות לגו ופייתון. אין צורך בידע קודם.',
  'מתנ"ס בית הכרם', date '2026-09-01', time '17:30', time '19:00', 'weekly', array[1],
  'onsite', 'מתנ"ס בית הכרם', 'רחוב הכרם 12, ירושלים', 'בית הכרם', 12, 17, 'mixed', array['general']::sector_enum[],
  true, 150.00, 'monthly', true, 'https://example.org/register/robotics-club', 'open', true, 'מתנ"ס ירושלים'
);

insert into public.activities (
  item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, sessions_count,
  attendance_mode, location_name, neighborhood, gender,
  price, registration_required, status, is_published, source_url
) values (
  'event', 'one_time', 'stage', array['הופעות'],
  'הופעת מוזיקה בפארק המסילה',
  'ערב מוזיקה חי לכל המשפחה בפארק המסילה',
  'ערב קיץ עם הופעות חיות של להקות מקומיות, בכניסה חופשית, לכל הגילאים. יש להביא מצעים לישיבה על הדשא.',
  'עיריית ירושלים', date '2026-09-10', date '2026-09-10', time '20:00', time '22:00', 'none', 1,
  'onsite', 'פארק המסילה', 'המושבה הגרמנית', 'mixed',
  0, false, 'open', true, 'https://www.jerusalem.muni.il/events/park-mesila-concert'
);

insert into public.activities (
  item_kind, schedule_type, category, topics, title, short_description, description,
  organization_name, start_date, end_date, start_time, end_time, recurrence_freq, sessions_count,
  attendance_mode, location_name, neighborhood, age_min, age_max, gender, is_accessible,
  price, price_period, registration_required, registration_url, registration_deadline,
  capacity, spots_left, status, is_published
) values (
  'activity', 'one_time', 'art', array['צילום'],
  'סדנת צילום חד־פעמית לנוער',
  'סדנה מעשית ללימוד יסודות הצילום הדיגיטלי',
  'סדנה בת מפגש אחד ללימוד יסודות הקומפוזיציה, תאורה ועריכה בצילום דיגיטלי, כולל תרגול מעשי בשטח עם מצלמות סמארטפון.',
  'בית הנוער אחת העם', date '2026-09-15', date '2026-09-15', time '16:00', time '19:00', 'none', 1,
  'onsite', 'בית הנוער אחת העם', 'קטמון', 13, 18, 'mixed', false,
  60.00, 'total', true, 'https://example.org/register/photo-workshop', '2026-09-13 23:59:00+03',
  15, 8, 'open', true
);
