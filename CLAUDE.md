# CLAUDE.md — smb_leadgen

Guidance for Claude Code (or any future contributor) picking up this repo.
Read this before making changes — several things here look like they could
be "improved" but are deliberate trade-offs; the reasoning is below so you
don't undo them by accident.

## What this is

A CLI tool that pulls a ranked, top-N batch of local service-business leads
that have **no real professional web presence** — no website, a social-media
page only, a broken/unreachable website, or a website that fails basic
professionalism checks — for a given city/state/service type, and writes
them to an Excel file formatted to match an existing manual "Lead Tracker"
workflow. Built for a one-person website agency (WebAgency) that cold-calls
small service businesses (plumbers, electricians, dog groomers, landscapers,
etc.) in the Dallas–Fort Worth metro to sell them a professional website with
SEO, AI-search visibility (schema.org/structured data so businesses show up
in AI answer engines, not just classic search), and online booking via
cal.com.

Full business context and the manual enrichment steps this tool doesn't
automate: [`docs/Dallas_No_Website_Lead_Generation_Strategy.md`](docs/Dallas_No_Website_Lead_Generation_Strategy.md).
Read that before proposing changes to what data gets collected or how leads
are qualified — it explains *why* certain fields (owner name, email) are
intentionally left for manual follow-up.

## Repo layout

```
leadgen.py              # everything lives in one file, on purpose (see below)
categories.json         # editable service-type presets ("trades", "petcare")
requirements.txt        # requests, openpyxl — kept minimal on purpose
.env.example             # names the one env var the script reads
README.md               # user-facing usage docs — keep in sync with CLI flags
docs/
  Dallas_No_Website_Lead_Generation_Strategy.md   # business strategy, not code
```

There is currently no `tests/` directory in this repo — see "Known
limitations / good next tasks" below, that's the single biggest gap and a
good first task.

## Architecture and why it's built this way

**Single-file script, no framework.** This runs on the business owner's own
laptop from a terminal, not as a deployed service. Keep it that way unless
asked to change the deployment model — don't introduce a web framework, a
database, or a package structure unless there's a concrete reason. If it
grows enough to justify splitting into modules, that's a reasonable
refactor, but keep the CLI ergonomics (`python leadgen.py CITY STATE
SERVICE`) intact.

**Google Places Text Search (New) is the sole data source.** It's the only
practical API here that returns a website field per business (`websiteUri`),
which the whole qualification pipeline depends on. A Yelp Fusion cross-check
existed in an earlier version of this tool and was **removed** — Yelp never
exposed a business's external website (only its own Yelp page URL), so
Yelp-sourced leads could only ever be logged "Unknown — verify manually,"
and Yelp's usage costs stopped being worth that limited signal. Don't re-add
it purely to widen result coverage without discussing the cost/benefit with
the business owner again.

**`websiteUri` triggers Google's Enterprise SKU pricing** (~$35/1000
requests as of when this was built — verify current pricing before changing
the field mask, since Google's Places pricing tiers have moved before and
will again). The $200/month Maps Platform free credit comfortably covers
normal single-operator usage at ~1-3 pages per service/city run. If you add
more fields to the `X-Goog-FieldMask` in `google_text_search()`, check
whether they bump the SKU tier before assuming the cost is unchanged.

**Lead qualification is now tiered, not a single "has website" boolean.**
See `analyze_website()` and `run()`:

- **Tier 1** (highest priority): no `websiteUri` at all, a `websiteUri` that
  resolves to a social-media domain (`SOCIAL_DOMAINS` — Facebook/Instagram/
  Linktree/etc.), or a site that errors/times out/404s when fetched
  (`"Website Unreachable/Broken"`). These businesses have effectively zero
  real web presence — a website that doesn't load at all is, if anything, a
  *stronger* pitch than one that's merely outdated, so broken sites rank
  with Tier 1, not Tier 2. Ranked by review count first, rating as a
  tie-breaker (unchanged from the original single-tier design).
- **Tier 2**: the site loads, but fails one or more professionalism checks —
  no HTTPS, hosted on a free page-builder subdomain (`WEAK_BUILDER_DOMAINS`),
  no mobile viewport meta tag, or thin/placeholder content
  (`THIN_CONTENT_WORD_THRESHOLD`). Ranked *within the tier* by number of
  issues found first (worse sites first), then review count, then rating —
  this is a deliberate departure from pure review-count-first ranking,
  because within "has a bad site" the severity of the problem is a better
  signal of how receptive/needed the pitch is than review count alone.
- **Not a lead**: the site loads and passes every check. This mirrors the
  original tool's "Has Website" exclusion — a professional site isn't a
  first target for this pitch.
- Tier 1 always sorts above Tier 2 in the final ranked list (`rank_and_trim`
  sorts each tier independently, then concatenates Tier 1 + Tier 2 before
  trimming to `--limit`). Don't merge them into one flat sort — that was an
  explicit decision (see conversation history / commit messages around this
  redesign), not an oversight.

**Website-quality checks are free heuristics on purpose — no HTML-parsing
dependency, no paid audit API.** `analyze_website()` fetches each candidate's
homepage once with `requests` and checks it with plain regex
(`has_https`, `matching_weak_builder_domain`, `has_viewport_meta`,
`is_thin_content`) rather than a proper HTML parser like BeautifulSoup, and
without calling a paid site-auditing service (e.g. Google PageSpeed Insights,
which does have a free quota, or a commercial SEO-audit API). **This was an
explicit, budget-driven decision** — the business owner had just dropped
Yelp for being too expensive when this redesign happened, and wants to stay
on free tools until real-world results (lead conversion, or the heuristics
producing too many false positives/negatives) justify paying for something
more rigorous. **If you're asked to improve accuracy here, treat it as an
enhancement request with this context already established** — don't silently
swap in BeautifulSoup or a paid API; surface the cost/benefit and let the
business owner decide again, same as the original Yelp call.

**AI-search readiness is informational only, not a qualification/ranking
signal.** `has_schema_markup()` checks for `schema.org` JSON-LD or microdata
on a fetched site and is reported in the `AI Search Ready (schema.org)`
column so the operator can use it in the pitch ("your competitors are
starting to show up in AI search and you won't"). It intentionally does
**not** affect tier or severity — that was a specific decision to keep the
tiering logic scoped to the 4 signals above. Don't fold it into severity
scoring without checking first.

**Dedup is by phone number, falling back to a normalized business name**
(`normalize()` strips to lowercase alphanumerics). This is deliberately
simple — no fuzzy matching — because false-positive dedup (merging two
different businesses) is worse for a cold-call list than an occasional
missed duplicate. Dedup happens *before* the website fetch (checked via
`seen_keys`) so duplicate listings don't trigger a redundant HTTP request.

**Owner name and email are intentionally left blank.** These come from
Texas trade-license lookups (TDLR/TSBPE/TDA), county Assumed Name (DBA)
filings, SOSDirect, and Facebook — see the strategy doc for the full
cascade. None of those sources have a reliable public API: several are
CAPTCHA-protected, form-based, or have terms of use that make scraping risky
for a small business to depend on. **Do not build an automated scraper
against those sites** without discussing it with the user first — this was
a deliberate scope decision, not an oversight. A reasonable middle-ground
enhancement (discussed but deferred, not yet built): auto-generate
click-through search URLs per lead, pre-filled with the business name where
the target site supports query params, so the operator can enrich faster
without me impersonating a browser against a form.

**One run = one batch, capped at `--limit` (default 25) *after* ranking.**
The cap exists so the operator always works the strongest prospects first
instead of an unranked dump. Don't remove the cap or make it unlimited by
default.

**The site-quality fetch identifies itself honestly.** `USER_AGENT` in
`leadgen.py` names the script as a bot rather than spoofing a browser's
user-agent string — consistent with this project's existing stance (see the
owner-name/email section above) of not impersonating a browser against sites
it visits. Keep that if you touch the fetch logic.

## Known limitations / good next tasks

- **No automated tests ship in this repo.** Development so far was verified
  with ad hoc mock-based tests (mocking `google_text_search` and
  `requests.get` to avoid needing real API keys or live network calls, then
  asserting on `analyze_website`, `has_https`, `has_viewport_meta`,
  `is_thin_content`, `has_schema_markup`, `matching_weak_builder_domain`,
  `normalize`, `resolve_categories`, `rank_and_trim`, and `write_output`).
  Formalizing that into a `tests/` dir with `pytest` (or even `unittest`,
  stdlib only, no new dependency) is probably the highest-value first PR.
- **Website-quality checks are heuristic, not a real audit — revisit if
  results are poor.** If the business owner reports the Tier 2 list is
  producing too many false positives (flagging genuinely fine sites) or
  false negatives (missing obviously bad ones), or if lead conversion data
  suggests the heuristics aren't finding the right prospects, that's the
  trigger to revisit the free-tools-only decision above — e.g. add Google
  PageSpeed Insights (still free-tier) for a real performance/SEO score, or
  a paid site-audit API for more signals. Don't make that switch
  speculatively; it's explicitly deferred pending real usage data.
- **No cross-run dedup.** Running the same city/service twice produces two
  separate files with overlapping leads. An operator-facing enhancement
  would be an optional `--seen-file` that persists phone numbers already
  surfaced across runs and skips them.
- **No append-to-master-tracker mode.** Every run creates a new `.xlsx`;
  the operator currently copy/pastes rows into a master tracker by hand. An
  `--append <path> --sheet <name>` flag that finds the last used row and
  inserts below it (without disturbing existing formatting/validation)
  would close that gap — but check with the user before assuming the
  target file's row limits/structure, since the existing manual tracker has
  a hard-coded 60-row formatting limit that would need handling.
- **Manual CSV import was considered and deferred** as an alternative/
  supplement to the Google Places API (for zero-API-key usage). Still a
  reasonable addition if the user wants a no-credentials-required path.
- **Outscraper/Apify integration was considered and deferred** in favor of
  Google Places alone. Worth revisiting only if Google Places costs become a
  real concern at higher volume — see the pricing note above before
  suggesting it purely for cost reasons, since the free credit likely still
  covers current usage.
- **Website-fetch performance.** Each Tier-2-candidate site adds a network
  round trip (`REQUEST_TIMEOUT = 8` seconds worst case), so a run with many
  listed-but-unverified websites is noticeably slower than a pure "no
  website" search was. Worth revisiting (e.g. concurrent fetches) only if
  this becomes a real usability problem at the batch sizes the owner
  actually runs.

## Conventions

- Keep `requirements.txt` minimal — `requests` + `openpyxl` only, unless a
  new capability genuinely requires something else. This was reaffirmed
  during the website-quality-checks redesign: HTML parsing uses stdlib
  regex rather than adding BeautifulSoup, specifically to keep this
  convention intact (see the "free heuristics" note above).
- `categories.json` is the config surface for adding new service-type
  presets (mirrors the config-file pattern used in the separate WebAgency
  site-template repo, where all client customization lives in one
  `site.ts` — same philosophy here: business-user-editable data stays out
  of the Python).
- Keep `README.md`'s "Running it" examples in sync with any CLI flag
  changes — it's the operator's only reference, and they are not a
  developer.
- No secrets in the repo, ever. `GOOGLE_PLACES_API_KEY` is read from an
  environment variable only; `.env.example` documents the name but is never
  meant to hold a real value. `.gitignore` already excludes `.env` and
  generated `*.xlsx` output — don't relax either. (This repo previously had
  a plaintext API key file committed by mistake; it was removed and
  `.gitignore`'d — don't let that recur.)
