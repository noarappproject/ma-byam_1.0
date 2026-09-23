// Weekly activity scraper.
//
// Each source in sources.json is a LISTING page (a community center's clubs
// page, a museum's courses page…). Firecrawl reads the page and returns every
// club, course, workshop, show or event on it as structured JSON; this function
// keeps the ones whose ages overlap 12–18. Firecrawl only FINDS the items and
// their links: each item's days, hours, price, season, description and signup
// link are then read off its own page by parseClubPage(), deterministic code,
// and an item whose page doesn't yield them is not stored (see refine()).
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
// CLEANUP unpublishes rather than deletes a row that has merely gone missing:
// the listing extraction is LLM-based and misses items run to run, so a row is
// only hidden after its source has succeeded while the row went unseen for
// STALE_DAYS, and it keeps its id — favourites and reviews survive if it comes
// back. Rows that FAIL THE GATE are a different case and are deleted.
//
// AUTH: every call must carry `x-scraper-secret` matching the SCRAPER_SECRET
// secret. The cron reads it from Vault (never from this repo). Without it, the
// public anon key alone would let anyone trigger paid Firecrawl extractions.
//
// Manual use:  POST ?source=<index>&dry=1       → extract one source, write nothing.
//              POST ?recheck=1&offset=0&limit=25 → re-read club pages and re-apply the
//                 gate to stored rows; rows that fail are deleted (add &dry=1 to preview).
//                 Free, except 1 credit per page a site refuses to serve directly.

// Pinned: an unpinned @2 once resolved to a release published minutes earlier
// whose dependency tarball was not on npm yet, and every deploy failed to bundle.
import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import SOURCES from "./sources.json" with { type: "json" };

// The tables have no generated types here, so the client is left untyped rather
// than typed as never for every table.
// deno-lint-ignore no-explicit-any
type Sb = any;

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

// A link the model gives for an item is only believed if it points at the
// source's own site: it has returned a made-up example.com URL, and mangled
// windows-1255 links into U+FFFD soup. Signup links may also go to hugim.org.il,
// the registration system the community centers use.
const bareHost = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const sameSite = (u: string, page: string) => bareHost(u) !== "" && bareHost(u) === bareHost(page);
const signupOk = (u: string, page: string) => sameSite(u, page) || bareHost(u) === "hugim.org.il";
const garbled = (u: string) => /%EF%BF%BD/i.test(u);

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

// The title a teen sees. Community-center titles pack the schedule into the
// name in shorthand — "כדור רגל - כדורגל ט-י א+ה" is grades 9–10 on Sunday and
// Thursday, not a readable name. The days are already shown in their own row,
// so they come out; who it is for stays, spelled out. Only after the facts
// have been read from the original title.
const DAY_BITS = [
  /(?<![א-ת])ימים?\s*:?\s*[א-ו]['׳]?(?:\s*[+,\-–]\s*[א-ו]['׳]?)*(?![א-ת])/g,
  /(?<![א-ת])[א-ו]['׳]?\s*\+\s*[א-ו]['׳]?(?:\s*\+\s*[א-ו]['׳]?)*(?![א-ת])/g,
  /(?<![א-ת])יום\s+(?:[א-ו]['׳]?|שבת)(?![א-ת])/g,
  /(?<![א-ת])(?:פעמיים|פעם)(?:\s+ב?שבוע)?(?![א-ת])/g,
  /(?<![\d])\d[\d,]*\s*(?:₪|ש["״'׳]?ח|ש['׳])(?![א-ת])/g, // a price, shown in its own row
];
const gradeName = (tok: string) => {
  const g = tok.replace(/["״'׳]/g, "");
  return g.length === 2 ? `${g[0]}"${g[1]}` : `${g}'`;
};
function cleanTitle(t: string): string {
  let s = t;
  for (const re of DAY_BITS) s = s.replace(re, " ");
  // "קארטה - קארטה נוער" / "טוקוונדו - טוקוונדו גילאי 11-14": drop the repeated prefix.
  const parts = s.split(/\s+[-–]\s+/);
  const bare = (x: string) => x.replace(/["'׳״\s]/g, "");
  if (parts.length >= 2 && bare(parts[1]).startsWith(bare(parts[0]))) s = parts.slice(1).join(" - ");
  // A bare grade range reads as letters; say they are grades.
  s = s.replace(new RegExp(`(?<!כית(?:ה|ות)\\s*)${L}${G}\\s*[-–]\\s*${G}${R}`), (_m, a, b) => {
    const [x, y] = grade(a) <= grade(b) ? [a, b] : [b, a];
    return `כיתות ${gradeName(x)}-${gradeName(y)}`;
  });
  s = s.replace(new RegExp(`(?<!כית(?:ה|ות)\\s*)${L}${G}\\s*ומעלה`), (_m, a) => `מכיתה ${gradeName(a)} ומעלה`);
  s = s.replace(/\s+/g, " ").replace(/\s*[-–]\s*$/, "").replace(/^\s*[-–]\s*/, "").replace(/\s+([,.)])/g, "$1").trim();
  return s || t;
}

function daysFromTitle(t: string): number[] | null {
  const m = t.match(/(?<![א-ת])([א-ו])['׳]?\s*\+\s*([א-ו])['׳]?(?![א-ת])/);
  if (m) return [DAY[m[1]], DAY[m[2]]].sort((x, y) => x - y);
  const d = t.match(/יום\s+([א-ו]|שבת)['׳]?(?![א-ת])/);
  if (d) return [d[1] === "שבת" ? 6 : DAY[d[1]]];
  return null;
}

// ---- Facts read from the club's own page ----
// Listing pages rarely state days, hours or price; each club's own page on the
// community centers' shared platform always does, plus its season dates, its
// description and its link into the signup system. Those pages are plain HTML,
// fetched directly — no Firecrawl credits — and parsed without a model.
// Pages this parser has been checked against: the community centers' shared
// platform (page.php?type=hug&id=…) and the Israel Museum's course pages. Only
// these can supply a row's facts; see refine() for why nothing else may.
const isClubPage = (u: string) =>
  (/\/page\.php\?/.test(u) && /[?&]type=hug(&|$)/.test(u)) || /imj\.org\.il\/he\/node\/\d+\?courses=\d+/.test(u);
const DAY_NAMES: Record<string, number> = { "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6 };
const DAY_LINE = /^(?:יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?![א-ת])/;
const HOURS = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/;
const two = (h: string, m: string) => `${h.padStart(2, "0")}:${m}`;

function decodeHtml(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function htmlLines(html: string) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d|span|a)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Prose that says something about the activity. Schedule, price and rules
// text are dropped — they are shown in their own rows and a copy in prose can
// disagree with them — and so is a description about young children, which
// one site copies from another club onto teen pages ("קראטה גן-כיתה א").
const PRICE_BIT = /(?:מחיר|עלות)[^.\n]{0,25}?\d[\d,]*\s*(?:₪|ש"ח|ש״ח)?|\d[\d,]*\s*(?:₪|ש"ח|ש״ח)/g;
function cleanDescription(s: string, org: string) {
  const kept = s.split(/(?<=[.!?])\s+|\n/).map(x => x.trim())
    .filter(x => x && !/תקנון|הצהרת נגישות/.test(x) && !HOURS.test(x) && !/^(מחיר|עלות|ימים|שעות|כיתות)\s*:/.test(x));
  const out = kept.join(" ").replace(PRICE_BIT, "").replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").trim();
  const ages = agesFromTitle(out) ?? (/(?<![א-ת])גן(?![א-ת])/.test(out) ? [3, 6] as [number, number] : null);
  if (ages && (ages[1] ?? 99) < 12) return undefined;
  return out.length >= 20 && out !== org && !/^page description$/i.test(out) ? out.slice(0, 600) : undefined;
}

// The description a row is stored with: cleaned the same way, kept even when
// short ("חוג תפירה לתלמידים בכיתות ז-ט"), but replaced by the title when it is
// about young children or says nothing once schedule and price are removed.
function descFor(raw: unknown, org: string, title: string) {
  const s = String(raw ?? "");
  const full = cleanDescription(s, org);
  if (full) return full;
  const short = s.split(/(?<=[.!?])\s+|\n/).filter(x => !HOURS.test(x) && !/תקנון/.test(x)).join(" ")
    .replace(PRICE_BIT, "").replace(/\s+/g, " ").trim();
  const ages = agesFromTitle(short) ?? (/(?<![א-ת])גן(?![א-ת])/.test(short) ? [3, 6] : null);
  return short.length >= 8 && short !== org && !(ages && (ages[1] ?? 99) < 12) ? short.slice(0, 600) : title;
}

// One schedule line on a page: a weekday and its hours, plus — when the page
// lists several groups — the grades written just above it and the price just
// below it. The museum lists one course as several age groups with different
// days and prices; picking by position alone gave a teen row the 4th graders' slot.
type Slot = { day: number; start: string; end: string; ages: [number | null, number | null] | null; price?: number };
type ClubPage = {
  text: string; slots: Slot[]; price?: number; price_period?: string | null;
  start_date?: string; end_date?: string; description?: string; registration_url?: string;
};
const AMOUNT = /(?:₪\s*(\d[\d,]*(?:\.\d+)?))|(?:(\d[\d,]*(?:\.\d+)?)\s*(?:₪|ש"ח|ש״ח))/;
const amount = (m: RegExpMatchArray | null) => (m ? Number((m[1] ?? m[2]).replace(/,/g, "")) : undefined);

function parseClubPage(html: string, pageUrl: string, org: string): ClubPage {
  const lines = htmlLines(html);
  const all = lines.join("\n");
  const out: ClubPage = { text: all, slots: [] };

  // Only full day names, each paired with hours on the same line or the next.
  // The abbreviated "ימים: א'-ה'" summary is ignored: it is written as a range
  // when it means "Sun and Thu", which is how Sun–Thu got into the table before.
  for (let i = 0; i < lines.length; i++) {
    const d = lines[i].match(DAY_LINE);
    if (!d) continue;
    const t = lines[i].slice(d[0].length).match(HOURS) || (lines[i + 1] || "").match(HOURS);
    if (!t || +t[1] > 23 || +t[3] > 23) continue;
    let [start, end] = [two(t[1], t[2]), two(t[3], t[4])];
    if (start > end) [start, end] = [end, start]; // two templates print the range right-to-left
    if (start === "00:00") continue;                // "00:00 - 00:00" is how these pages say "no hours"
    const label = [lines[i - 1], lines[i - 2]].find(l => l && l.length <= 20 && agesFromTitle(l));
    const below = lines.slice(i + 1, i + 5).find(l => AMOUNT.test(l) && !HOURS.test(l));
    out.slots.push({ day: DAY_NAMES[d[1]], start, end, ages: label ? agesFromTitle(label) : null, price: amount(below?.match(AMOUNT) ?? null) });
  }

  const priced = all.match(/(?:עלות|מחיר)[^\n\d₪]{0,12}₪?\s*(\d[\d,]*(?:\.\d+)?)/) || all.match(/₪\s*(\d[\d,]*(?:\.\d+)?)/)
    || all.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:ש"ח|ש״ח)/);
  if (priced) {
    out.price = Number(priced[1].replace(/,/g, ""));
    const near = all.slice(Math.max(0, (priced.index ?? 0) - 40), (priced.index ?? 0) + priced[0].length + 40);
    out.price_period = /לחודש|חודשי/.test(near) ? "monthly" : /לשנה|שנתי|לתקופה|לכל התקופה|לקורס|לסדנה/.test(near) ? "total"
      : /למפגש|לשיעור|לכניסה/.test(near) ? "per_session" : null;
  } else if (/(?:^|\s)(חינם|ללא עלות|ללא תשלום|הכניסה חופשית)(?:\s|$|[.,!])/.test(all)) {
    out.price = 0; // stated free — the one case a zero price is published
  }

  const season = all.match(/מועדי הפעילות\s*מ\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*ל\s*:?\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (season) {
    out.start_date = `${season[3]}-${season[2].padStart(2, "0")}-${season[1].padStart(2, "0")}`;
    out.end_date = `${season[6]}-${season[5].padStart(2, "0")}-${season[4].padStart(2, "0")}`;
  }

  // Description, best source first: the prose between the schedule and the
  // price; the page's meta description; the "מידע כללי:" line.
  const iPrice = lines.findIndex(l => /^(עלות|מחיר)[^:]{0,10}:/.test(l));
  const iSched = Math.max(lines.findIndex(l => /^מועדי הפעילות/.test(l)), ...lines.map((l, i) => (DAY_LINE.test(l) || HOURS.test(l) ? i : -1)));
  const prose = iPrice > 0 && iSched >= 0 && iSched < iPrice ? lines.slice(iSched + 1, iPrice).filter(l => l.length > 15).join(" ") : "";
  const meta = html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)/i);
  const info = all.match(/מידע כללי\s*:\s*([^\n]+)/);
  // A short "מידע כללי" line ("כדורגל-רון סעדון" — the coach) still beats the
  // listing's model-written sentence; descFor() decides later if it is too thin.
  out.description = cleanDescription(prose, org) ?? (meta ? cleanDescription(decodeHtml(meta[1]), org) : undefined)
    ?? (info ? cleanDescription(info[1], org) ?? info[1].trim() : undefined);

  const anchors = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: decodeHtml(m[1]), text: decodeHtml(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() }));
  const reg = anchors.find(a => /hugim\.org\.il|HugimWeb/i.test(a.href))
    || anchors.find(a => /^(הרשמה לחוג|לחץ להרשמה|להרשמה|הרשמה)$/.test(a.text));
  if (reg) {
    try { const u = new URL(reg.href, pageUrl).href; if (signupOk(u, pageUrl)) out.registration_url = u; } catch { /* bad href */ }
  }
  return out;
}

// What the last club-page fetch did, for the recheck report.
let lastFetch = "";

// Direct first, because it is free. Some sites (Talpaz) answer this function's
// servers with 403 while answering a browser in Israel normally — so a refused
// page is fetched once more through Firecrawl as raw HTML (1 credit) and parsed
// by the same code.
async function fetchClubPage(url: string, org: string, key: string): Promise<ClubPage | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "he-IL,he;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    lastFetch = `http ${res.status}, ${html.length} B`;
    if (res.ok) {
      const parsed = parseClubPage(html, url, org);
      // The museum serves this function a generic page with no course blocks,
      // while a browser in Israel gets the full one; ask Firecrawl for it.
      if (parsed.slots.length || !/imj\.org\.il/.test(url)) return parsed;
    } else if (![403, 429, 503].includes(res.status)) return null;
  } catch (err) { lastFetch = `fetch failed: ${String(err).slice(0, 80)}`; }
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["rawHtml"], onlyMainContent: false, timeout: 60000 }),
      signal: AbortSignal.timeout(70000),
    });
    const b = await r.json().catch(() => ({}));
    if (!b.success || !b.data?.rawHtml) { lastFetch += " → firecrawl failed"; return null; }
    lastFetch += " → firecrawl ok";
    return parseClubPage(b.data.rawHtml, url, org);
  } catch (err) { lastFetch += ` → firecrawl error ${String(err).slice(0, 60)}`; return null; }
}

const ADULT = /נשים|גברים|מבוגרים|הורים|גיל הזהב|גמלאים|אזרחים ותיקים/;
const YOUTH = /נוער|נער|נערות|נערים|תיכון|מתבגר/;
const STAGE = /מחול|ריקוד|היפ ?הופ|ג'אז|ג׳אז|בלט|דרמה|תיאטרון|תאטרון|משחק מול מצלמה|אקרובטיקה אווירית|קרקס/;

type Row = Record<string, unknown> & {
  title: string; age_min: number | null; age_max: number | null; category: string; schedule_type: string;
  recurrence_days: number[] | null; recurrence_freq: string; start_time: string | null; end_time: string | null;
  start_date: string | null; price: number | null; registration_url: string | null; location_name: string | null;
};

// At least half the title's distinctive words (3+ letters, not generic words
// like חוג/כיתות/נוער) must appear on the page.
const GENERIC = new Set(["חוג", "חוגים", "כיתות", "כיתה", "גילאי", "נוער", "ומעלה", "לנוער", "קבוצה", "סטודיו", "מנוי"]);
function pageIsAbout(pageText: string, title: string) {
  const norm = (s: string) => s.replace(/["'׳״\-–|,.()!:+]/g, " ").replace(/\s+/g, " ");
  const page = norm(pageText);
  const words = [...new Set(norm(title).split(" ").filter(w => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w)))];
  if (!words.length) return true;
  return words.filter(w => page.includes(w)).length >= Math.ceil(words.length / 2);
}

// Take the row's schedule and price from its own page. When the page lists
// several age groups, only the slots whose grades overlap this row's ages
// count. Days, hours and price are replaced outright — never mixed with the
// listing's — and the row is marked as having facts a parser actually read.
function withClubPage(d: Row, p: ClubPage, pageAges?: [number, number]): Row {
  // The page must be about this activity. The model has attached one item's
  // link to another — "זומבה" pointed at a 3rd–4th-grade hip hop page — and
  // everything read from that page would then describe the wrong class.
  if (!pageIsAbout(p.text, d.title)) return { ...d, _factsFromPage: false, _wrongPage: true };
  const want = agesFromTitle(d.title) ?? (d.age_min != null || d.age_max != null ? [d.age_min, d.age_max] : pageAges ?? [12, 18]);
  const overlaps = (a: [number | null, number | null]) => (a[0] ?? 0) <= (want[1] ?? 99) && (a[1] ?? 99) >= (want[0] ?? 0);
  const slots = p.slots.filter(s => !s.ages || overlaps(s.ages));
  const price = slots.find(s => s.price != null)?.price ?? p.price;
  const first = slots[0];
  return {
    ...d,
    recurrence_days: slots.length ? [...new Set(slots.map(s => s.day))].sort((a, b) => a - b) : null,
    start_time: first?.start ?? null,
    end_time: first?.end ?? null,
    price: price ?? null,
    price_period: price != null && price === p.price ? p.price_period ?? null : null,
    start_date: p.start_date ?? d.start_date,
    end_date: p.end_date ?? d.end_date,
    description: p.description ?? d.description,
    registration_url: p.registration_url ?? d.registration_url,
    _factsFromPage: slots.length > 0,
  };
}

// The single gate every row passes — fresh from a scrape or already stored.
// Beyond ages overlapping 12–18, a row is only published when a teen can act on
// it: where, which days and at what hour (or which date and hour for a one-off),
// what it costs, and where to sign up. A club that says "free" in so many words
// is the one case a price of 0 is kept.
//
// Days, hours and price must have been READ OFF THE ACTIVITY'S OWN PAGE by
// parseClubPage — never taken from the model. Checked against the pages, the
// model had given the museum's teen animation course "Sun+Tue+Thu 16:00, ₪1,200"
// when the page says "Wednesday 18:30–20:30, ₪2,800", and given all four
// French Hill clubs a Monday that appears nowhere on their page. A wrong time
// or price is worse than no listing.
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

  if (r._wrongPage) return { skip: "link leads to a different activity" };
  if (!r._factsFromPage) return { skip: "facts not on the activity's page" };
  if (r.end_date && String(r.end_date) < new Date().toISOString().slice(0, 10)) return { skip: "ended" };
  const start = r.start_time;
  const recurring = r.schedule_type === "recurring";
  const days = r.recurrence_days;

  if (!start) return { skip: "no hours" };
  if (recurring && !days?.length) return { skip: "no weekdays" };
  if (!recurring && !r.start_date) return { skip: "no date" };
  if (r.price == null) return { skip: "no price" };
  if (!r.registration_url) return { skip: "no signup link" };
  if (!r.location_name) return { skip: "no location" };

  const { _factsFromPage: _f, _wrongPage: _w, ...clean } = r;
  return {
    row: {
      ...clean,
      age_min: lo ?? null,
      age_max: hi ?? null,
      start_time: start,
      end_time: r.end_time,
      recurrence_days: recurring ? days : null,
      recurrence_freq: recurring ? "weekly" : "none",
      category: STAGE.test(t) ? "stage" : r.category,
      title: cleanTitle(t),
      description: descFor(r.description, String(r.organization_name ?? ""), cleanTitle(t)),
      short_description: null,
    } as Row,
  };
}

// The same class is sometimes listed twice — once per listing page, or under
// two ids — with the same days, hours and price. Keep one: the one that links
// into the signup system if either does, else the older.
async function dedupe(sb: Sb) {
  const { data, error } = await sb.from("activities")
    .select("id, organization_name, title, recurrence_days, start_time, start_date, price, registration_url, created_at")
    .not("source_page", "is", null);
  if (error) return { error: error.message };
  const norm = (t: string) => t.replace(/["'׳״\-–|,.()]/g, "").replace(/\s+/g, " ").trim();
  const groups = new Map<string, typeof data>();
  for (const r of data ?? []) {
    const k = [r.organization_name, norm(r.title), JSON.stringify(r.recurrence_days), r.start_time, r.start_date, r.price].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let removed = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    rows.sort((a: { registration_url: string; created_at: string }, b: { registration_url: string; created_at: string }) =>
      (+/hugim\.org\.il/.test(b.registration_url) - +/hugim\.org\.il/.test(a.registration_url)) || a.created_at.localeCompare(b.created_at));
    for (const extra of rows.slice(1)) { await sb.from("activities").delete().eq("id", extra.id); removed++; }
  }
  return { duplicates_removed: removed };
}

// The listing's view of one item, before its club page is read.
function toDraft(it: Item, src: Source, today: string): { row: Row } | { skip: string } {
  const title = text(it.title);
  if (!title) return { skip: "no title" };

  const date = ymd(it.date);
  const oneOff = it.kind === "event" || it.kind === "show";
  if (oneOff && !date) return { skip: "no date" };
  if (oneOff && date! < today) return { skip: "past event" };

  const page = new URL(src.url).href;
  let link = absUrl(it.link, page);
  if (link && (!sameSite(link, page) || garbled(link))) link = undefined;
  // 0 is what the model returns for "no price on the page"; publishing it would say "free".
  const price = typeof it.price_ils === "number" && it.price_ils > 0 ? it.price_ils : null;
  const start = hhmm(it.start_time) ?? null;
  const days = [...new Set((it.day_indices ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();

  return {
    row: {
      item_kind: oneOff ? "event" : "activity",
      schedule_type: oneOff ? "one_time" : "recurring",
      category: CATEGORIES.includes(it.category ?? "") ? it.category! : "learning",
      topics: (it.topics ?? []).map(text).filter(Boolean).slice(0, 3),
      title,
      // One description, shown in the detail screen's description section.
      // short_description stays empty so the same words aren't printed twice.
      short_description: null,
      description: text(it.short_description) ?? title,
      organization_name: src.organization,
      start_date: date ?? null,
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
      price_period: price == null ? null : (["monthly", "total", "per_session"].includes(it.price_period ?? "") ? it.price_period : null),
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
    } as Row,
  };
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

const tally = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

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

  if (params.get("recheck") === "1") {
    return json({ recheck: await recheck(sb, sources, Number(params.get("offset") ?? 0), Number(params.get("limit") ?? 25), dry, key) });
  }

  let index: number;
  if (params.has("source")) {
    index = Number(params.get("source"));
    if (!Number.isInteger(index) || !sources[index]) return json({ error: "no such source" }, 400);
  } else {
    const { data: runs, error } = await sb.from("scrape_runs").select("source_url").eq("last_run_on", today);
    if (error) return json({ error: error.message }, 500);
    const done = new Set((runs ?? []).map(r => r.source_url));
    index = sources.findIndex(s => !done.has(s.url));
    if (index < 0) return json({ cleanup: { ...(await cleanup(sb, sources, today)), ...(await dedupe(sb)) } });
  }

  const src = sources[index];
  const t0 = Date.now();
  try {
    const items = await extract(src.url, key);
    const kept = new Map<string, Row>();
    const skipped: Record<string, number> = {};
    let pagesRead = 0;
    for (const it of items) {
      const d = toDraft(it, src, today);
      if ("skip" in d) { tally(skipped, d.skip); continue; }
      let draft = d.row;
      if (isClubPage(draft.source_url as string)) {
        const p = await fetchClubPage(draft.source_url as string, src.organization, key);
        if (p) { draft = withClubPage(draft, p, src.page_ages); pagesRead++; }
      }
      const r = refine(draft, src.page_ages);
      if ("skip" in r) { tally(skipped, r.skip); continue; }
      kept.set(r.row.source_url as string, r.row);
    }
    const rows = [...kept.values()];

    if (dry) return json({ source: index, url: src.url, found: items.length, club_pages_read: pagesRead, kept: rows, skipped, credits: await credits(key) });

    const { data: existing, error: exErr } = await sb.from("activities")
      .select("source_url").eq("source_name", src.organization).not("source_url", "is", null);
    if (exErr) throw exErr;
    const have = new Set((existing ?? []).map(e => e.source_url as string));
    const inserted = rows.filter(r => !have.has(r.source_url as string)).length;
    const updated = rows.length - inserted;
    if (rows.length) { const { error } = await sb.from("activities").upsert(rows, { onConflict: "source_url" }); if (error) throw error; }

    await sb.from("scrape_runs").upsert({ source_url: src.url, last_run_on: today, last_run_at: new Date().toISOString(),
      last_status: "ok", found: items.length, kept: rows.length, inserted, updated, skipped, last_error: null });
    return json({ source: index, organization: src.organization, found: items.length, club_pages_read: pagesRead, inserted, updated, skipped, ms: Date.now() - t0 });
  } catch (err) {
    if (!dry) await sb.from("scrape_runs").upsert({ source_url: src.url, last_run_on: today, last_run_at: new Date().toISOString(),
      last_status: "error", last_error: String(err).slice(0, 500) });
    return json({ source: index, organization: src.organization, error: String(err), ms: Date.now() - t0 }, 502);
  }
});

// Unpublish rows that a source which succeeded today has not produced for STALE_DAYS.
async function cleanup(sb: Sb, sources: Source[], today: string) {
  const { data: okRuns } = await sb.from("scrape_runs").select("source_url").eq("last_run_on", today).eq("last_status", "ok");
  const okPages = (okRuns ?? []).map((r: { source_url: string }) => r.source_url).filter((u: string) => sources.some(s => s.url === u));
  if (!okPages.length) return { unpublished: 0 };
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const { data, error } = await sb.from("activities").update({ is_published: false })
    .in("source_page", okPages).lt("last_seen_at", cutoff).eq("is_published", true).select("id");
  return error ? { error: error.message } : { unpublished: data?.length ?? 0 };
}

// Re-run the gate over stored rows, re-reading each club's own page (free).
// A row that now passes is brought up to date; one that doesn't — no price, no
// hours, no weekdays or date, no signup link, or a source no longer listed — is
// DELETED, not hidden: it never met the bar for being in the table. Batched
// with offset/limit because each club page is a network round trip.
async function recheck(sb: Sb, sources: Source[], offset: number, limit: number, dry: boolean, key: string) {
  const { data, error } = await sb.from("activities").select("*").not("source_page", "is", null)
    .order("id").range(offset, offset + limit - 1);
  if (error) return { error: error.message };
  const out = { offset, checked: 0, updated: 0, deleted: 0, reasons: {} as Record<string, number>, done: (data ?? []).length < limit, removed: [] as string[], kept: [] as string[] };
  for (const stored of data ?? []) {
    out.checked++;
    const src = sources.find(s => s.url === stored.source_page);
    let res: { row: Row } | { skip: string };
    if (!src) res = { skip: "source removed" };
    else {
      const hhmm5 = (v: unknown) => (v ? String(v).slice(0, 5) : null);
      let draft = { ...stored, start_time: hhmm5(stored.start_time), end_time: hhmm5(stored.end_time) } as Row;
      const page = new URL(src.url).href;
      // Repair links the model invented or mangled before they could be caught at insert.
      if (!sameSite(String(draft.source_url), page) || garbled(String(draft.source_url))) {
        draft.source_url = `${page}#${encodeURIComponent(draft.title)}`;
      }
      if (!draft.registration_url || !signupOk(String(draft.registration_url), page) || garbled(String(draft.registration_url))) {
        draft.registration_url = page;
      }
      lastFetch = "not a club page";
      if (isClubPage(String(draft.source_url))) {
        const p = await fetchClubPage(String(draft.source_url), src.organization, key);
        // A page that is down right now says nothing about the activity; keep the
        // row as it is rather than delete it over a network blip.
        if (!p) { tally(out.reasons, "page unavailable, kept"); continue; }
        draft = withClubPage(draft, p, src.page_ages);
      }
      if (draft.short_description && draft.description === draft.title) draft.description = draft.short_description;
      draft.short_description = null;
      res = refine(draft, src.page_ages);
    }
    if ("skip" in res) {
      tally(out.reasons, res.skip);
      out.removed.push(`${res.skip} | ${stored.organization_name} | ${stored.title} | ${stored.source_url} | ${lastFetch}`);
      if (!dry) await sb.from("activities").delete().eq("id", stored.id);
      out.deleted++;
      continue;
    }
    const { id: _id, created_at: _c, updated_at: _u, is_free: _f, ...patch } = res.row as Record<string, unknown>;
    if (dry) out.kept.push([patch.title, (patch.recurrence_days as number[] | null)?.join("+"), patch.start_time, patch.end_time, "₪" + patch.price, patch.price_period ?? "", String(patch.registration_url).slice(0, 40), String(patch.description).slice(0, 50)].join(" | "));
    if (!dry) {
      const { error: upErr } = await sb.from("activities").update(patch).eq("id", stored.id);
      if (upErr) { tally(out.reasons, "update failed: " + upErr.message.slice(0, 60)); continue; }
    }
    out.updated++;
  }
  if (out.done && !dry) Object.assign(out, await dedupe(sb));
  return out;
}
