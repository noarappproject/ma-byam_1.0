-- Display names, the final username rule, what a profile shows to other
-- signed-in accounts, and the colour themes removed.

-- 1. Usernames: English letters, digits and _, 3–20 characters. The old rule
-- stays accepted so accounts made under it can still update their rows (a
-- CHECK runs on every update). No account used the short-lived symbols rule.
alter table public.users drop constraint if exists username_format_chk;
alter table public.users
  add constraint username_format_chk check (
    username ~ '^[A-Za-zא-ת][A-Za-zא-ת0-9_]*$'
    or username ~ '^[A-Za-z0-9_]{3,20}$'
  ) not valid;

-- 2. Display name: what a profile shows in large type. Any language, up to 30
-- characters; null means "show the username". The username itself no longer
-- changes from the app.
alter table public.users
  add column if not exists display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 30);

-- 3. Colour themes are gone.
alter table public.users
  drop column if exists app_palette,
  drop column if exists profile_theme;

-- 4. What another signed-in account sees on a profile, private or not: the
-- display name and username, the counts, the interests and the achievements.
-- A private profile hides only its favourites, picture and banner (those stay
-- behind favorites_select_visible and the app's canViewProfile()).
create or replace function public.profile_interests(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select p.interest_topics from public.user_preferences p where p.user_id = p_user
$$;

drop policy if exists "achievements_select_visible" on public.user_achievements;
create policy "achievements_select_signed_in" on public.user_achievements
  for select to authenticated using (true);

-- Follower, following and saved counts for any profile. follows is readable
-- only by its two participants and favorites only where the profile is
-- visible, so counting them from the app undercounts everyone else's.
create or replace function public.profile_counts(p_user uuid)
returns table (followers integer, following integer, saved integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.follows where followee_id = p_user and status = 'accepted'),
    (select count(*)::int from public.follows where follower_id = p_user and status = 'accepted'),
    (select count(*)::int from public.favorites where user_id = p_user)
$$;

revoke all on function public.profile_counts(uuid) from public;
revoke execute on function public.profile_counts(uuid) from anon;
grant execute on function public.profile_counts(uuid) to authenticated;

-- 5. Reviews show the writer's display name, as the rest of the app does.
-- Same signature and the same anonymity rule as before.
create or replace function public.activity_reviews_public(p_activity_id uuid)
returns table (
  id uuid,
  rating smallint,
  body text,
  is_anonymous boolean,
  created_at timestamptz,
  display_name text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.rating,
    r.body,
    r.is_anonymous,
    r.created_at,
    case when r.is_anonymous then null else coalesce(nullif(btrim(u.display_name), ''), u.username) end,
    case when r.is_anonymous or u.is_private then null else u.avatar_url end
  from public.activity_reviews r
  join public.users u on u.id = r.user_id
  where r.activity_id = p_activity_id
  order by r.created_at desc;
$$;
