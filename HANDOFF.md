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

**`demo_noa1` / `demo1234`** and **`demo_itay1` / `demo1234`** — created 2026-09-22 specifically to make "friends who saved this" demonstrable. Before these, the *entire* database had exactly one follow relationship with an overlapping favorite (`testuser_mb1` → `socialA1`, one activity, buried at position 4 of a rail — practically invisible during normal browsing, which is why the feature looked broken). Both are public accounts (`is_private = false`); `testuser_mb1` follows both. Their original favourites pointed at demo activities that were deleted on 2026-09-23, so the feature shows nothing until they favourite some real ones. If this data disappears (or you want it seeded elsewhere), it's cheap to reproduce: sign up, flip privacy off in Settings, favorite a few activities, follow from `testuser_mb1`.

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
- **Reviews** — a 1–5 star rating and an optional 100-character note on the activity detail sheet. Anyone can read them, including guests; writing needs an account. A review posts under the writer's name unless they tick "anonymously" — anonymity is opt-in, though the database column still defaults to it on purpose (see `CLAUDE.md`). Either way it is enforced in the database, not the UI. Added 2026-09-22: write, edit, delete and a guest write correctly rejected by RLS were verified against the live backend from a local server, and the guest read path was verified again on the deployed Pages site after release.
- **Favourites, Profile (with channel-style banner), Settings, Accessibility, Social** — all working
- **Guest mode** — keeps working **while the backend is down**, provided the device has connected successfully once: the activity list is read from the database and the last good copy is stored locally, and guest prefs are localStorage. A device that has *never* connected and hits a paused backend gets a short "server unavailable, try later" card with a retry button — not an empty-looking catalog. (Before 2026-09-23 the list was a hardcoded array, so this worked even on a device's first visit; that array could not follow the scraper, so it was retired.)
- **i18n** — he / ar / en / ru, 259 keys, all four blocks at parity
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
- **Every activity comes from the scraper; nothing is hand-entered.** On 2026-09-23 the 18 invented demo rows and the hand-built batch were deleted (migration `20260923130000`), taking their favourites and 3 reviews with them. That includes the `demo_noa1`/`demo_itay1` favourites that made "friends who saved this" visible — re-favourite a few real activities from those accounts if you need it demonstrable again.
- **The table holds 29 activities as of 2026-09-23**, each with weekdays, hours, a price and a signup link read from its own page (21 link straight into hugim.org.il). Getting there deleted every row that lacked one of those or whose facts had come from the model.
- **A Supabase Personal Access Token and a Firecrawl API key were both pasted directly into a chat session on 2026-09-22.** The Supabase token authenticated the CLI for the work below; the Firecrawl key is stored as the `FIRECRAWL_API_KEY` project secret, not in any file. Same category of exposure either way — rotate both (https://supabase.com/dashboard/account/tokens and https://www.firecrawl.dev/ dashboard) once they're no longer needed for active work, rather than leaving them live indefinitely. If the Firecrawl key is rotated, update the secret with `supabase secrets set FIRECRAWL_API_KEY=<new key>` or the scraper starts failing every run.

## The activity scraper — how it actually runs

`supabase/functions/scrape-activities/`: `index.ts` (the Edge Function) and **`sources.json` — the list of listing pages it reads, the one place sources live.** Two stages, and only the second is trusted with facts:

1. **Firecrawl finds the items** on each listing page — titles, ages, links (5 credits a page).
2. **`parseClubPage()` reads each item's own page** — deterministic code, no model — for weekdays, hours, price, season dates, a description and the signup link (usually `hugim.org.il`, the community centers' registration system). Pages are fetched directly, which is free; Talpaz answers Supabase's servers with 403 and the Israel Museum serves them a page without its course blocks, so those two go through Firecrawl as raw HTML (1 credit a page).

A row is stored only if its own page yielded **ages overlapping 12–18, weekdays and hours (or a date and hour for a one-off), a price (0 only when the page says free), a signup link and a location**, the page is recognisably about that activity (half the title's distinctive words appear on it), and its season hasn't ended. Anything else is skipped at scrape time and **deleted** by `?recheck=1`.

- **Why the model is not trusted with facts:** checked against the pages on 2026-09-23, it had given the museum's teen animation course "Sun+Tue+Thu 16:00, ₪1,200" (the page says Wednesday 18:30–20:30, ₪2,800), given all four French Hill clubs a Monday that is nowhere on their page, invented an `example.com` signup link, attached zumba's name to a 3rd–4th-grade hip hop page, stored "ד-ה" (ages 9–10) as 12–18 and "ב+ד" (Mon+Wed) as Sun+Tue. The Beit HaKerem pages themselves write "ימים: א'-ה'" when their schedule table says Sunday and Thursday — the parser reads the table.
- **A source stays only if a parser exists for its item pages.** There are now 9 (7 community-center pages and the museum). Removed on 2026-09-23 because their facts cannot be verified automatically: מיטרים, אשכול בגבעה (French Hill — its table has hours and price but no weekday), תיאטרון מחול ירושלים, the Academy conservatory, תיאטרון הקרון, האוניברסיטה העברית לנוער (×2), בית הנוער העברי. Adding one back means writing and checking a parser for its item pages first.
- **Schedule:** `pg_cron` job `scrape-activities-batch`, `*/3 3 * * 0` — every 3 minutes, 03:00–03:57 UTC, **Sundays only**, one source per call; the calls after the last source run cleanup and de-duplication. Progress per source is in `scrape_runs`.
- **Budget:** ~45 credits for the listings plus ~6 for the Firecrawl fallbacks, so **~50 a week, ~215 a month**, against **1,000 a month** (renews on the 22nd). `?dry=1` runs report the remaining credits.
- **Auth:** header `x-scraper-secret` = the `SCRAPER_SECRET` function secret; the cron reads the same value from Vault (`scraper_secret`), so it never appears in this public repo. To rotate: `supabase secrets set SCRAPER_SECRET=<new>` **and** `select vault.update_secret((select id from vault.secrets where name='scraper_secret'), '<new>')` — change only one and every run gets 401.
- **Run by hand** (needs the secret): `POST .../functions/v1/scrape-activities` → the next unrun source; `?source=<n>&dry=1` → one source, no writes; `?recheck=1&offset=0&limit=20` → re-read every stored row's page and re-apply the gate, **deleting** rows that fail (`&dry=1` previews them with the reason). Deletion shifts offsets, so start the next batch at `offset + checked − deleted`.
- **Cleanup** only unpublishes a row that merely went missing from a listing (unseen for 15 days while its source succeeded), because the listing extraction misses items from run to run — especially on Beit HaKerem's ~170k-character page. That keeps the row's id, favourites and reviews.
- **Titles are cleaned by `cleanTitle()`**, after the facts have been read from the original: weekday shorthand ("א+ה", "יום א'", "פעמיים") and prices come out because they have their own rows, a repeated "קארטה - קארטה" prefix is dropped, and bare grade ranges are spelled out ("ט-י" → "כיתות ט'-י'"). Two different classes can therefore share a title and differ only in days, hours or price.
- **Not scrapeable:** `jerusalem.muni.il` — every Firecrawl engine fails — which is also where "בירת הנוער" is published.
- **Not yet built:** unpublishing a row whose source activity disappears (today it just stops refreshing, silently).
- **`sector` and `is_accessible`** exist on `activities` but are never surfaced or filterable. Undecided whether they become real features.
- **Profile-picture privacy is UI-level only** — the `avatars` bucket is public-read regardless of `is_private`. Real hardening needs a private bucket with signed URLs. Known and deliberate.
- **A Supabase personal access token and the project's `service_role` key appeared in an old conversation transcript.** Rotating them was suggested and, as far as this file knows, never confirmed done. Worth closing out.
- The repo was renamed once (`mah-baim-app` → `ma-byam_1.0`); renaming again changes the Pages URL.
