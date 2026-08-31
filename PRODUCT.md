# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Teens aged 12–18 in Jerusalem, using the app themselves rather than through a parent/guardian account. *(Inferred from evidence, not confirmed by the product owner — flagged as an open question.)* Evidence: the `user_role` enum has a dedicated `teen` role and no `parent`/`guardian` role anywhere in the schema; the onboarding questionnaire addresses the user in direct second person ("בן/בת כמה אתה?" — "how old are you?"); the age range floor is 12; and there is no parent-mediated account or child-profile-under-parent pattern anywhere in the auth or data model.

## Product Purpose

Let teens in Jerusalem discover activities, clubs ("חוגים"), and events that match their interests, age, and area — search and filter a catalog, then follow through to the organizing body's own registration channel. Currently a working prototype: 18 demo activities mirrored from real seeded Supabase rows, not yet a live content pipeline.

## Positioning

*(Inferred from evidence, not confirmed.)* An independent citywide directory that aggregates activities across many separate Jerusalem providers, rather than one organization listing only its own programming. The seeded organization names span municipal departments (עיריית ירושלים), community centers (מתנ"סים), a municipal science center, private studios (e.g. סטודיו סאונדסקייפ), and NGOs (e.g. עמותת רוח טובה). The data model backs this up structurally: `activities` has no `created_by`/ownership column, and writes are gated by `role` (`organizer`/`admin`) rather than per-organization accounts — meaning listings are centrally curated by a small editorial team, not self-published by each provider. Whether the project is formally affiliated with the Jerusalem municipality or fully independent is not established by the code; the repo/account naming (`noarappproject`, a personal-looking GitHub account) leans independent, but this is not confirmed and should be checked before it drives any official-looking branding decision.

## Operating Context

- Hebrew-first, RTL by default; also available in Arabic (RTL), English, and Russian (LTR) — reflecting Jerusalem's actual population mix.
- Activities span multiple categories (sport, tech, art, music, stage, nature, volunteer, leadership, gaming, learning, wellbeing) sourced from real-world venues: מתנ"סים, municipal sports/culture facilities, a science center, private studios, and community organizations.
- Registration itself happens off-platform: the app's "הרשמה" CTA opens the organizing body's own registration link in a new tab; the app never collects a registration itself (the `registrations` table exists in the schema but isn't wired into the UI — this is a durable, deliberate boundary, not a gap to fill by default).
- Guest browsing is fully supported with zero data collection — a deliberate on-ramp for someone who wants to look before creating an account.

## Capabilities and Constraints

- Search, category/topic filtering, and a one-card swipeable browse UI over the activity catalog, plus a dedicated Favorites list (star/unstar, its own search/filter/sort, full-detail view).
- Account system: username-based signup/login (not email-first), a one-time skippable onboarding questionnaire (age, grade, area, interests), a profile with avatar, and Settings (theme, text size, language, sign-out).
- Terminology: an "activity" (`item_kind`) is a recurring/scheduled offering; an "event" is typically one-off. `schedule_type` distinguishes one-time / series / recurring.
- Undecided product facts, currently dormant in the schema:
  - `sector` (general/religious/haredi/arab) exists as a column on `activities` but has no value in the current demo data and is not filterable or displayed anywhere in the UI.
  - `is_accessible` / `accessibility_note` are populated on demo activities but are likewise never displayed or filterable — the in-app "Accessibility" settings screen only controls the viewer's own text size, not activity filtering.
  - Whether these become first-class commitments (e.g. a sector filter, an accessibility badge/filter) or stay dormant fields is not decided by the product owner as of this writing.
- Demo dataset only (18 sample activities) — not a real content pipeline yet.
- No real email is ever sent or received, by design (placeholder emails back Supabase Auth internally).

## Brand Commitments

Name: "מה בי״ם" (Mah Ba'im). No other confirmed brand voice, personality, or visual-identity commitments exist beyond what's implemented in the current UI.

## Evidence on Hand

- 18 real seeded rows in the Supabase `activities` table (mirrored into the frontend's demo array).
- Test account: `admin` / `123456`, plus several throwaway test accounts from development — none of these are real users or real usage data.
- No testimonials, case studies, press coverage, or analytics/usage data exist. Do not fabricate any of these in future work.

## Product Principles

*(Derived from the above; not separately confirmed by the product owner.)*

1. Self-directed teen use, not parent-mediated — flows and copy should assume the teen themself is at the keyboard.
2. Aggregator, not originator — the product's value is bringing together listings from many independent Jerusalem providers, not hosting its own programming.
3. Low-friction entry — guest browsing with zero signup, a skippable onboarding questionnaire, and no data collection until the user opts in.
4. Off-platform registration is a durable constraint, not a gap to rush past — actual signup/payment happens on the organizing body's own channel.
5. Multilingual and multi-community by default — four shipped languages, and a `sector` field for religious/cultural community targeting already exists in the data model even though it isn't surfaced yet.

## Accessibility & Inclusion

Adjustable text size and RTL/LTR-correct layouts across all four languages are shipped baseline commitments. Per-activity physical/program accessibility (`is_accessible`) is captured in the data model but is not yet a UI-level commitment — see the open question under Capabilities and Constraints.
