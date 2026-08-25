-- The onboarding questionnaire is now fully skippable, step-by-step (each
-- page can be left blank), and the "vibe" tone-detection stage was removed
-- entirely. Drop the vibe columns, and drop NOT NULL from every remaining
-- answer field so a partially-filled or fully-skipped session can still be
-- saved as-is.

alter table public.user_preferences
  drop column vibe_q1,
  drop column vibe_q2,
  drop column vibe_q3,
  drop column vibe_q4,
  drop column vibe_q5,
  drop column vibe_result;

alter table public.user_preferences
  alter column age_range drop not null,
  alter column grade drop not null,
  alter column area drop not null;
