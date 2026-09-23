// Weekly activity scraper.
//
// Each source in sources.json is a LISTING page (a community center's clubs
// page, a museum's courses page…). Firecrawl reads the page and returns every
// club, course, workshop, show or event on it as structured JSON; this function
// keeps the ones whose stated ages overlap 12–18 and upserts them into
// `activities`, keyed on each item's own page URL. Schedule fields are stored
// only when the page states them.
//
// ONE SOURCE PER INVOCATION. A listing page can take Firecrawl a minute or more,
// and the Edge Function wall clock is 150 s, so the cron calls this every 3
// minutes during a weekly early-morning window and each call takes the next
// source that has not run today (tracked in `scrape_runs`). Once every source
// has run, further calls do the cleanup pass and return.
//
// WEEKLY, NOT DAILY: each listing extraction costs 5 Firecrawl credits, so a full
// pass over sources.json costs ~5 × its length. Daily would be ~30× that a month;
// the current plan has 1,000 credits a month.
//
// CLEANUP never deletes. An item missing from today's extraction may just be an
// extraction miss — the extraction is LLM-based and not identical run to run —
// so a row is only unpublished after its source has succeeded while the row
// went unseen for STALE_DAYS. Unpublishing keeps the row's id, so favourites
// and reviews survive if the item comes back.
//
// AUTH: every call must carry `x-scraper-secret` matching the SCRAPER_SECRET
// secret. The cron reads it from Vault (never from this repo). Without it, the
// public anon key alone would let anyone trigger paid Firecrawl extractions.
//
// Manual use:  POST ?source=<index>&dry=1  → extract one source, write nothing.
//              POST ?recheck=1              → re-apply refine() to every stored row
//                                             (after a rule change; costs no credits).

// Pinned: an unpinned @2 once resolved to a release published minutes earlier
// whose dependency tarball was not on npm yet, and every deploy failed to bundle.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import SOURCES from "./sources.json" with { type: "json" };

type Source = { organization: string; neighborhood: string | null; url: string; page_ages?: [number, number] };

// Runs are weekly, so an item has to be missing from two runs in a row before it goes.
const STALE_DAYS = 15;
const CATEGORIES = ["sport", "tech", "art", "music", "stage", "nature", "volunteer", "leadership", "learning", "gaming", "wellbeing"];

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The item's name exactly as written on the page." },
    kind: { type: "string", enum: ["club", "course", "workshop", "event", "show", "camp", "other"],
      description: "club = weekly recurring חוג; event/show = a one-off happening on a date." },
    category: { type: "string", enum: CATEGORIES,
      description: "sport, tech (computers/robotics/science), art (visual arts/crafts), music (instruments/singing), stage (theater, drama, and ALL dance incl. hip hop/jazz/ballet, circus), nature, volunteer, leadership (youth movements/leadership), learning (languages/study/enrichment), gaming (board/role-playing/e-sports), wellbeing (yoga/mindfulness/health)." },
    topics: { type: "array", items: { type: "string" }, description: "1–3 short Hebrew words that literally appear for this item, e.g. 'היפ הופ', 'כדורסל'." },
    short_description: { type: "string", description: "One factual sentence under 140 characters using only words and facts on the page for this item. Never substitute a similar place or person name." },
    age_min: { type: "integer", description: "Minimum age. Convert grades with age = grade + 5: א'=6, ב'=7, ג'=8, ד'=9, ה'=10, ו'=11, ז'=12, ח'=13, ט'=14, י'=15, יא=16, יב=17. '13-18' → 13. Omit if not stated for this item." },
    age_max: { type: "integer", description: "Maximum age, converted the same way ('ז'-ט'' → 14, '13-18' → 18). Omit if open-ended ('ומעלה', '+') or not stated." },
    day_indices: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "Weekdays it meets, 0=Sunday(א') … 6=Saturday(ש'). Omit for a one-off." },
    start_time: { type: "string", description: "HH:MM 24h. Omit if the page gives no time." },
    end_time: { type: "string", description: "HH:MM 24h. Omit if not stated." },
    date: { type: "string", description: "YYYY-MM-DD for a one-off event/show, or the stated start date of a course. Omit otherwise." },
    price_ils: { type: "number", description: "Price in NIS if stated for this item. Omit if not stated — never guess." },
    price_period: { type: "string", enum: ["monthly", "total", "per_session"], description: "What the price covers, only if the page says." },
    location_name: { type: "string", description: "Venue for this item if written on the page, else omit." },
    link: { type: "string", description: "URL of this item's own detail/registration page, if the page links one." },
    image_url: { type: "string", description: "URL of this item's own picture on the page, if any." },
  },
  required: ["title"],
};

const EXTRACT = {
  type: "json",
  schema: { type: "object", properties: { activities: { type: "array", items: ITEM_SCHEMA } } },
  prompt: "List every activity, club, course, workshop, show or event on this page that is open to teenagers aged 12–18 (grades ז'–יב'), including ones open to teens together with adults. Leave out items only for younger children or only for adults (18+). Copy titles and names exactly as written. Never invent a value: omit any field the page does not state for that item.",
};

type Item = {
  title?: string; kind?: string; category?: string; topics?: string[]; short_description?: string;
  age_min?: number; age_max?: number; day_indices?: number[]; start_time?: string; end_time?: string;
  date?: string; price_ils?: number; price_period?: string; location_name?: string; link?: string; image_url?: string;
};

// Third-party text, rendered by the app through innerHTML: no club name needs an
// angle bracket, so none reaches the table. The app escapes on load as well.
const text = (s: unknown) => {
  if (typeof s !== "string") return undefined;
  const t = s.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return t || undefined;
};
// The model sometimes returns 0 or 99 as stand-ins for "no limit"; neither is a real age here.
const age = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 25 ? n : undefined);
const hhmm = (s: unknown) => { const m = typeof s === "string" && s.match(/^(\d{1,2}):(\d{2})/); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined; };
const ymd = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : undefined);

function absUrl(u: unknown, base: string): string | undefined {
  if (typeof u !== "string" || !u.trim()) return undefined;
  try {
    const url = new URL(u.trim(), base);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    url.hash = "";
    url.searchParams.delete("ht"); // matnasnet repeats the URL-encoded title here; it varies, the id doesn't
    return url.href;
  } catch { return undefined; }
}

// ---- Facts read from the title itself ----
// Matnasnet titles carry the real facts: "כדורגל ט'-י' ב+ד", "היפ הופ 13-18",
// "טאקוונדו כיתות ה ומעלה". The model reads these wrongly often enough — it has
// stored "ד-ה" (grades 4–5, ages 9–10) as 12–18 and "ב+ד" (Mon+Wed) as Sun+Tue —
// that anything parseable from the title is parsed here, deterministically, and
// overrides the model. Same title in, same facts out, every run.
const GRADE: Record<string, number> = { "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10, "יא": 11, "יב": 12 };
const DAY: Record<string, number> = { "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5, "ש": 6 };
const G = `(י["״']?[אב]|[א-ט]|י)['׳]?`;           // one grade token: ז, ז', י"א, יב…
const L = `(?<![א-ת"״'׳])`, R = `(?![א-ת"״'׳])`;  // not glued to other Hebrew letters
const grade = (t: string) => GRADE[t.replace(/["״'׳]/g, "")];
const toAge = (g: number) => g + 5;                  // ז' (7th grade) = 12

function agesFromTitle(t: string): [number | null, number | null] | null {
  let m = t.match(new RegExp(`${L}${G}\\s*[-–]\\s*${G}${R}`));
  if (m && grade(m[1]) && grade(m[2])) {
    const [a, b] = [grade(m[1]), grade(m[2])].sort((x, y) => x - y);
    return [toAge(a), toAge(b)];
  }
  m = t.match(/(?<!\d)(\d{1,2})\s*[-–]\s*(\d{1,2})(?!\d)/);
  if (m) {
    const [a, b] = [+m[1], +m[2]].sort((x, y) => x - y);
    if (a >= 5 && b <= 25) return [a, b];
  }
  m = t.match(/(?<!\d)(\d{1,2})\s*(?:\+|ומעלה)/);
  if (m && +m[1] >= 5 && +m[1] <= 25) return [+m[1], null];
  m = t.match(new RegExp(`${L}${G}\\s*ומעלה`));
  if (m && grade(m[1])) return [toAge(grade(m[1])), null];
  m = t.match(new RegExp(`כית(?:ה|ות)\\s+${G}${R}`));
  if (m && grade(m[1])) return [toAge(grade(m[1])), toAge(grade(m[1]))];
  return null;
}

function daysFromTitle(t: string): number[] | null {
  const m = t.match(/(?<![א-ת])([א-ו])['׳]?\s*\+\s*([א-ו])['׳]?(?![א-ת])/);
  if (m) return [DAY[m[1]], DAY[m[2]]].sort((x, y) => x - y);
  const d = t.match(/יום\s+([א-ו]|שבת)['׳]?(?![א-ת])/);
  if (d) return [d[1] === "שבת" ? 6 : DAY[d[1]]];
  return null;
}

const ADULT = /נשים|גברים|מבוגרים|הורים|גיל הזהב|גמלאים|אזרחים ותיקים/;
const YOUTH = /נוער|נער|נערות|נערים|תיכון|מתבגר/;
const STAGE = /מחול|ריקוד|היפ ?הופ|ג'אז|ג׳אז|בלט|דרמה|תיאטרון|תאטרון|משחק מול מצלמה|אקרובטיקה אווירית|קרקס/;

type Row = Record<string, unknown> & {
  title: string; age_min: number | null; age_max: number | null; category: string;
  recurrence_days: number[] | null; recurrence_freq: string; start_time: string | null; end_time: string | null;
};

// The one set of rules every row passes, fresh from the model or already stored.
function refine(r: Row, pageAges?: [number, number]): { row: Row } | { skip: string } {
  const t = r.title;
  if (t.replace(/\s/g, "").length < 4) return { skip: "title too short" };
  if (/[?？]\s*$/.test(t)) return { skip: "article, not an activity" };
  const year = t.match(/(?<!\d)(20\d\d)(?!\d)/);
  if (year && +year[1] < new Date().getUTCFullYear()) return { skip: "past year in title" };

  const parsed = agesFromTitle(t);
  let lo = parsed ? parsed[0] : r.age_min, hi = parsed ? parsed[1] : r.age_max;
  if (lo == null && hi == null && pageAges) [lo, hi] = pageAges;
  if (!parsed && ADULT.test(t) && !YOUTH.test(t)) return { skip: "adults" };
  if (lo == null && hi == null) return { skip: "no ages" };
  if ((lo ?? 0) > 17 || (hi ?? 99) < 12) return { skip: "not 12–18" };
  if (lo != null && hi != null && lo > hi) return { skip: "bad ages" };

  // "00:00" is the model's placeholder for "no time on the page", not a time.
  const start = r.start_time && !/^00:00/.test(r.start_time) ? r.start_time : null;
  // A run of four-plus weekdays is what the model writes when it doesn't know
  // the days; a teen club meeting that often is rare enough to drop instead.
  let days = daysFromTitle(t) ?? r.recurrence_days;
  if (days && (days.length === 0 || days.length >= 4)) days = null;
  const recurring = r.recurrence_freq !== "none" || r.schedule_type === "recurring";

  return {
    row: {
      ...r,
      age_min: lo ?? null,
      age_max: hi ?? null,
      start_time: start,
      end_time: start ? r.end_time : null,
      recurrence_days: recurring ? days : null,
      recurrence_freq: recurring && days ? "weekly" : "none",
      category: STAGE.test(t) ? "stage" : r.category,
    },
  };
}

function toRow(it: Item, src: Source, today: string) {
  const title = text(it.title);
  if (!title) return { skip: "no title" };

  const date = ymd(it.date);
  const oneOff = it.kind === "event" || it.kind === "show";
  if (oneOff && !date) return { skip: "event without date" };
  if (oneOff && date! < today) return { skip: "past event" };

  const page = new URL(src.url).href;
  const link = absUrl(it.link, page);
  // 0 is what the model returns for "no price on the page"; publishing it would say "free".
  const price = typeof it.price_ils === "number" && it.price_ils > 0 ? it.price_ils : null;
  const desc = text(it.short_description)?.slice(0, 140);
  const start = hhmm(it.start_time) ?? null;
  const days = [...new Set((it.day_indices ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();

  const refined = refine({
    item_kind: oneOff ? "event" : "activity",
    schedule_type: oneOff ? "one_time" : "recurring",
    category: CATEGORIES.includes(it.category ?? "") ? it.category! : "learning",
    topics: (it.topics ?? []).map(text).filter(Boolean).slice(0, 3),
    title,
    short_description: desc ?? null,
    description: desc ?? title,
    organization_name: src.organization,
    start_time: start,
    end_time: start ? hhmm(it.end_time) ?? null : null,
    end_date: null,
    recurrence_freq: oneOff ? "none" : "weekly",
    recurrence_days: oneOff ? null : days,
    attendance_mode: "onsite",
    location_name: text(it.location_name) ?? src.organization,
    neighborhood: src.neighborhood,
    age_min: age(it.age_min) ?? null,
    age_max: age(it.age_max) ?? null,
    price,
    price_period: price == null ? null : (["monthly", "total", "per_session"].includes(it.price_period ?? "") ? it.price_period : oneOff ? "total" : "monthly"),
    registration_required: true,
    registration_url: link ?? page,
    image_url: absUrl(it.image_url, page) ?? null,
    status: "open",
    is_published: true,
    // Items without their own page share the listing URL, so the title keeps them apart.
    source_url: link ?? `${page}#${encodeURIComponent(title)}`,
    source_name: src.organization,
    source_page: src.url,
    last_seen_at: new Date().toISOString(),
  }, src.page_ages);
  if ("skip" in refined) return refined;
  // Only a date the page actually states. A club with none gets null — not the
  // day it was first scraped, which the detail screen would print as its season start.
  return { row: refined.row, start_date: date ?? null };
}

async function extract(url: string, key: string) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: new URL(url).href, formats: [EXTRACT], onlyMainContent: true, timeout: 110000 }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(`Firecrawl ${res.status}: ${String(body.error ?? "").slice(0, 200)}`);
  return (body.data?.json?.activities ?? []) as Item[];
}

async function credits(key: string) {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/team/credit-usage", { headers: { Authorization: `Bearer ${key}` } });
    const b = await r.json();
    return b.data ?? null;
  } catch { return null; }
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o, null, 1), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("SCRAPER_SECRET");
  if (!secret || req.headers.get("x-scraper-secret") !== secret) return json({ error: "unauthorized" }, 401);
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return json({ error: "FIRECRAWL_API_KEY not set" }, 500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const sources = SOURCES as Source[];
  const today = new Date().toISOString().slice(0, 10);
  const params = new URL(req.url).searchParams;
  const dry = params.get("dry") === "1";

  if (params.get("recheck") === "1") return json({ recheck: await recheck(sb, sources) });

  let index: number;
  if (params.has("source")) {
    index = Number(params.get("source"));
    if (!Number.isInteger(index) || !sources[index]) return json({ error: "no such source" }, 400);
  } else {
    const { data: runs, error } = await sb.from("scrape_runs").select("source_url").eq("last_run_on", today);
    if (error) return json({ error: error.message }, 500);
    const done = new Set((runs ?? []).map(r => r.source_url));
    index = sources.findIndex(s => !done.has(s.url));
    if (index < 0) return json({ cleanup: await cleanup(sb, sources, today) });
  }

  const src = sources[index];
  const t0 = Date.now();
  try {
    const items = await extract(src.url, key);
    const seen = new Map<string, ReturnType<typeof toRow>>();
    const skipped: Record<string, number> = {};
    for (const it of items) {
      const r = toRow(it, src, today);
      if ("skip" in r) { skipped[r.skip!] = (skipped[r.skip!] ?? 0) + 1; continue; }
      seen.set(r.row!.source_url, r);
    }
    const kept = [...seen.values()];

    if (dry) return json({ source: index, url: src.url, found: items.length, kept: kept.map(k => ({ ...k.row, start_date: k.start_date })), skipped, sample: items.slice(0, 4), credits: await credits(key) });

    // A date stated today wins; otherwise a row keeps the date it already had. Looked up by organization rather than by an IN over every
    // URL, which would run past query-string limits on a long listing.
    const { data: existing, error: exErr } = await sb.from("activities")
      .select("source_url, start_date").eq("source_name", src.organization).not("source_url", "is", null);
    if (exErr) throw exErr;
    const firstDate = new Map((existing ?? []).map(e => [e.source_url as string, e.start_date as string]));
    const rows = kept.map(k => ({ ...k.row, start_date: k.start_date ?? firstDate.get(k.row!.source_url) ?? null }));
    const inserted = rows.filter(r => !firstDate.has(r.source_url)).length;
    const updated = rows.length - inserted;
    if (rows.length) { const { error } = await sb.from("activities").upsert(rows, { onConflict: "source_url" }); if (error) throw error; }

    await sb.from("scrape_runs").upsert({ source_url: src.url, last_run_on: today, last_run_at: new Date().toISOString(),
      last_status: "ok", found: items.length, kept: kept.length, inserted, updated, skipped, last_error: null });
    return json({ source: index, organization: src.organization, found: items.length, inserted, updated, skipped, ms: Date.now() - t0 });
  } catch (err) {
    if (!dry) await sb.from("scrape_runs").upsert({ source_url: src.url, last_run_on: today, last_run_at: new Date().toISOString(),
      last_status: "error", last_error: String(err).slice(0, 500) });
    return json({ source: index, organization: src.organization, error: String(err), ms: Date.now() - t0 }, 502);
  }
});

// Unpublish rows that a source which succeeded today has not produced for STALE_DAYS.
async function cleanup(sb: ReturnType<typeof createClient>, sources: Source[], today: string) {
  const { data: okRuns } = await sb.from("scrape_runs").select("source_url").eq("last_run_on", today).eq("last_status", "ok");
  const okPages = (okRuns ?? []).map(r => r.source_url).filter(u => sources.some(s => s.url === u));
  if (!okPages.length) return { unpublished: 0 };
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const { data, error } = await sb.from("activities").update({ is_published: false })
    .in("source_page", okPages).lt("last_seen_at", cutoff).eq("is_published", true).select("id");
  return error ? { error: error.message } : { unpublished: data?.length ?? 0 };
}

// Re-run the deterministic rules over rows already in the table: a row that no
// longer passes, or whose source was removed from sources.json, is unpublished;
// one whose title-derived facts differ from what is stored is corrected.
async function recheck(sb: ReturnType<typeof createClient>, sources: Source[]) {
  const cols = "id, title, age_min, age_max, category, recurrence_days, recurrence_freq, schedule_type, start_time, end_time, source_page, is_published";
  const { data, error } = await sb.from("activities").select(cols).not("source_page", "is", null);
  if (error) return { error: error.message };
  const out = { checked: 0, corrected: 0, unpublished: 0, reasons: {} as Record<string, number> };
  for (const r of data ?? []) {
    out.checked++;
    const src = sources.find(s => s.url === r.source_page);
    const res = src ? refine({ ...r, start_time: r.start_time ? String(r.start_time).slice(0, 5) : null, end_time: r.end_time ? String(r.end_time).slice(0, 5) : null } as never, src.page_ages)
                    : { skip: "source removed" };
    if ("skip" in res) {
      out.reasons[res.skip] = (out.reasons[res.skip] ?? 0) + 1;
      if (r.is_published) { await sb.from("activities").update({ is_published: false }).eq("id", r.id); out.unpublished++; }
      continue;
    }
    const f = res.row;
    const patch = { age_min: f.age_min, age_max: f.age_max, category: f.category, recurrence_days: f.recurrence_days,
      recurrence_freq: f.recurrence_freq, start_time: f.start_time, end_time: f.end_time };
    const stored = { age_min: r.age_min, age_max: r.age_max, category: r.category, recurrence_days: r.recurrence_days,
      recurrence_freq: r.recurrence_freq, start_time: r.start_time ? String(r.start_time).slice(0, 5) : null,
      end_time: r.end_time ? String(r.end_time).slice(0, 5) : null };
    if (JSON.stringify(patch) !== JSON.stringify(stored)) { await sb.from("activities").update(patch).eq("id", r.id); out.corrected++; }
  }
  return out;
}
