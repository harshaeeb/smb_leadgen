# No-Website Lead Generation Strategy — Dallas Metro Service Businesses

*Prepared for WebAgency — extends the existing Search Query List / Lead Tracker workflow to close the owner-name and email gaps, and widens geographic coverage to the full Dallas metro.*

## 1. Objective

For each qualifying business, capture five fields: business name, owner/decision-maker name, phone, email, and no-website confirmation. Phone and business name are already reliably sourced through the current Google Maps process. Owner name and email are the two gaps this strategy targets, using free public records wherever possible before paying for a data tool.

## 2. Geographic scope: widen beyond the North Dallas suburbs

The current Search Query List covers Frisco, Plano, McKinney, Allen, The Colony, and Prosper — all north of Dallas proper. "In and around Dallas" is a larger footprint. Recommend adding a second wave of suburbs once the first six are worked through:

| Tier | Suburbs |
| --- | --- |
| Already in Search Query List | Frisco, Plano, McKinney, Allen, The Colony, Prosper |
| Add — inner-ring, high density | Dallas (by ZIP/quadrant, since city-wide caps at ~120 Maps results), Garland, Richardson, Irving, Mesquite, Carrollton |
| Add — western/southern ring | Grand Prairie, Lewisville, Addison, Farmers Branch, DeSoto, Duncanville, Cedar Hill |

Dallas proper should be split by ZIP code or quadrant (e.g., "HVAC repair 75214", "HVAC repair Oak Cliff") rather than searched as one query, for the same reason suburb-level searches were chosen originally — Google Maps caps around 120 results per query.

## 3. Step 1 — Source the raw list (business name, category, phone, no-website flag)

The manual per-suburb Google Maps search already in use is the right free baseline. Three ways to speed it up, in order of how well they fit "paid lead-gen not appropriate yet":

**Stay manual and free.** Keep working the Search Query List suburb-by-suburb. Zero cost, just time. Best default for the current volume.

**Add a bulk scraper only where it saves meaningful time.** Purpose-built "no website" scrapers now exist and return name, category, address, phone, rating, and a website-present flag in one export: Outscraper's Google Maps scraper (pay-per-result, no-code or API), Apify's Google Maps No-Website Leads Scraper (pay-per-result, includes a lead score), and B2BLeadFinder (subscription from ~$9/month, 7-day free trial, scans by city/industry and flags no-website + low-review businesses). These replace the manual Maps searching step only — they don't solve owner name or email, so they're an accelerant for Step 1, not a full solution.

**Cross-check Yelp, Nextdoor, and BBB listings** for the same trade/suburb combos already run. These occasionally surface businesses Google Maps ranks low, and Nextdoor recommendation threads are a good signal for reviews without a matching website.

## 4. Step 2 — Confirm "no website" is accurate

Scrapers and manual review both make mistakes here: a Facebook Page, a Linktree, or a third-party directory profile can look like a website in a Maps listing but isn't a real site. Before logging a lead, do a 15-second check: search "[business name] [suburb] TX," and if a domain does turn up, run it through Wappalyzer or BuiltWith to see if it's abandoned/parked (a real signal for a "your site looks outdated" pitch angle) versus genuinely live.

## 5. Step 3 — Owner name (the main gap)

This is where trade licensing and county/state filings do most of the work, because Texas requires an individual's real name on file — not just a business name — through several free, official channels:

**State trade license lookups (fastest, and ties directly to the trades already targeted).** Texas splits licensing across three agencies, so match the lookup to the trade: HVAC and electrical are licensed through TDLR ([tdlr.texas.gov/licensesearch](https://www.tdlr.texas.gov/licensesearch/)); plumbing is licensed through the Texas State Board of Plumbing Examiners, not TDLR ([tsbpe.texas.gov/license-verification](https://tsbpe.texas.gov/license-verification/)); pest control applicators are licensed through the Texas Department of Agriculture. All three let you search by business name or city and return the licensed individual's name — usually the owner for a small shop. TDLR also publishes a bulk-downloadable "All Licenses" dataset on the Texas Open Data Portal, which is worth pulling once and filtering locally for Dallas-area ZIP codes and the relevant license types (HVAC/ACR, electrical) rather than searching one business at a time.

**County Assumed Name (DBA) records — for the trades with no state license** (roofing, fencing, tree service, foundation repair, appliance repair, garage door repair, pool service). Sole proprietors and general partnerships file their DBA at the county clerk, and the filing lists the real owner's name. All three relevant counties have free online search portals: Dallas County ([dallas.tx.publicsearch.us](https://dallas.tx.publicsearch.us/)), Collin County ([collin.tx.publicsearch.us](https://collin.tx.publicsearch.us/)), and Denton County (via the county clerk's records search). Search by business name to pull the filer's name directly.

**SOSDirect for LLCs and corporations.** If the business is registered as an LLC or corp rather than a sole prop, the county won't have it — the assumed name filing (if any) is with the Texas Secretary of State instead, searchable through SOSDirect for a $1 statutory fee per search. The Public Information Report on file there lists managers/members, which is usually the owner.

**Facebook as a free first pass.** Most small trade businesses run an active Facebook Page even without a website. The "About" section, team/staff photos, and the profile that posts as the Page admin frequently name the owner directly, and it's worth checking before spending a state or county search fee.

Recommended order per lead: Facebook check (free, 1 minute) → trade license lookup if applicable (free) → county DBA search if no license applies (free) → SOSDirect only if the first three come up empty and the business appears to be an LLC (small fee, use sparingly).

## 6. Step 4 — Phone

Already covered by the existing process (Maps listing, Yelp). Trade license records and county DBA filings sometimes list a phone number too, which is a useful cross-check when the Maps-listed number turns out to be disconnected.

## 7. Step 5 — Email (the second gap)

Email is genuinely harder for owner-operated local trades, since most don't have a company domain to run a domain-based finder against. Layered approach, cheapest first:

**Check the free sources already touched in Step 3.** Facebook Page "About" sections often list an email directly. Google Business Profile listings occasionally include one under additional info. TDLR, TSBPE, and county DBA filings sometimes capture an email on the application — worth checking, but coverage varies.

**If a domain exists anywhere** (even a dead or parked one found in Step 2's Wappalyzer check), run it through a domain-based finder — Hunter.io or Skrapp both work on a single-domain, pay-as-you-go basis and don't require a subscription commitment. These tools are built for real B2B domains with a website behind them, so they'll return nothing for a business that has never owned a domain — expect a low hit rate here given the target segment.

**Ask directly on the call.** Given the hit-and-miss nature of the above, the most reliable email source for this specific segment is the cold call itself: "I'll email over a free mockup of what your homepage could look like — what's the best address?" This also naturally qualifies interest before spending outreach effort. Recommend making this a standard line in the cold-call script and adding an Email column to the Lead Tracker that gets filled in during/after the call rather than before it.

**Treat email as best-effort, not a blocker.** Given the low hit rate of automated tools for this segment, don't let a missing email hold up outreach — phone remains the primary channel per the existing strategy, with email captured opportunistically.

## 8. Compliance guardrails (TX SB 140)

Confirmed current as of this search: calling window is 9 AM–9 PM Monday–Saturday and 12 PM–9 PM Sunday (the existing notes had the Sunday window slightly off — Sunday starts at noon, not 9 AM). Manual dial only for cell numbers still applies. SB 140 also now folds text messages/MMS into the definition of "telephone solicitation," with a $200 registration fee and $10,000 bond required for sellers doing telemarketing texts — though the Secretary of State has indicated consent-based texts (i.e., texting someone who already gave a number/agreed to follow-up) fall outside that registration requirement. If SMS ever gets added to the outreach mix beyond the current call-first approach, this is worth revisiting with more current guidance before sending any bulk texts.

## 9. Updated Lead Tracker columns

Recommend adding two columns to the existing Lead Tracker tab so the new fields have a home: **Owner Name** and **Email**, plus an optional **Source** note (e.g., "TDLR," "Dallas Co. DBA," "Facebook," "asked on call") so it's clear later which record to double check if a lead goes stale.

## 10. Recommended default workflow (no new spend)

1. Work the Search Query List suburb-by-suburb as today; add the inner-ring and outer-ring suburbs from Section 2 once the current six are exhausted.
2. For each no-website hit, confirm via the 15-second domain check (Section 4).
3. Pull owner name via the free-first cascade in Section 5.
4. Log phone from Maps/Yelp/license record.
5. Attempt email via free sources only; leave blank if nothing surfaces and plan to ask on the call.
6. Cold call within TX SB 140 hours, using the "email you a free mockup" line to capture email post-call.
7. Only bring in a paid scraper (Outscraper, Apify, or B2BLeadFinder) if manual Maps sourcing becomes the bottleneck rather than owner/email enrichment.

Sources: [Outscraper Google Maps Scraper](https://outscraper.com/google-maps-scraper/), [Apify Google Maps No-Website Leads Scraper](https://apify.com/blackfalcondata/google-maps-no-website-leads-scraper), [B2BLeadFinder](https://b2bleadfinder.io/blog/how-to-find-businesses-without-websites), [TDLR License Search](https://www.tdlr.texas.gov/licensesearch/), [TDLR All Licenses Open Data](https://data.texas.gov/dataset/TDLR-All-Licenses/7358-krk7), [Texas State Board of Plumbing Examiners License Verification](https://tsbpe.texas.gov/license-verification/), [SOSDirect](https://www.sos.state.tx.us/corp/sosda/index.shtml), [Dallas County Assumed Name Search](https://dallas.tx.publicsearch.us/), [Collin County Records Search](https://collin.tx.publicsearch.us/), [Texas SB 140 Overview — Vorys](https://www.vorys.com/publication-texas-sb-140-requirements), [Texas SB 140 — Godfrey & Kahn](https://www.gklaw.com/Insights/Texas-Says-Dont-Mess-with-Texts--New-SMS-Rules-Hit-September-1-2025.htm)
