-- Achievements, colour themes, profile interests for viewers, and the
-- username rule the sign-up form now uses.

-- 1. Usernames. New accounts may use English letters, digits and ! @ # _ . -
-- (3–20 characters, at least one letter). The old rule stays accepted: a CHECK
-- runs on every update of a row, so dropping it would stop accounts made under
-- the old rule from changing anything at all (theme, avatar, privacy).
alter table public.users drop constraint if exists username_format_chk;
alter table public.users
  add constraint username_format_chk check (
    username ~ '^[A-Za-zא-ת][A-Za-zא-ת0-9_]*$'
    or (username ~ '^[A-Za-z0-9!@#_.-]{3,20}$' and username ~ '[A-Za-z]')
  ) not valid;

-- 2. Colour themes: one for the whole app (the viewer's own choice) and one
-- for the profile page (the owner's choice, seen by whoever opens it).
-- Null profile_theme means "same as the viewer's app".
alter table public.users
  add column if not exists app_palette text not null default 'butter'
    check (app_palette in ('butter', 'sky', 'sage', 'sand', 'rose')),
  add column if not exists profile_theme text
    check (profile_theme in ('butter', 'sky', 'sage', 'sand', 'rose'));

-- 3. Achievements earned. The app decides when one is earned (most are read
-- off data it already holds — favourites, follows, the questionnaire) and
-- records it here once. Visible to whoever may see the profile: the same rule
-- as favorites_select_visible.
create table if not exists public.user_achievements (
  user_id uuid not null references public.users (id) on delete cascade,
  key text not null check (key ~ '^[a-z_]{2,40}$'),
  earned_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_achievements enable row level security;

create policy "achievements_insert_own" on public.user_achievements
  for insert with check (auth.uid() = user_id);

create policy "achievements_select_visible" on public.user_achievements
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users u
      where u.id = user_achievements.user_id
        and (
          u.is_private = false
          or exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid()
              and f.followee_id = user_achievements.user_id
              and f.status = 'accepted'
          )
        )
    )
  );

grant select, insert on public.user_achievements to authenticated;

-- 4. The few things an achievement needs that no table already records: the
-- days the app was opened, and whether search and a filter were ever used.
-- One row per kind per day; owner-only.
create table if not exists public.user_events (
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('open', 'search', 'filter')),
  day date not null default current_date,
  primary key (user_id, kind, day)
);

alter table public.user_events enable row level security;

create policy "events_select_own" on public.user_events
  for select using (auth.uid() = user_id);

create policy "events_insert_own" on public.user_events
  for insert with check (auth.uid() = user_id);

grant select, insert on public.user_events to authenticated;

-- 5. Interests for other people's eyes. user_preferences stays owner-only —
-- it also holds names, age and area — so a profile's interests are read
-- through this function, under the same visibility rule as its favourites.
create or replace function public.profile_interests(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select p.interest_topics
  from public.user_preferences p
  join public.users u on u.id = p.user_id
  where p.user_id = p_user
    and (
      p_user = auth.uid()
      or u.is_private = false
      or exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.followee_id = p_user and f.status = 'accepted'
      )
    )
$$;

revoke all on function public.profile_interests(uuid) from public;
grant execute on function public.profile_interests(uuid) to authenticated;

-- How many interests the caller shares with each given account — a count
-- only, never the topics themselves. Used to rank "suggested to follow" (the
-- old ranking read other people's preference rows, which RLS never allowed,
-- so every score was 0) and for the "beyond the bubble" achievement.
create or replace function public.shared_interest_counts(p_users uuid[])
returns table (user_id uuid, shared integer, has_interests boolean)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select coalesce(interest_topics, '{}') as topics
    from public.user_preferences where user_id = auth.uid()
  )
  select u.id,
         coalesce((
           select count(*)::int
           from unnest(coalesce(p.interest_topics, '{}')) as t(topic)
           where t.topic = any(coalesce((select topics from mine), '{}'))
         ), 0),
         coalesce(array_length(p.interest_topics, 1), 0) > 0
  from unnest(p_users) as u(id)
  left join public.user_preferences p on p.user_id = u.id
$$;

revoke all on function public.shared_interest_counts(uuid[]) from public;
grant execute on function public.shared_interest_counts(uuid[]) to authenticated;
