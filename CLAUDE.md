# CLAUDE.md — smb_leadgen

Guidance for Claude Code (or any future contributor) picking up this repo.
Read this before making changes — several things here look like they could
be "improved" but are deliberate trade-offs; the reasoning is below so you
don't undo them by accident.

## What this is

A CLI tool that pulls a ranked, top-N batch of local service-business leads
that have **no website**, for a given city/state/service type, and writes
them to an Excel file formatted to match an existing manual "Lead Tracker"
workflow. Built for a one-person website agency (WebAgency) that cold-calls
small service businesses (plumbers, electricians, dog groomers, landscapers,
etc.) in the Dallas–Fort Worth metro to sell them a custom site.

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
.env.example             # names the two env vars the script reads
README.md               # user-facing usage docs — keep in sync with CLI flags
docs/
  Dallas_No_Website_Lead_Generation_Strategy.md   # business strategy, not code
```

There is currently no `tests/` directory in this repo — see "Testing" below,
that's the single biggest gap and a good first task.

## Architecture and why it's built this way

**Single-file script, no framework.** This runs on the business owner's own
laptop from a terminal, not as a deployed service. Keep it that way unless
asked to change the deployment model — don't introduce a web framework, a
database, or a package structure unless there's a concrete reason. If it
grows enough to justify splitting into modules, that's a reasonable
refactor, but keep the CLI ergonomics (`python leadgen.py CITY STATE
SERVICE`) intact.

**Google Places Text Search (New) is the source of truth for "has a
website."** It's the only one of the two integrated APIs that actually
returns a website field per business (`websiteUri`). Yelp's Fusion API does
**not** expose a business's external website — only its own Yelp page URL —
so Yelp-only results are always logged as `Website Status = "Unknown —
verify manually"`, never a confident "No Website." Don't "fix" this by
inferring website presence from Yelp data; there's nothing there to infer
from.

**`websiteUri` triggers Google's Enterprise SKU pricing** (~$35/1000
requests as of when this was built — verify current pricing before changing
the field mask, since Google's Places pricing tiers have moved before and
will again). The $200/month Maps Platform free credit comfortably covers
normal single-operator usage at ~1-3 pages per service/city run. If you add
more fields to the `X-Goog-FieldMask` in `google_text_search()`, check
whether they bump the SKU tier before assuming the cost is unchanged.

**Ranking is review count first, star rating as a tie-breaker**
(`rank_key()` / `rank_and_trim()`). Neither Google Places nor Yelp exposes a
"popularity" or "views" metric — this was the closest available proxy for
"proven customer demand, no website yet," which is the strongest cold-call
pitch. If you add a new ranking signal (e.g. days since last review, review
velocity), keep review-count-first as the default unless the business owner
asks for a different priority — this was a deliberate choice, not a
placeholder.

**One run = one batch, capped at `--limit` (default 25) *after* ranking.**
The cap exists so the operator always works the strongest prospects first
instead of an unranked dump. Don't remove the cap or make it unlimited by
default.

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

**Website classification also flags "Social Only."** If Google's
`websiteUri` resolves to a facebook.com/instagram.com/linktr.ee/etc. domain,
that's logged as `"Social Only (no real site)"` rather than `"No Website"` —
still a valid lead, but useful context for how the pitch gets framed on the
call. See `classify_website()` / `SOCIAL_DOMAINS`.

**Dedup is by phone number, falling back to a normalized business name**
(`normalize()` strips to lowercase alphanumerics). This is deliberately
simple — no fuzzy matching — because false-positive dedup (merging two
different businesses) is worse for a cold-call list than an occasional
missed duplicate.

## Known limitations / good next tasks

- **No automated tests ship in this repo.** Development so far was verified
  with ad hoc mock-based tests (mocking `google_text_search`/`yelp_search`
  to avoid needing real API keys, then asserting on `classify_website`,
  `normalize`, `resolve_categories`, `rank_and_trim`, and `write_output`).
  Formalizing that into a `tests/` dir with `pytest` (or even `unittest`,
  stdlib only, no new dependency) is probably the highest-value first PR.
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
  Google Places + Yelp. Worth revisiting only if Google Places costs become
  a real concern at higher volume — see the pricing note above before
  suggesting it purely for cost reasons, since the free credit likely still
  covers current usage.

## Conventions

- Keep `requirements.txt` minimal — `requests` + `openpyxl` only, unless a
  new capability genuinely requires something else.
- `categories.json` is the config surface for adding new service-type
  presets (mirrors the config-file pattern used in the separate WebAgency
  site-template repo, where all client customization lives in one
  `site.ts` — same philosophy here: business-user-editable data stays out
  of the Python).
- Keep `README.md`'s "Running it" examples in sync with any CLI flag
  changes — it's the operator's only reference, and they are not a
  developer.
- No secrets in the repo, ever. `GOOGLE_PLACES_API_KEY` / `YELP_API_KEY` are
  read from environment variables only; `.env.example` documents the names
  but is never meant to hold real values. `.gitignore` already excludes
  `.env` and generated `*.xlsx` output — don't relax either.
