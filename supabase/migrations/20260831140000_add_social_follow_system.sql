-- Social/follow system: per-account privacy flag, a follower/following
-- relationship table with an approval flow for private accounts, and a
-- matching widening of favorites visibility (whoever can see a profile can
-- see its favorites — one visibility rule, not two).
--
-- Deliberately NOT changed here: the `avatars` storage bucket stays fully
-- public-read (`avatar_public_read`), and `users_select_all` stays
-- `using (true)`. Postgres RLS can't hide one column while exposing others
-- on the same row, so true per-photo/per-field privacy would need a private
-- bucket with signed URLs and/or a view — out of scope for this pass. This
-- feature only adds app-level (UI) gating on top of what's already public.

alter table public.users
  add column is_private boolean not null default true;

create type follow_status as enum ('pending', 'accepted');

create table public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.users (id) on delete cascade,
  followee_id uuid not null references public.users (id) on delete cascade,
  status follow_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_follower_idx on public.follows (follower_id);
create index follows_followee_status_idx on public.follows (followee_id, status);

alter table public.follows enable row level security;

-- Either side of the relationship can see it: the followee needs to see
-- incoming requests/followers, the follower needs to see their own outgoing
-- pending/accepted state.
create policy "follows_select_participant" on public.follows
  for select using (auth.uid() = follower_id or auth.uid() = followee_id);

-- A pending request can always be created by the follower. An
-- already-accepted row (instant-follow) may only be inserted when the
-- target is actually public — otherwise a client could insert
-- status='accepted' directly and bypass approval on a private account.
create policy "follows_insert_own" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and (
      status = 'pending'
      or (
        status = 'accepted'
        and exists (select 1 from public.users where id = followee_id and is_private = false)
      )
    )
  );

-- Only the followee can approve a request (pending -> accepted). Denying,
-- unfollowing, and removing a follower are all deletes, not updates.
create policy "follows_update_followee" on public.follows
  for update using (auth.uid() = followee_id)
  with check (auth.uid() = followee_id and status = 'accepted');

-- The follower can cancel their own request or unfollow; the followee can
-- deny a pending request or remove an existing follower.
create policy "follows_delete_participant" on public.follows
  for delete using (auth.uid() = follower_id or auth.uid() = followee_id);

-- Widen favorites visibility: own rows, or the owner's profile is public,
-- or the viewer is an accepted follower of a private owner. Replaces the
-- previous owner-only policy.
drop policy "favorites_select_own" on public.favorites;

create policy "favorites_select_visible" on public.favorites
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.users u
      where u.id = favorites.user_id
        and (
          u.is_private = false
          or exists (
            select 1 from public.follows f
            where f.follower_id = auth.uid()
              and f.followee_id = favorites.user_id
              and f.status = 'accepted'
          )
        )
    )
  );
