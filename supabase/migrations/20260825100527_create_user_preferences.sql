-- Onboarding questionnaire: shown once after a real signup/login (never for
-- guests, since guest data is explicitly not collected). Stores every answer
-- the user submitted, plus the derived "vibe" classification.

create table public.user_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,

  -- שלב א׳ — מיון מקדים
  first_name text,
  last_name text,
  age_range text not null check (age_range in ('12-13', '14-15', '16-17', '18+')),
  grade text not null check (grade in ('ז', 'ח', 'ט', 'י', 'יא', 'יב', 'not_studying')),
  area text not null,

  -- שלב ב׳ — זיהוי וייב (כל תשובה גולמית, בנוסף לתוצאה המחושבת)
  vibe_q1 text not null check (vibe_q1 in ('energetic', 'balanced', 'serious')),
  vibe_q2 text not null check (vibe_q2 in ('energetic', 'balanced', 'serious')),
  vibe_q3 text not null check (vibe_q3 in ('energetic', 'balanced', 'serious')),
  vibe_q4 text not null check (vibe_q4 in ('energetic', 'balanced', 'serious')),
  vibe_q5 text not null check (vibe_q5 in ('energetic', 'balanced', 'serious')),
  vibe_result text not null check (vibe_result in ('energetic', 'balanced', 'serious')),

  -- שלב ג׳ — תחומי עניין
  activity_types text[] not null default '{}',
  interest_topics text[] not null default '{}',
  interest_other text,

  completed_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

create policy "prefs_select_own" on public.user_preferences
  for select using (auth.uid() = user_id);

create policy "prefs_insert_own" on public.user_preferences
  for insert with check (auth.uid() = user_id);

create policy "prefs_update_own" on public.user_preferences
  for update using (auth.uid() = user_id);
