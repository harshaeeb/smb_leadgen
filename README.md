# leadgen — no-website lead sourcing tool

Pulls a ranked, top-N batch of service-business leads with no website for a
given city, state, and service type, and writes them into a Lead
Tracker-formatted `.xlsx` file. Companion tool to
`Dallas_No_Website_Lead_Generation_Strategy.md` — this script automates **Step 1
(sourcing + no-website filtering + ranking) only**. Owner name and email stay a
manual step per that strategy doc (TDLR/TSBPE/county DBA/SOSDirect/Facebook),
since none of those have a reliable public API to script against.

## What it does

1. For each service type you pass in (or each category in a preset from
   `categories.json`), runs a Google Places Text Search for
   `"<service> in <city>, <state>"`.
2. Flags each result as **No Website**, **Social Only** (their Google listing's
   "website" is actually a Facebook/Instagram/Linktree link), or **Has Website**
   — only the first two get kept as leads.
3. Optionally cross-checks Yelp for businesses Google didn't surface. Yelp's
   API doesn't expose an external website field, so those get logged as
   **Unknown — verify manually** rather than a confident no-website claim.
4. Dedupes by phone number (or name if no phone), **ranks everything by
   review count first and rating as a tie-breaker**, and keeps only the
   top N (default 25) — the batch you're most likely to close, since these
   are businesses with proven demand but no website.
5. Writes the ranked batch to an `.xlsx` with a `Lead Tracker` tab (numbered
   1–N by rank, matching your existing tracker's column order plus a few new
   columns) and a `Search Summary` tab with per-category counts and how many
   candidates were found beyond the batch limit.

## One-time setup

### 1. Install dependencies

```
pip install -r requirements.txt
```

### 2. Get a Google Places API key (required)

1. Go to the [Google Maps Platform Credentials page](https://console.cloud.google.com/google/maps-apis/credentials) (create a Google Cloud project if you don't have one).
2. Enable **Places API (New)** for that project.
3. Enable billing on the project — Google gives a **$200/month free credit**
   across all Maps Platform APIs. At this script's scale (roughly one service
   x 1–3 pages per run), a batch costs well under a dollar in Enterprise-SKU
   pricing (the tier that includes the website field) and will comfortably
   fit inside the free credit for normal use.
4. Create an API key, restrict it to Places API for safety.

### 3. (Optional) Get a Yelp Fusion API key

1. Go to [business.yelp.com/data/products/fusion](https://business.yelp.com/data/products/fusion/) and register an app.
2. Free tier: 5,000 calls/day.
3. Only adds businesses Google's search missed — skip this if you'd rather keep it simple; the script works fine without it (use `--no-yelp` or just don't set the key).

### 4. Set your API key(s) as environment variables

Windows (PowerShell), each time before running (or add to your profile):

```powershell
$env:GOOGLE_PLACES_API_KEY = "your-key-here"
$env:YELP_API_KEY = "your-key-here"   # optional
```

Mac/Linux (bash/zsh):

```bash
export GOOGLE_PLACES_API_KEY="your-key-here"
export YELP_API_KEY="your-key-here"   # optional
```

(`.env.example` shows the two variable names — this script doesn't auto-load
a `.env` file, so either export them in your shell or `pip install python-dotenv`
and add two lines to load it yourself if you'd prefer that route.)

## Running it

The third input is the service type — this is what narrows the search down to
a specific, sellable list instead of a generic trade dump:

```
python leadgen.py "Garland" "TX" "plumber"
python leadgen.py "Frisco" "TX" "dog walker,pet groomer"
python leadgen.py "Plano" "TX" "electrician"
python leadgen.py "McKinney" "TX" "handyman"
```

Each of those is its own batch, capped at 25 leads (top reviews first) by
default. Run it again with a different service or city for the next batch —
one run, one focused list to work.

Other options:

```
# Run a whole preset instead of naming a service (falls back to categories.json)
python leadgen.py "Garland" "TX" --industry trades
python leadgen.py "Garland" "TX" --industry petcare

# Change the batch size
python leadgen.py "Garland" "TX" "landscaper" --limit 10

# Custom output filename
python leadgen.py "Irving" "TX" "concrete worker" --output "Irving_concrete.xlsx"

# Skip Yelp even if YELP_API_KEY is set
python leadgen.py "Mesquite" "TX" "roofing contractor" --no-yelp
```

Each run prints per-category result counts to the terminal and writes a new
`.xlsx` named `Leads_<City>_<State>_<service>_<date>.xlsx` in the folder you
run it from (unless you pass `--output`).

## Ranking — how the top 25 get picked

Neither Google Places nor Yelp exposes a "popularity" or "views" metric, so
the closest available proxy is used: **review count first, star rating as a
tie-breaker**. That's a deliberate choice, not a limitation — a business with
50 reviews and no website has demonstrated real customer demand and is
actively losing potential customers to whoever shows up when people search
for them online, which is exactly the strongest pitch for a custom site. A
brand-new listing with 2 reviews is a weaker prospect right now even though
it's just as "no website."

The `Search Summary` tab tells you how many total candidates were found for
the run and how many got cut by the `--limit`, so you can see if a service/city
combo is deep enough to run again with a higher `--limit` or a neighboring
suburb.

## Editing the category presets

Open `categories.json` — it's the same "one config file" pattern as
`src/config/site.ts` in the main website template. These presets (`trades`,
`petcare`) are only used when you don't pass a specific service as the third
argument — they're a convenience for running a whole batch of related
categories in one go. Add, remove, or rename entries, or add a whole new
preset (e.g. `"autorepair": [...]`) and call it with `--industry autorepair`.

## After a run

- Owner Name, Email, and Owner/Email Source columns are intentionally blank.
  Fill those in using the free-first cascade in
  `Dallas_No_Website_Lead_Generation_Strategy.md` (Facebook → TDLR/TSBPE/TDA
  license lookup → county DBA search → SOSDirect).
- Website Status flags "Social Only" leads separately from "No Website" —
  both are valid outreach targets, but it's useful context for how you frame
  the pitch on the call.
- Copy/paste rows into your master financial-model Lead Tracker tab if you
  want everything in one workbook — note the column order here has a few
  extra columns inserted after "Source" compared to the original tracker, so
  either insert matching columns there first or paste by mapping headers
  rather than a raw block copy.

## Known limitations

- Owner name/email enrichment isn't automated — see the note at the top.
  TDLR, TSBPE, county clerk, and SOSDirect sites are form-based, several are
  CAPTCHA-protected, and scraping them isn't reliable or guaranteed to respect
  their terms of use, so that step is manual by design for now.
- "No Website" reflects what's in the business's Google Business Profile —
  it's Google's own website field, not an independent site crawl. It's the
  same signal the manual Google Maps process already relies on, just pulled
  via API instead of by hand.
- Google Places Text Search returns at most ~60 results per query (3 pages of
  20) — this is a Google API limit, which is exactly why the existing strategy
  searches suburb-by-suburb (or ZIP-by-ZIP for Dallas proper) instead of
  city-wide for larger areas.
- Ranking uses review count/rating as a proxy for "potential" since that's
  what both APIs actually expose — see the Ranking section above.
