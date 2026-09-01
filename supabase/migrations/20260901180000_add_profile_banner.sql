-- Profile banner (YouTube-channel style header image).
--
-- Storage note: banners reuse the existing public `avatars` bucket at the path
-- <user_id>/banner.<ext>. That bucket's RLS policies are already scoped by
-- (storage.foldername(name))[1] = auth.uid()::text, so owner-only write is
-- inherited with no new bucket or policy. A null banner_url is the normal
-- state — the app renders a generated per-user risograph banner instead, so
-- there is no default asset to seed and no broken-image state to design around.
--
-- Privacy: same known, deliberate gap as avatar_url (see CLAUDE.md). The
-- avatars bucket is public-read regardless of users.is_private, so a banner is
-- hidden at the UI layer only. Real hardening needs a private bucket with
-- signed URLs; not attempted here.

alter table public.users
  add column if not exists banner_url text;

comment on column public.users.banner_url is
  'Optional profile header image. Null means the app renders its generated risograph banner. Stored in the public avatars bucket at <user_id>/banner.<ext>.';
