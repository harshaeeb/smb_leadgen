# leadgen — no/weak-website lead sourcing tool

Pulls a ranked, top-N batch of local service-business leads that have **no
real professional web presence** — no website, only a social media page, a
broken/unreachable website, or a website that fails basic professionalism
checks — for a given city, state, and service type. Built for pitching a
professional website + SEO + AI-search visibility + online booking (cal.com)
package to small local service businesses. Writes them into a Lead
Tracker-formatted `.xlsx` file.

Runs on your own laptop from a terminal. A hosted web version was tried and
deliberately dropped — see "Why this stays a local script" at the bottom.

Companion tool to
[`docs/Dallas_No_Website_Lead_Generation_Strategy.md`](docs/Dallas_No_Website_Lead_Generation_Strategy.md) —
this script automates **Step 1 (sourcing + qualification + ranking) only**.
Owner name and email stay a manual step per that strategy doc (TDLR/TSBPE/
county DBA/SOSDirect/Facebook), since none of those have a reliable public
API to script against.

## What it does

1. For each service type you pass in (or each category in a preset from
   `categories.json`), runs a Google Places Text Search for
   `"<service> in <city>, <state>"`.
2. For every result that has a listed website, fetches that site once and
   checks it for basic professionalism signals:
   - Loads over HTTPS?
   - On a custom domain, or a free page-builder subdomain (Wix, Weebly,
     GoDaddy Sites, Squarespace's `square.site`, free WordPress.com, etc.)?
   - Has a mobile viewport meta tag (i.e. isn't a desktop-only relic)?
   - Has more than a token amount of real content on the homepage?

   A site that passes all of those is **not a lead** — it already has a
   reasonably professional presence. A site that fails one or more is a
   **Tier 2 (Weak/Unprofessional Website)** lead, and the specific issues
   found are listed in the output so you know what to pitch.
3. A business with **no website at all**, only a **Facebook/Instagram page**,
   or a website that's **genuinely broken** when the script tries to load it
   (dead domain, times out, 404s, bad security certificate) is a **Tier 1**
   lead — the strongest prospects, since they have effectively zero real web
   presence.
4. Some sites refuse automated visitors — you get a "prove you're human"
   wall instead of the page. That tells us **nothing** about whether their
   website is any good, so those businesses are **not ranked as leads at
   all**. They go on a separate **Could Not Verify** tab with a note about
   what happened, for you to open and judge yourself. This is deliberate:
   calling a business to say "your website is down" when it's actually fine
   is the worst way to open a cold call.
5. Also checks whether the site (if any) has `schema.org`/structured-data
   markup, as a rough signal of AI-search readiness (Google AI Overviews,
   ChatGPT/Perplexity-style answer engines, etc.). This is reported as an
   informational column for your pitch — it does not affect tier or ranking.
6. Dedupes by phone number (or name if no phone), ranks **Tier 1 leads above
   Tier 2 leads**, and within each tier:
   - Tier 1: ranked by review count first, star rating as a tie-breaker.
   - Tier 2: ranked by number of quality issues found (worst sites first),
     then review count, then rating.
   Keeps only the top N (default 25) — the batch you're most likely to
   close.
7. Writes the ranked batch to an `.xlsx` with three tabs: `Lead Tracker`
   (numbered 1–N by rank — your call list), `Could Not Verify` (businesses
   that blocked the check, for you to eyeball), and `Search Summary`
   (per-category counts and how many candidates were cut by the limit).

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

### 3. Set your API key as an environment variable

Windows (PowerShell), each time before running (or add to your profile):

```powershell
$env:GOOGLE_PLACES_API_KEY = "your-key-here"
```

Mac/Linux (bash/zsh):

```bash
export GOOGLE_PLACES_API_KEY="your-key-here"
```

(`.env.example` shows the variable name — this script doesn't auto-load a
`.env` file, so either export it in your shell or `pip install python-dotenv`
and add two lines to load it yourself if you'd prefer that route.)

No other API key is required — the website-quality checks fetch each
candidate's own site directly, with no third-party API involved.

## Running it

The third input is the service type — this is what narrows the search down to
a specific, sellable list instead of a generic trade dump:

```
python leadgen.py "Garland" "TX" "plumber"
python leadgen.py "Frisco" "TX" "dog walker,pet groomer"
python leadgen.py "Plano" "TX" "electrician"
python leadgen.py "McKinney" "TX" "handyman"
```

Each of those is its own batch, capped at 25 leads (Tier 1 first, then Tier 2,
each sorted internally as described above) by default. Run it again with a
different service or city for the next batch — one run, one focused list to
work.

Other options:

```
# Run a whole preset instead of naming a service (falls back to categories.json)
python leadgen.py "Garland" "TX" --industry trades
python leadgen.py "Garland" "TX" --industry petcare

# Change the batch size
python leadgen.py "Garland" "TX" "landscaper" --limit 10

# Custom output filename
python leadgen.py "Irving" "TX" "concrete worker" --output "Irving_concrete.xlsx"
```

### "Why is this business on my list?"

When a lead looks wrong — you open their site and it's perfectly good — run
the check on that one URL and see exactly what happened:

```
python leadgen.py --explain https://example-plumber.com/
```

It prints every check with pass/fail and the numbers behind them (word count,
final URL after redirects, HTTP status), and warns you when a result is
likely a false positive. No API key needed and it costs nothing, so use it
freely.

```
    HTTPS                  PASS   (loads over https://)
    Custom domain          PASS   (not on a free page-builder subdomain)
    Mobile viewport tag    PASS   (has <meta name=viewport>)
    Content volume         FAIL   (3 words found, need 150)
    schema.org markup      no     (informational only, never affects ranking)

  Verdict: TIER 2 LEAD - Weak/Unprofessional Website
  Issues:  Thin/minimal content

  ⚠ LIKELY FALSE POSITIVE. This page was built with Wix, which
    renders its content with JavaScript...
```

If you find a false positive the tool doesn't warn about, that's worth
reporting — it means a check needs tightening.

### Capturing evidence from a whole run

To improve the checks, the useful thing is a record of what they actually
measured. Add `--debug-log` to any normal run:

```
python leadgen.py "Garland" "TX" "plumber" --debug-log run1.jsonl
```

That writes one line per business examined — **including the ones skipped
for having a good website**, which never appear in the spreadsheet. Without
those, there's no way to spot a genuinely bad site the tool wrongly let
through.

Each line records the final URL after redirects, HTTP status, word count,
whether a viewport tag and schema.org markup were found, any site builder
detected, which issues fired, and the page's `<head>` (truncated). It
contains no API key or credentials — just public website data — but it's
plain text, so skim it before sending it anywhere.

Each run prints per-category result counts to the terminal and writes a new
`.xlsx` in the folder you run it from (unless you pass `--output`), named
like:

```
Leads_Plano_TX_plumber_2026-08-17_143052.xlsx
```

The name carries the date **and time**, so running the same city and service
twice in one day gives you two files instead of quietly overwriting the
first — which matters once you've started typing call notes into one. Files
also sort chronologically by name.

Note: checking each candidate's website adds a network request per lead with
a listed site, so a run with a lot of Tier 2 candidates will take noticeably
longer than a pure "no website" search did.

## Tiers and ranking — how the top 25 get picked

**Tier 1 — no real web presence** (highest priority): no website, social
media page only (Facebook/Instagram/etc.), or a website that's genuinely
broken (dead domain, timed out, 404'd, bad certificate). Ranked by review
count first, star rating as a tie-breaker — a business with proven customer
demand and effectively no usable web presence is the strongest pitch.

**Tier 2 — has a site, but it's weak**: the site loaded, but failed one or
more of the professionalism checks (no HTTPS, free page-builder subdomain, no
mobile viewport tag, thin content). Ranked by how many issues were found
first (the worse the site, the higher it ranks within this tier), then
review count, then rating.

Tier 1 leads always sort above Tier 2 leads. A site that passes every check
is not included at all — it's not a realistic lead for this pitch. Neither
is a site we couldn't read: those sit on the **Could Not Verify** tab and
never take a slot in your top 25.

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
- `Digital Presence Tier` and `Website Issues Found` tell you what's actually
  wrong so you can tailor the pitch — "your Wix site isn't mobile-friendly and
  has no booking system" lands differently than "you don't have a website at
  all."
- `AI Search Ready (schema.org)` is informational — a "No" here is a talking
  point (their competitors may start showing up in AI answer engines and they
  won't), not a qualification signal.
- Check the **Could Not Verify** tab before you finish a calling session.
  Those businesses blocked the automated check, so their site could be
  anything — open the link, and if it's bad, they're a lead you'd otherwise
  have missed.
- **"No Website" means Google's own listing had no website link — not that
  we double-checked.** Google's data can miss a real site, especially for a
  business with multiple locations (each city can have its own separately
  maintained Google listing, and they're not always filled out consistently).
  If a "No Website" lead's `Address` is in a different city than the one you
  searched, that's worth a quick manual Google search before you call —
  you may be looking at a business's secondary listing, not their main one.
- Copy/paste rows into your master financial-model Lead Tracker tab if you
  want everything in one workbook — note the column order here has several
  extra columns inserted after "Source" compared to the original tracker, so
  either insert matching columns there first or paste by mapping headers
  rather than a raw block copy.

## Known limitations

- Owner name/email enrichment isn't automated — see the note at the top.
  TDLR, TSBPE, county clerk, and SOSDirect sites are form-based, several are
  CAPTCHA-protected, and scraping them isn't reliable or guaranteed to respect
  their terms of use, so that step is manual by design for now.
- Website-quality checks are cheap heuristics (HTTPS, free-builder domain,
  viewport tag, word count), not a real audit — they're good enough to sort
  leads into "worth pitching" vs. "already fine," not to write a detailed
  SEO report. See `CLAUDE.md` for the decision to keep this free/heuristic
  for now, and when it'd make sense to upgrade to a paid site-audit API.
- Google Places Text Search returns at most ~60 results per query (3 pages of
  20) — this is a Google API limit, which is exactly why the existing strategy
  searches suburb-by-suburb (or ZIP-by-ZIP for Dallas proper) instead of
  city-wide for larger areas.
- No automated cross-run dedup — running the same city/service twice produces
  two separate files with overlapping leads.
- Sites built on Wix/Squarespace can be wrongly flagged "Thin/minimal
  content" — they load their text with JavaScript, which this script doesn't
  run. Worth a glance at the site before you use that specific point on a
  call.

## Why this stays a local script

A Cloudflare-hosted web version — usable from your phone, no Python needed —
was built and then removed. Three reasons:

1. **It needed a paid plan.** Cloudflare's free tier caps a run at 50
   outbound requests, and a 50-lead batch needs slightly more than that. $5/mo
   to run something that already runs free on your laptop wasn't worth it.
2. **The leads were less trustworthy.** Requests from Cloudflare's servers get
   challenged by bot protection far more often than requests from your home
   internet. Sites that load fine for you came back looking broken. Running
   from your own connection gets a more honest answer about whether a business's
   website actually works — which is the whole point of the tool.
3. **It needed a login system.** A public web address that spends your Google
   API key has to be locked down, which is a lot of moving parts for a tool
   only one person uses.

If you ever do want it on your phone badly enough to revisit this, the full
reasoning is in `CLAUDE.md` and the code is in this repo's git history.
