-- age_range and grade are now combo-box fields (pick a suggestion or type
-- freely, in any of the app's 4 languages), so they can no longer be
-- restricted to a fixed Hebrew-only enum list.

alter table public.user_preferences drop constraint user_preferences_age_range_check;
alter table public.user_preferences drop constraint user_preferences_grade_check;
