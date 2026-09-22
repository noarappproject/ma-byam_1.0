-- Activity reviews: a 1–5 star rating plus an optional note of at most 100
-- characters, one per person per activity. Reading is public (guests
-- included); writing requires an account.
--
-- Anonymity is the default, and it is enforced HERE rather than in the UI.
-- The table itself is readable only by the author; the public list is served
-- by `activity_reviews_public()`, a security-definer function that drops the
-- author's identity from anonymous rows before they ever reach the client.
-- A plain `using (true)` select policy would have shipped `user_id` on every
-- row, and `users_select_all` is itself `using (true)` — so any client could
-- have joined an "anonymous" review straight back to its author. That makes
-- this unlike the avatar-bucket privacy gap, which is deliberately UI-level:
-- an anonymity promise made to minors has to hold at the API.

create table public.activity_reviews (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 100),
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  unique (activity_id, user_id)
);

create index activity_reviews_activity_idx
  on public.activity_reviews (activity_id, created_at desc);

alter table public.activity_reviews enable row level security;

-- Owner-only on the table. Everyone else reads through the function below,
-- which is what keeps an anonymous author anonymous.
create policy "activity_reviews_select_own" on public.activity_reviews
  for select using (auth.uid() = user_id);

create policy "activity_reviews_insert_own" on public.activity_reviews
  for insert with check (auth.uid() = user_id);

create policy "activity_reviews_update_own" on public.activity_reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "activity_reviews_delete_own" on public.activity_reviews
  for delete using (auth.uid() = user_id);

-- Explicit, unlike the older tables here: `auto_expose_new_tables` is unset in
-- config.toml, so a new table is NOT reachable through the Data API roles
-- without this. `favorites` and `follows` predate that default and got their
-- grants implicitly — copying their migrations verbatim would have produced a
-- table that exists but rejects every write.
--
-- `anon` is deliberately absent: guests read through the function below, which
-- runs as its owner, so they never need a grant on the table itself.
grant select, insert, update, delete on public.activity_reviews to authenticated;

-- The public shape of a review. `display_name` and `avatar_url` come back null
-- for an anonymous row, so the client never holds the identity it would have
-- to be trusted not to render. The avatar is additionally withheld for a
-- private account, matching how the rest of the app treats `is_private`.
create function public.activity_reviews_public(p_activity_id uuid)
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
    case when r.is_anonymous then null else u.username end,
    case when r.is_anonymous or u.is_private then null else u.avatar_url end
  from public.activity_reviews r
  join public.users u on u.id = r.user_id
  where r.activity_id = p_activity_id
  order by r.created_at desc;
$$;

revoke all on function public.activity_reviews_public(uuid) from public;
grant execute on function public.activity_reviews_public(uuid) to anon, authenticated;
