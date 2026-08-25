-- Enforce username format server-side too (defense in depth — the client
-- already validates this before signup). Added NOT VALID so existing rows
-- that predate this rule (e.g. ".") aren't retroactively broken; it still
-- applies to every new insert/update from this point on.

alter table public.users
  add constraint username_format_chk
  check (username ~ '^[A-Za-zא-ת][A-Za-zא-ת0-9_]*$') not valid;
