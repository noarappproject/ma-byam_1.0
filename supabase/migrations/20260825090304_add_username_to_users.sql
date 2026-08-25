-- Username-based login: the app collects a username, not an email, and
-- constructs a placeholder email internally for Supabase Auth (which
-- requires one). Store the real username separately for display/lookup.

alter table public.users add column username text unique;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, username, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'username'),
    new.raw_user_meta_data ->> 'username',
    'teen'
  );
  return new;
end;
$$;
