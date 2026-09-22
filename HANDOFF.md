# מה בי״ם — Project Handoff

Last full end-to-end pass: **2026-09-17**. Reviews added and verified **2026-09-22** (that pass covered reviews only, not the whole app). Read `CLAUDE.md` for architecture; this file is the operational picture — links, credentials, state, and the traps.

---

## What this is

A youth activities / clubs / events discovery PWA for teens in Jerusalem. A working prototype: a real Supabase backend behind a single-file HTML/CSS/JS frontend on GitHub Pages. No build step, no framework.

## Links

| | |
|---|---|
| **Live app** | https://noarappproject.github.io/ma-byam_1.0/ |
| **Repo** | https://github.com/noarappproject/ma-byam_1.0 — branch `master`, Pages serves `/docs` |
| **Supabase dashboard** | https://supabase.com/dashboard/project/soncpzmasqcjxcawhqqw |
| **Local repo root** | `C:\Users\shild\OneDrive\Desktop\מה בי-ם` |

Supabase ref `soncpzmasqcjxcawhqqw` · org `rvgktzdiebyqpynlygsq` · region `ap-northeast-2`
Publishable key (public by design, already in the app source): `sb_publishable_Js1OgoSr1x7INhSfR_hfwQ_0aTH1vIW`

## Test login

**`testuser_mb1` / `test1234`** — verified working 2026-09-17.

> `admin` / `123456` was documented here for a long time and **does not work** — the row still exists in `public.users` but the password no longer matches and the auth endpoint returns 400. It cost real debugging time twice. Don't reinstate it without testing it first.

Many other throwaway accounts exist from development (`big_…`, `favcheck…`, `exittest_…`, single letters). Most have unknown passwords. Harmless clutter.

**`demo_noa1` / `demo1234`** and **`demo_itay1` / `demo1234`** — created 2026-09-22 specifically to make "friends who saved this" demonstrable. Before these, the *entire* database had exactly one follow relationship with an overlapping favorite (`testuser_mb1` → `socialA1`, one activity, buried at position 4 of a rail — practically invisible during normal browsing, which is why the feature looked broken). Both are public accounts (`is_private = false`); `testuser_mb1` follows both. Between them they favorited: קייטנת כדורגל לחופש הגדול (both — this is the one that shows "X ו-Y saved this" on the very first card of Home's recommended rail), חוג שחייה לנוער, טורניר גיימינג לנוער, תוכנית חונכות והתנדבות קהילתית, חוג רובוטיקה לנוער. If this data disappears (or you want it seeded elsewhere), it's cheap to reproduce: sign up, flip privacy off in Settings, favorite a few activities, follow from `testuser_mb1`.

---

## ⚠️ The one thing that will bite you

**The Supabase project is on the free tier and pauses itself after roughly a week of inactivity.** It did exactly this between 2026-09-01 and 2026-09-17.

When paused:
- `supabase projects list` → `"status":"INACTIVE"`
- `nslookup soncpzmasqcjxcawhqqw.supabase.co` → **NXDOMAIN**, the subdomain stops resolving altogether
- Guest browsing still works perfectly, so it looks like an app bug rather than an outage

**Restoring it is a click, not a command.** The CLI has no restore/unpause subcommand, and on Windows the CLI token lives in the Windows Credential Manager rather than a file. Open the dashboard → **Restore project** → 1–3 minutes. **No data is lost** — favourites, follows and profiles all came back intact.

If it keeps being annoying, the real fixes are upgrading to Pro or a scheduled ping to keep it warm. Neither is set up.

---

## Current state — what's built and verified

Verified against the live site on 2026-09-17, logged in as `testuser_mb1`, reads **and** writes:

- **Gate** — welcome sheet, then one form that flips between signup and login
- **Home** — identity strip + messages bell, headline, search, a sideways rail of large image-led cards, and a downward stack of new activities that grows as you reach its end
- **Archive** — the full searchable/filterable catalog, reached from either section's "לארכיון"
- **Activity detail** — a real full screen; fact rows and the CTA change by `item_kind` (חוג / אירוע / פעילות), and `status` outranks the kind so a full or cancelled activity never invites registration
- **Reviews** — a 1–5 star rating and an optional 100-character note on the activity detail sheet. Anyone can read them, including guests; writing needs an account. Anonymous is the default and is enforced in the database, not the UI (see the trap below). Added 2026-09-22 and verified that day against the **live Supabase backend from a local server**, not yet against the deployed Pages site: write, edit, delete, guest read, and a guest write correctly rejected by RLS.
- **Favourites, Profile (with channel-style banner), Settings, Accessibility, Social** — all working
- **Guest mode** — works completely **without the backend**, because activities are a hardcoded array and guest prefs are localStorage. This is the fallback when the DB is down.
- **i18n** — he / ar / en / ru, 252 keys, all four blocks at parity
- **PWA** — installable via Add to Home Screen. No service worker, so **no offline support, by design.**

### Visual identity — settled, don't reopen

A **risograph event-flyer press**: one riso ink set on two substrates (warm paper for light, black stock for dark), 11 category inks, generated inline-SVG artwork per activity, Rubik + Assistant. The direction contract is an HTML comment at the top of `<body>` in `docs/index.html` — **read it before changing anything visual.**

`docs/variants/` holds 5 older whole-app explorations. They are **superseded history, not live options.** Ignore them unless asked.

---

## Two traps around migrations

**Run the CLI from the repo root, not from its parent.** `supabase link` will happily succeed one directory up — it just writes a `supabase/.temp/` there — and then `db push` finds no local `migrations/` folder and reports *"Remote migration versions not found in local migrations directory"*, listing every existing migration as missing. It then suggests `migration repair --status reverted <all 11 versions>`. **Do not run that.** Nothing is wrong with the history; you are in the wrong directory. `cd` into the repo, re-run `link`, and `db push` works. Check with `db push --dry-run` first — it should name only the migrations you actually added.

**A new table is not reachable through the Data API until you grant it.** `auto_expose_new_tables` is unset in `supabase/config.toml`, which matches the current cloud default: entities created in `public` get no privileges for `anon`/`authenticated`/`service_role` automatically. The older tables here were made while the legacy auto-expose behaviour was still on, so their migrations contain no `grant` and still work — copy one as a template and you get a table that exists and rejects every write, with an error that looks like an RLS problem. `20260922120000_add_activity_reviews.sql` shows the explicit form.

## Commands

```
supabase db push                # apply pending migrations in supabase/migrations/
supabase migration new <name>   # scaffold a migration
supabase migration list         # check local vs remote sync
npm run make-icons              # regenerate PWA icons from tools/make-icons.mjs
```

Deployment is automatic: push to `master`, GitHub Pages rebuilds from `/docs`. There is no test suite and no linter.

**Frontend and database deploy independently.** `docs/index.html` ships via Pages the moment you push; the schema only changes when you run `supabase db push`. The frontend can therefore be newer than the DB — `loadAndApplyProfile()` deliberately retries without newer columns so a missing one degrades to "not set" instead of blanking the whole profile. Add new optional columns to `PROFILE_NEW_COLS`.

---

## Auth quirks — read before touching auth

- **Username-based login on top of Supabase's email/password auth.** Username maps to a placeholder `<username>@mahbaim.app` **only at signup**.
- **Login does not re-derive the email** from the typed username — it looks up the stored `public.users.email` first, then signs in with that. Deliberate fix; don't "simplify" it.
- **Changing a username never touches the Auth email.** `auth.updateUser({email})` is broken in this project — it rejects with a misleading error referencing the *old* email. Username changes only update `user_metadata.username` and `public.users.username`.
- Username rules: starts with a letter, then letters/digits/`_`. Password 6–10 chars.
- **Confirm-email is OFF** in the Supabase dashboard (Authentication → Sign In / Providers → Email) — required, since placeholder emails can't receive mail. No real email is ever sent.
- Guest mode is a pure `localStorage.mb_guest` flag — zero Supabase writes.
- Network failures are separated from bad credentials: `withTimeout()` bounds every call that gates a button, and `isNetworkFailure()` picks the `errServerDown` message. Before this, a paused backend left the sign-in button disabled forever with no message, and otherwise reported the outage as a wrong password.

---

## Database

Schema lives in `supabase/migrations/*.sql`, applied in timestamp order — 13 migrations, local and remote in sync as of 2026-09-22. Several tables were rebuilt after creation, so **read the most recent migration touching a table, not its original `CREATE`.**

Tables: `users`, `activities` (48-field model, 22 seeded rows — 18 fictional, 4 real, see below), `favorites`, `follows`, `user_preferences`, `registrations`, `activity_reviews`. Storage bucket `avatars` (public read, owner-only write, `<user_id>/avatar.<ext>` and `<user_id>/banner.<ext>`).

RLS is on everywhere. Notable: `favorites`'s select policy is wider than owner-only — an accepted follower can read a followee's favourites, which is what powers "friends who saved this". `canViewProfile()` is the single visibility rule the UI and that policy implement in parallel.

`activity_reviews` goes the other way: its select policy is **owner-only**, and everyone else reads through the `activity_reviews_public()` function, which strips the author from anonymous rows before they leave the database. That is what makes the anonymity real rather than cosmetic — do not "simplify" it into a public select policy.

---

## Open loose ends

- **`registrations` exists but is not wired into the UI.** The register CTA opens the organiser's own `registration_url` in a new tab; the app never writes a registration row, and has no attendance data. Don't fabricate any.
- **The activities list is a hardcoded demo array**, not a live query — 22 rows mirroring the seeded table, each carrying its real Supabase `id`. Switching to a live query means matching the field names the array already uses.
- **4 of the 22 activities are real, scraped from live pages 2026-09-22** (migration `20260922130000_seed_real_jerusalem_youth_activities.sql`) — not a content pipeline, a one-time hand-built batch. The municipality's own events page and its `data.gov.il` mirror are just directories of ~26 youth centers (address/phone/link), not activity listings; the real per-activity data lives on each center's own site. Turning this into an ongoing feed needs real crawling infrastructure (Firecrawl or similar) to visit ~26 differently-structured sites on a schedule — not set up yet, and a real design/safety conversation (re-scrape cadence, dedup against `favorites`/`activity_reviews` on existing rows, what "stale" means for a `start_date` that's passed) before it's automated. This batch is the proof that real per-activity data exists and is extractable; it is not the pipeline.
- **A Supabase Personal Access Token was pasted directly into a chat session on 2026-09-22** to authenticate the CLI for the above. Same category of exposure as the loose end below — rotate it (https://supabase.com/dashboard/account/tokens) once it's no longer needed for active work, rather than leaving it live indefinitely.
- **`sector` and `is_accessible`** exist on `activities` but are never surfaced or filterable. Undecided whether they become real features.
- **Profile-picture privacy is UI-level only** — the `avatars` bucket is public-read regardless of `is_private`. Real hardening needs a private bucket with signed URLs. Known and deliberate.
- **A Supabase personal access token and the project's `service_role` key appeared in an old conversation transcript.** Rotating them was suggested and, as far as this file knows, never confirmed done. Worth closing out.
- The repo was renamed once (`mah-baim-app` → `ma-byam_1.0`); renaming again changes the Pages URL.
