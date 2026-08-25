-- Enums
create type user_role as enum ('guest', 'teen', 'organizer', 'admin');
create type registration_status as enum ('registered', 'cancelled', 'attended');

-- Users: profile row linked 1:1 to Supabase Auth's auth.users
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role user_role not null default 'guest',
  created_at timestamptz not null default now()
);

-- Activities
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  location text,
  start_time timestamptz not null,
  end_time timestamptz,
  price numeric(10, 2) not null default 0,
  source_url text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index activities_created_by_idx on public.activities (created_by);
create index activities_start_time_idx on public.activities (start_time);
create index activities_category_idx on public.activities (category);

-- Registrations
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  status registration_status not null default 'registered',
  created_at timestamptz not null default now(),
  unique (user_id, activity_id)
);

create index registrations_user_id_idx on public.registrations (user_id);
create index registrations_activity_id_idx on public.registrations (activity_id);

-- Favorites
create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, activity_id)
);

create index favorites_user_id_idx on public.favorites (user_id);
create index favorites_activity_id_idx on public.favorites (activity_id);

-- Row Level Security
alter table public.users enable row level security;
alter table public.activities enable row level security;
alter table public.registrations enable row level security;
alter table public.favorites enable row level security;

-- Users: everyone can read profiles, users can only edit their own
create policy "users_select_all" on public.users
  for select using (true);

create policy "users_update_own" on public.users
  for update using (auth.uid() = id);

-- Activities: readable by everyone, writable by organizers/admins that created them
create policy "activities_select_all" on public.activities
  for select using (true);

create policy "activities_insert_organizer" on public.activities
  for insert with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.users
      where id = auth.uid() and role in ('organizer', 'admin')
    )
  );

create policy "activities_update_own" on public.activities
  for update using (
    auth.uid() = created_by
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

create policy "activities_delete_own" on public.activities
  for delete using (
    auth.uid() = created_by
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Registrations: users manage their own registrations
create policy "registrations_select_own" on public.registrations
  for select using (auth.uid() = user_id);

create policy "registrations_insert_own" on public.registrations
  for insert with check (auth.uid() = user_id);

create policy "registrations_update_own" on public.registrations
  for update using (auth.uid() = user_id);

create policy "registrations_delete_own" on public.registrations
  for delete using (auth.uid() = user_id);

-- Favorites: users manage their own favorites
create policy "favorites_select_own" on public.favorites
  for select using (auth.uid() = user_id);

create policy "favorites_insert_own" on public.favorites
  for insert with check (auth.uid() = user_id);

create policy "favorites_delete_own" on public.favorites
  for delete using (auth.uid() = user_id);

-- Keep public.users in sync when a new auth user signs up
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
