#!/usr/bin/env python3
"""
leadgen.py — pull local service-business leads with no real professional web
presence for a city/state/service, ranked into a Lead Tracker-formatted
spreadsheet. Built for pitching a professional website + SEO + AI-search
visibility + online booking (cal.com) package.

Usage:
    python leadgen.py "Garland" "TX" "plumber"
    python leadgen.py "Garland" "TX" "dog walker,pet groomer"
    python leadgen.py "Garland" "TX" --industry petcare
    python leadgen.py "Garland" "TX" "electrician" --limit 25 --output electricians.xlsx

Requires:
    GOOGLE_PLACES_API_KEY environment variable (required)

See README.md for setup instructions (getting a key, billing, install steps).

Design notes (why it works this way):
- Google Places Text Search (New) is the sole data source. It's the only
  practical API here that returns a business's actual website field
  (`websiteUri`), which everything else in this script depends on.
- A lead qualifies if it has NO website, only a social media page (Facebook/
  Instagram/etc.), an unreachable/broken website, or a website that fails
  one or more lightweight "is this professional" checks (HTTPS, free
  page-builder subdomain, mobile viewport tag, thin content). A business
  whose site passes all of those checks is not a lead — it already has a
  reasonably professional site and isn't a first target.
- Leads are grouped into two priority tiers: Tier 1 (no site / social-only /
  broken site — effectively zero real web presence) always outranks Tier 2
  (has a site, but it's weak/unprofessional). Within Tier 1, leads are
  ranked by review count then rating, same as before. Within Tier 2, leads
  are ranked by how many quality issues were found (worst sites first),
  falling back to review count then rating.
- AI-search readiness (schema.org/LocalBusiness structured data) is checked
  and reported as an informational column only — it does not affect tier or
  ranking, since it's meant for pitch prep, not lead qualification.
- Website-quality checks are done with plain requests + regex heuristics on
  purpose, no HTML-parsing dependency and no paid auditing API (see
  CLAUDE.md for the cost/quality tradeoff and when to revisit that).
- One run = one batch, capped at --limit (default 25) leads *after* ranking,
  so you're always working the strongest prospects first instead of just
  whatever came back in result order.
- Owner name and email are intentionally left blank. Those come from TDLR /
  TSBPE / county DBA / SOSDirect / Facebook lookups per the enrichment steps
  in Dallas_No_Website_Lead_Generation_Strategy.md — none of those sources
  have a reliable public API, so that step stays manual for now.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import date
from urllib.parse import urlparse

import requests
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

GOOGLE_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "")

SOCIAL_DOMAINS = ["facebook.com", "instagram.com", "linktr.ee", "m.me", "fb.com"]

# Free/starter page-builder domains -- a business on one of these (as their
# actual domain, not a custom domain) almost certainly never invested in a
# real site. Some of these platforms (e.g. wordpress.com) also power serious
# self-hosted sites on custom domains, so this only matches the free
# subdomain form, not WordPress in general.
WEAK_BUILDER_DOMAINS = [
    "wixsite.com",
    "weebly.com",
    "godaddysites.com",
    "square.site",
    "blogspot.com",
    "sites.google.com",
    "carrd.co",
    "yolasite.com",
    "webs.com",
    "jimdosite.com",
    "strikingly.com",
    "webnode.com",
    "wordpress.com",
]

# Below this word count on the fetched homepage, treat the site as
# thin/placeholder content rather than a real business site. Heuristic, not
# exact -- see CLAUDE.md.
THIN_CONTENT_WORD_THRESHOLD = 150

REQUEST_TIMEOUT = 8
# Identifies itself honestly as a bot rather than spoofing a browser --
# consistent with this project's stance on not impersonating a browser
# against sites we visit.
USER_AGENT = "Mozilla/5.0 (compatible; SMBLeadgenBot/1.0)"

HEADERS = [
    "Rank",
    "Business Name",
    "Niche/Category",
    "# Reviews",
    "Rating",
    "Phone / Contact",
    "Source (Maps/Drive-by)",
    "Digital Presence Tier",
    "Website URL",
    "Website Issues Found",
    "AI Search Ready (schema.org)",
    "Owner Name",
    "Email",
    "Owner/Email Source",
    "Outreach Date",
    "Status",
    "Next Follow-up",
    "Notes",
]

COLUMN_WIDTHS = [6, 30, 20, 10, 8, 16, 18, 24, 32, 40, 16, 20, 26, 20, 14, 12, 14, 30]


def normalize(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def to_num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def is_social_domain(domain):
    return any(s in domain for s in SOCIAL_DOMAINS)


def matching_weak_builder_domain(domain):
    for builder_domain in WEAK_BUILDER_DOMAINS:
        if domain == builder_domain or domain.endswith("." + builder_domain):
            return builder_domain
    return None


def has_https(final_url):
    return urlparse(final_url).scheme == "https"


def extract_visible_text(html_text):
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", html_text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def has_viewport_meta(html_text):
    return bool(re.search(r'(?i)<meta[^>]+name=["\']viewport["\']', html_text))


def is_thin_content(html_text):
    return len(extract_visible_text(html_text).split()) < THIN_CONTENT_WORD_THRESHOLD


def has_schema_markup(html_text):
    if "schema.org" in html_text and re.search(r'(?i)application/ld\+json', html_text):
        return True
    return bool(re.search(r'(?i)itemtype=["\']https?://schema\.org/', html_text))


def analyze_website(website_url):
    """Fetch a candidate's listed website once and classify it.

    Returns a dict with a "status" of "social_only", "unreachable",
    "weak" (has issues -- a lead), or "professional" (not a lead).
    "weak" results also include "issues" (list of str) and "ai_ready" (bool).
    """
    domain = urlparse(website_url).netloc.lower()
    if is_social_domain(domain):
        return {"status": "social_only"}

    try:
        resp = requests.get(
            website_url,
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
    except requests.exceptions.RequestException:
        return {"status": "unreachable"}

    if resp.status_code >= 400:
        return {"status": "unreachable"}

    html_text = resp.text or ""
    issues = []
    if not has_https(resp.url):
        issues.append("No HTTPS")
    builder_match = matching_weak_builder_domain(urlparse(resp.url).netloc.lower())
    if builder_match:
        issues.append(f"Free page-builder ({builder_match})")
    if not has_viewport_meta(html_text):
        issues.append("No mobile viewport tag")
    if is_thin_content(html_text):
        issues.append("Thin/minimal content")

    ai_ready = has_schema_markup(html_text)
    if issues:
        return {"status": "weak", "issues": issues, "ai_ready": ai_ready}
    return {"status": "professional", "ai_ready": ai_ready}


def google_text_search(query, api_key, max_pages=3):
    """Text Search (New). websiteUri triggers the Enterprise SKU — see README
    for the current per-1000-request cost and free monthly credit."""
    url = "https://places.googleapis.com/v1/places:searchText"
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "places.displayName,places.nationalPhoneNumber,"
            "places.websiteUri,places.formattedAddress,"
            "places.rating,places.userRatingCount,nextPageToken"
        ),
    }
    results = []
    body = {"textQuery": query}
    for page in range(max_pages):
        resp = requests.post(url, headers=headers, json=body, timeout=20)
        if resp.status_code != 200:
            print(f"    Google Places error {resp.status_code}: {resp.text[:300]}")
            break
        data = resp.json()
        results.extend(data.get("places", []))
        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(2)  # Google requires a short delay before a page token is valid
        body = {"textQuery": query, "pageToken": token}
    return results


def resolve_categories(service_arg, industry, categories_file):
    """A specific --service (or positional) list always wins. Otherwise fall
    back to a named preset in categories.json (default preset: trades)."""
    if service_arg:
        return [s.strip() for s in service_arg.split(",") if s.strip()]
    with open(categories_file) as f:
        cats = json.load(f)
    if industry not in cats:
        raise SystemExit(
            f"Unknown --industry '{industry}'. Options in {categories_file}: {list(cats)}"
        )
    return cats[industry]


def run(city, state, categories):
    location = f"{city}, {state}"
    all_leads = []
    stats = []
    seen_keys = set()

    for category in categories:
        query = f"{category} in {location}"
        print(f"Searching: {query}")
        places = google_text_search(query, GOOGLE_KEY)
        total = len(places)
        qualifying_count = 0

        for p in places:
            name = p.get("displayName", {}).get("text", "")
            phone = p.get("nationalPhoneNumber", "")
            website = p.get("websiteUri", "")
            key = phone or normalize(name)
            if not key or key in seen_keys:
                continue

            if not website:
                tier, severity = 0, 0
                presence_label = "No Website"
                website_url, issues_str, ai_ready_str = "", "", "N/A"
            else:
                analysis = analyze_website(website)
                status = analysis["status"]
                if status == "professional":
                    continue  # has a real, working, reasonably modern site -- not a lead
                website_url = website
                if status == "social_only":
                    tier, severity = 0, 0
                    presence_label = "Social Only (no real site)"
                    issues_str, ai_ready_str = "", "N/A"
                elif status == "unreachable":
                    tier, severity = 0, 0
                    presence_label = "Website Unreachable/Broken"
                    issues_str, ai_ready_str = "", "N/A"
                else:  # weak
                    tier = 1
                    severity = len(analysis["issues"])
                    presence_label = "Weak/Unprofessional Website"
                    issues_str = ", ".join(analysis["issues"])
                    ai_ready_str = "Yes" if analysis["ai_ready"] else "No"

            seen_keys.add(key)
            qualifying_count += 1
            all_leads.append(
                {
                    "Business Name": name,
                    "Niche/Category": category,
                    "# Reviews": p.get("userRatingCount", 0) or 0,
                    "Rating": p.get("rating", 0) or 0,
                    "Phone / Contact": phone,
                    "Source (Maps/Drive-by)": "Google Maps",
                    "Digital Presence Tier": presence_label,
                    "Website URL": website_url,
                    "Website Issues Found": issues_str,
                    "AI Search Ready (schema.org)": ai_ready_str,
                    "Owner Name": "",
                    "Email": "",
                    "Owner/Email Source": "",
                    "Outreach Date": "",
                    "Status": "New",
                    "Next Follow-up": "",
                    "Notes": "",
                    "_tier": tier,
                    "_severity": severity,
                }
            )

        stats.append((category, total, qualifying_count))
        print(f"  -> {total} results, {qualifying_count} qualifying leads")
        time.sleep(1)

    return all_leads, stats


def rank_and_trim(all_leads, limit):
    tier0 = [l for l in all_leads if l["_tier"] == 0]
    tier1 = [l for l in all_leads if l["_tier"] == 1]

    tier0_sorted = sorted(
        tier0, key=lambda l: (to_num(l.get("# Reviews")), to_num(l.get("Rating"))), reverse=True
    )
    tier1_sorted = sorted(
        tier1,
        key=lambda l: (l["_severity"], to_num(l.get("# Reviews")), to_num(l.get("Rating"))),
        reverse=True,
    )

    ranked = tier0_sorted + tier1_sorted
    kept = ranked[:limit]
    dropped = len(ranked) - len(kept)
    return kept, dropped


def write_output(leads, stats, dropped, limit, output_path, city, state):
    wb = Workbook()
    ws = wb.active
    ws.title = "Lead Tracker"

    ws.append(HEADERS)
    header_fill = PatternFill("solid", start_color="1F6FEB", end_color="1F6FEB")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill

    for i, lead in enumerate(leads, start=1):
        row = [i] + [lead.get(h, "") for h in HEADERS[1:]]
        ws.append(row)

    for col_letter, width in zip("ABCDEFGHIJKLMNOPQR", COLUMN_WIDTHS):
        ws.column_dimensions[col_letter].width = width

    summary = wb.create_sheet("Search Summary")
    summary.append([f"Search run: {city}, {state} — {date.today().isoformat()}"])
    summary.append([f"Batch limit: top {limit}, Tier 1 (no real site) ranked above Tier 2 (weak site)"])
    summary.append([f"Candidates found beyond the limit (not included): {dropped}"])
    summary.append([])
    summary.append(["Category", "# Results", "# Qualifying Leads"])
    for cell in summary[5]:
        cell.font = Font(bold=True)
    for row in stats:
        summary.append(list(row))
    summary.append([])
    summary.append(["Total leads in this batch:", len(leads)])
    summary.column_dimensions["A"].width = 30

    wb.save(output_path)
    print(f"\nSaved {len(leads)} leads (top {limit}, {dropped} more found but not included) to {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Pull a ranked, top-N lead batch (no website or unprofessional website) for a city/state/service into a Lead Tracker sheet."
    )
    parser.add_argument("city", help='e.g. "Garland"')
    parser.add_argument("state", help='e.g. "TX"')
    parser.add_argument(
        "service",
        nargs="?",
        default=None,
        help='Service type(s) to search, comma-separated, e.g. "plumber" or "dog walker,pet groomer". '
        "Overrides --industry when given.",
    )
    parser.add_argument(
        "--industry",
        default="trades",
        help="Category preset from categories.json, used only if 'service' is omitted (default: trades). Options: trades, petcare",
    )
    parser.add_argument(
        "--categories-file",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "categories.json"),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Max leads to keep per batch/run, ranked by tier then review count/rating (default: 25)",
    )
    parser.add_argument("--output", default=None, help="Output .xlsx path")
    args = parser.parse_args()

    if not GOOGLE_KEY:
        sys.exit(
            "GOOGLE_PLACES_API_KEY is not set. See README.md for how to get one, "
            "then set it as an environment variable before running this script."
        )

    categories = resolve_categories(args.service, args.industry, args.categories_file)
    label = args.service or args.industry
    output_path = (
        args.output
        or f"Leads_{args.city.replace(' ', '_')}_{args.state}_{label.replace(' ', '_').replace(',', '-')}_{date.today().isoformat()}.xlsx"
    )

    all_leads, stats = run(args.city, args.state, categories)
    kept, dropped = rank_and_trim(all_leads, args.limit)
    write_output(kept, stats, dropped, args.limit, output_path, args.city, args.state)


if __name__ == "__main__":
    main()
