-- The interest functions are for signed-in accounts. Supabase's default
-- privileges grant EXECUTE on new functions to anon as well, which the earlier
-- "revoke all from public" did not undo.
revoke execute on function public.profile_interests(uuid) from anon;
revoke execute on function public.shared_interest_counts(uuid[]) from anon;
