// Periodic activity scraper — the automated version of the one-time batch in
// migration 20260922130000_seed_real_jerusalem_youth_activities.sql.
//
// WHAT THIS DOES: for each URL in SOURCES below, asks Firecrawl to extract one
// activity's real facts (schedule, price, age, location) as structured JSON,
// maps them onto this app's `activities` columns, and upserts on
// `source_url` — so re-running this on a schedule updates a changed price or
// schedule in place instead of duplicating the row. It does not delete rows
// that vanish from a source (see the comment above markMissingAsUnpublished-
// shaped logic, not yet written — today a vanished source just stops being
// refreshed, it isn't unpublished automatically).
//
// WHAT THIS DELIBERATELY DOES NOT DO: discover new source URLs on its own.
// SOURCES is a hand-vetted list — every URL here was opened by a person (or
// verified against a person's manual read) and confirmed to be a real,
// currently-offered activity whose stated age range overlaps 12–18. A crawler
// that found and force-added *new* URLs unsupervised would defeat the purpose
// of "no fabricated data" the rest of this app holds to: a wrong extraction
// would look exactly as authoritative as a right one. Growing this list is a
// deliberate, reviewed action — add a URL here only after opening it and
// checking it fits, the same way the first four did.
//
// EXTRACTION FIELDS ARE TYPED, NOT FREE TEXT — on purpose. An earlier version
// asked Firecrawl for a free-text "grades or ages" string and a free-text
// "day(s) of week" string, then regex-parsed them locally. That broke: the
// same page returned "ט'-י'", then "כיתות: ט'-י'", then a third phrasing on
// three different calls, because JSON-mode extraction is itself LLM-based and
// not byte-for-byte deterministic. Asking the schema for `age_min`/`age_max`
// integers and `day_indices` (0=Sunday..6=Saturday) instead pushes that
// translation onto the model doing the reading — which is what it's actually
// good at — and leaves this function only a bounds check, not a parser.
//
// Requires the FIRECRAWL_API_KEY secret (supabase secrets set). SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY are injected automatically for every Edge
// Function — the service role key is what lets this write to `activities`
// despite its organizer/admin-only RLS policy; it never leaves this function.

import { createClient } from "npm:@supabase/supabase-js@2";

// ---- The vetted source list. Add to this by hand, one verified URL at a time. ----
// The municipality's own jerusalem.muni.il pages (the Western Wall Tunnels
// tour among them) are NOT in this list, on purpose: they sit behind bot
// detection that beats Firecrawl even in stealth mode (SCRAPE_ALL_ENGINES_-
// FAILED on every engine it tried). The one Tunnels row in the database came
// from a real interactive browser session in the one-time batch, not from
// this function, and won't be kept fresh automatically until that's solved.
const SOURCES: {
  source_url: string;
  organization_name: string;
  category: string;
  neighborhood: string;
}[] = [
  {
    source_url: "http://www.beithakerem.org.il/page.php?type=hug&id=88365",
    organization_name: "מנהל קהילתי בית הכרם",
    category: "sport",
    neighborhood: "בית הכרם",
  },
  {
    source_url: "http://www.beithakerem.org.il/page.php?type=hug&id=84551",
    organization_name: "מנהל קהילתי בית הכרם",
    category: "sport",
    neighborhood: "בית הכרם",
  },
  {
    source_url: "http://www.beithakerem.org.il/page.php?type=hug&id=84573",
    organization_name: "מנהל קהילתי בית הכרם",
    category: "gaming",
    neighborhood: "בית הכרם",
  },
];

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    short_description: {
      type: "string",
      description:
        "A short factual sentence, under 140 characters, describing the activity. Use only words, facts and names that literally appear on the page — no paraphrasing that could introduce an error, no nearby-neighborhood or nearby-name substitutions, no claims (friendly, fun, professional) the page doesn't itself make. If in doubt, quote the page rather than rephrase it.",
    },
    description: {
      type: "string",
      description:
        "A few factual sentences describing the activity, built only from words and facts literally on the page. Do not substitute a similar-sounding place, person or organization name for the one actually written on the page — copy names exactly as spelled there. Do not add any claim, benefit or detail the page doesn't itself state.",
    },
    age_min: {
      type: "integer",
      description:
        "Minimum age in years this activity is open to. Convert Israeli school grades if that's what the page states, using the standard mapping ז'=12, ח'=13, ט'=14, י'=15, יא/י\"א=16, יב/י\"ב=17. If the page says an open group like 'youth and adults' with no stated floor, use 12. Omit only if truly nothing about age/grade is stated anywhere on the page.",
    },
    age_max: {
      type: "integer",
      description: "Maximum age in years, converted the same way. Omit if the page states no upper limit (e.g. 'ומעלה' / 'and up' / adults included).",
    },
    day_indices: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 6 },
      description: "Every day of the week this recurs, as integers where 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday (Israeli week starts Sunday, matching Hebrew א'=0..ש'=6). One or several.",
    },
    start_time: { type: "string", description: "HH:MM in 24h format" },
    end_time: { type: "string", description: "HH:MM in 24h format" },
    price_ils: { type: "number", description: "Numeric price in NIS if the page states one, omit if not stated — do not guess a number" },
    location_name: { type: "string" },
    address: { type: "string", description: "A street address with a street name, only if one is literally written on the page. Omit entirely if the page only names a neighborhood or venue — do not put the neighborhood or venue name in this field." },
    contact_phone: { type: "string" },
    image_url: { type: "string", description: "A real photo URL for this specific activity from the page (e.g. its og:image), omit if none" },
  },
  required: ["title"],
};

type Extracted = {
  title?: string;
  short_description?: string;
  description?: string;
  age_min?: number;
  age_max?: number;
  day_indices?: number[];
  start_time?: string;
  end_time?: string;
  price_ils?: number;
  location_name?: string;
  address?: string;
  contact_phone?: string;
  image_url?: string;
};

// The model doesn't reliably omit an "open-ended" age field the way the
// schema asks — seen live: age_max 0 for "grade 7 and up", and separately
// age_max 99 for "youth and adults, no cap" (apparently its own placeholder
// for "unbounded"). Neither is a real age for a youth activity, so both get
// normalized to "not stated" rather than either filtering out every
// open-ended club (0) or quietly writing a fabricated upper bound (99) into
// a column real people read as fact.
function normalizeAge(n: number | undefined): number | undefined {
  return n && n > 0 && n <= 25 ? n : undefined;
}

// An "omit if not found" text field sometimes comes back as "" instead of
// actually being omitted — write null, not an empty string, into the column.
function normalizeText(s: string | undefined): string | undefined {
  return s && s.trim() ? s.trim() : undefined;
}

function overlaps1218(min: number | undefined, max: number | undefined): boolean {
  const lo = normalizeAge(min) ?? 0;
  const hi = normalizeAge(max) ?? 99;
  return lo <= 18 && hi >= 12;
}

async function firecrawlExtract(url: string, apiKey: string): Promise<Extracted> {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: [{ type: "json", schema: EXTRACT_SCHEMA }] }),
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (!body.success) throw new Error(`Firecrawl reported failure for ${url}`);
  return body.data.json as Extracted;
}

Deno.serve(async (req: Request) => {
  const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!firecrawlKey) return new Response("FIRECRAWL_API_KEY not set", { status: 500 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, unknown>[] = [];

  for (const source of SOURCES) {
    try {
      const e = await firecrawlExtract(source.source_url, firecrawlKey);
      const days = e.day_indices?.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) ?? [];

      if (!e.title || !days.length || !overlaps1218(e.age_min, e.age_max)) {
        results.push({
          source_url: source.source_url, skipped: true,
          reason: !e.title ? "no title" : !days.length ? "no usable day_indices" : "age outside 12-18 or unstated",
          extracted: e,
        });
        continue;
      }

      const row = {
        item_kind: "activity",
        schedule_type: "recurring",
        category: source.category,
        title: e.title,
        short_description: e.short_description?.slice(0, 140) ?? null,
        description: e.description ?? e.title,
        organization_name: source.organization_name,
        start_date: new Date().toISOString().slice(0, 10),
        start_time: e.start_time ?? "00:00",
        end_time: e.end_time ?? null,
        recurrence_freq: "weekly",
        recurrence_days: [...new Set(days)].sort((a, b) => a - b),
        attendance_mode: "onsite",
        location_name: normalizeText(e.location_name) ?? source.organization_name,
        address: normalizeText(e.address) ?? null,
        neighborhood: source.neighborhood,
        age_min: normalizeAge(e.age_min) ?? null,
        age_max: normalizeAge(e.age_max) ?? null,
        price: e.price_ils ?? null,
        price_period: e.price_ils != null ? "monthly" : null,
        registration_required: true,
        registration_url: source.source_url,
        contact_phone: normalizeText(e.contact_phone) ?? null,
        image_url: normalizeText(e.image_url) ?? null,
        status: "open",
        is_published: true,
        source_url: source.source_url,
        source_name: source.organization_name,
      };

      const { error } = await supabase.from("activities").upsert(row, { onConflict: "source_url" });
      if (error) throw error;
      results.push({ source_url: source.source_url, ok: true, title: row.title });
    } catch (err) {
      results.push({ source_url: source.source_url, error: String(err) });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
