-- Profile + settings, saved per-user and auto-persisted:
-- avatar, theme, text size, and app language.

alter table public.users
  add column avatar_url text,
  add column theme_pref text not null default 'system' check (theme_pref in ('light', 'dark', 'system')),
  add column text_size text not null default 'medium' check (text_size in ('small', 'medium', 'large')),
  add column language text not null default 'he' check (language in ('he', 'ar', 'en', 'ru'));

-- Avatar storage: public read (profile pictures), owner-only write,
-- one file per user stored at "<user_id>/<filename>".
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatar_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatar_owner_insert" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_owner_delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
