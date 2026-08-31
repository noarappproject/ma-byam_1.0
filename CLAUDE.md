# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

מה בי״ם ("Mah Ba'im") is a youth activities/clubs/events discovery PWA for teens in Jerusalem. It's a working prototype: a single-file HTML/CSS/JS frontend backed by Supabase (Postgres + Auth + Storage), deployed via GitHub Pages.

- Live app: https://noarappproject.github.io/ma-byam_1.0/
- Supabase project ref: `soncpzmasqcjxcawhqqw` (URL and publishable key are hardcoded in `docs/index.html` — see Notes below)
- Test login: `admin` / `123456` (several other throwaway test accounts exist in the DB from development)

## Commands

There is no build step for the app — `docs/index.html` is edited directly and is live as-is (open it in a browser, or serve `docs/` with any static file server).

- `npm run make-icons` — regenerates the PWA icons in `docs/icons/` from `tools/make-icons.mjs` (uses `sharp`; the only dependency in the project).
- `supabase db push` — applies pending files in `supabase/migrations/` to the linked Supabase project (CLI must be logged in and linked).
- `supabase migration new <name>` — scaffolds a new timestamped migration file.
- No automated test suite or linter is configured.
- Deployment is automatic: pushing to `master` updates GitHub Pages, which serves directly from the `/docs` folder.

## Architecture

### Frontend: one file, no framework

`docs/index.html` (~3000 lines) is the entire frontend: plain HTML/CSS/JS in a single `<script>` block, with the Supabase JS client loaded from a CDN. There is no router — every screen (auth, onboarding questionnaire, home/browse, favorites, profile, settings, accessibility) is a sibling `<div class="frame" id="...Screen" hidden>` in the body, and a `showX()` function makes one visible by setting `.hidden = false` on it and `= true` on every other screen. **Adding a new screen means adding it to every existing `showX()` function's hide-list**, not just writing its own show function.

Patterns worth knowing before editing this file:

- **State is module-level and per-screen, not componentized.** Home's browse/filter state (`state`, `index`) and the Favorites screen's filter/sort state (`favState`) are separate globals. Each screen's render function (`render()`, `renderFavorites()`, `renderProfile()`, `renderSettings()`, …) fully replaces its container's `innerHTML` on every call and re-attaches listeners on the elements it just created; listeners on static containers (search inputs, chip rows) are instead registered once, at top level, using event delegation.
- **Declaration order matters for top-level statements.** The whole script executes top-to-bottom before `boot()` (the final IIFE at the bottom of the file) triggers any real interaction. A `const el = document.getElementById(...)` referenced inside a *function body* is safe regardless of where in the file it's declared (hoisting covers it), but one referenced in an *immediately-executed* top-level `el.addEventListener(...)` call must be declared earlier in the file than that call, or it throws (temporal dead zone).
- **i18n** lives in a single `STRINGS` object keyed by `he`/`ar`/`en`/`ru` (Hebrew is default and RTL, Arabic is RTL, English/Russian are LTR). `L()` returns the current language's dict — there is no fallback, so a key missing from any one of the four blocks renders literal `undefined`. Static text is applied once per language switch via `applyStaticText()`; each dynamic screen re-renders itself from inside `setLanguage()`. Activity content (titles, descriptions) is never translated, only UI chrome is.
- **Auth is username-based on top of Supabase's email/password auth.** Signup synthesizes a placeholder email (`<username>@mahbaim.app`); login looks up the user's real stored email from `public.users.email` by username rather than re-deriving it. Username changes only update `public.users`/auth metadata — `supabase.auth.updateUser({email})` is deliberately not used, since it rejects updates under this project's current email-confirmation settings. Guest mode is a pure `localStorage` flag (`mb_guest`) with zero Supabase writes; guest theme/text-size/language preferences persist to `localStorage` only.
- **The browsable activities list is a hardcoded demo array**, not a live query — `const activities = [...]` near the top of the script, mirroring the 18 rows actually seeded in the `activities` table. Each mock object carries the real Supabase `id` of its matching row (needed so `favorites` can reference genuine activity rows). If this is ever switched to a live query, the fetched rows must match the field names this array already uses, since `render()`, `activityDetailHtml()`, and `favRowHtml()` all read directly from it.

### Backend: Supabase

- Schema is defined by `supabase/migrations/*.sql`, applied in filename (timestamp) order. Several tables were altered after their original creation — e.g. `activities` was dropped and completely rebuilt (48-field model) in a later migration, and `user_preferences` had its "vibe" quiz columns added then removed. Read the most recent migration touching a table for its current shape rather than the table's original `CREATE`.
- `public.users` is kept in sync with `auth.users` by an `on_auth_user_created` trigger (`handle_new_user()`) — every signup automatically gets a `public.users` row; there is no separate "create profile" step in the app code.
- RLS is enabled on every table. `activities` is publicly readable only where `is_published = true`; writes are gated by `public.users.role` (`organizer`/`admin`), not row ownership (the current activities model has no `created_by`). `favorites`, `registrations`, and `user_preferences` are all strictly owner-scoped (`auth.uid() = user_id`). `favorites` has no update policy — it's insert/delete only, a pure toggle.
- Avatars use Storage bucket `avatars` (public read); objects are stored at `<user_id>/<filename>`, with owner-only write enforced via RLS on `storage.objects`.

## Notes

- The Supabase URL and publishable/anon key are hardcoded in `docs/index.html` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — this is intentional and safe, it's the public client key, not a secret.
- `registrations` exists in the schema but isn't wired into the UI — the "Register" CTA on an activity card just opens its `registration_url` in a new tab; it never writes a `registrations` row.
- No offline support, by design — the PWA manifest only enables "Add to Home Screen," there is no service worker.
