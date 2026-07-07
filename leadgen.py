#!/usr/bin/env python3
"""
leadgen.py — pull "no website" service-business leads for a city/state/service
into a ranked, Lead Tracker-formatted spreadsheet.

Usage:
    python leadgen.py "Garland" "TX" "plumber"
    python leadgen.py "Garland" "TX" "dog walker,pet groomer"
    python leadgen.py "Garland" "TX" --industry petcare
    python leadgen.py "Garland" "TX" "electrician" --limit 25 --output electricians.xlsx

Requires:
    GOOGLE_PLACES_API_KEY environment variable (required)
    YELP_API_KEY environment variable (optional, enables the Yelp cross-check)

See README.md for setup instructions (getting keys, billing, install steps).

Design notes (why it works this way):
- Google Places Text Search (New) is the source of truth for "has a website or
  not" — it's the only one of the two APIs that actually returns a website
  field per business.
- Yelp's Fusion API does NOT expose a business's external website field, only
  its own Yelp page URL — so Yelp results can add businesses Google missed,
  but they're always logged as "Unknown — verify manually" rather than a
  confident "No Website", to avoid a false claim.
- Ranking: neither API exposes a "popularity" or "views" metric, so both
  sources are ranked the same way — review count first, rating as a
  tie-breaker — as the best available proxy for "proven demand, no website
  yet," which is exactly the profile worth prioritizing for a cold-call list.
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
YELP_KEY = os.environ.get("YELP_API_KEY", "")

SOCIAL_DOMAINS = ["facebook.com", "instagram.com", "linktr.ee", "m.me", "fb.com"]

HEADERS = [
    "Rank",
    "Business Name",
    "Niche/Category",
    "# Reviews",
    "Rating",
    "Phone / Contact",
    "Source (Maps/Yelp/Drive-by)",
    "Website Status",
    "Owner Name",
    "Email",
    "Owner/Email Source",
    "Outreach Date",
    "Status",
    "Next Follow-up",
    "Notes",
]

COLUMN_WIDTHS = [6, 30, 20, 10, 8, 16, 22, 24, 20, 26, 20, 14, 12, 14, 30]


def normalize(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def classify_website(uri):
    if not uri:
        return "No Website"
    domain = urlparse(uri).netloc.lower()
    if any(s in domain for s in SOCIAL_DOMAINS):
        return "Social Only (no real site)"
    return "Has Website"


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


def yelp_search(term, location, api_key):
    """Yelp's default sort is 'best_match' (its own internal relevance/rank),
    which is as close to a Yelp 'ranking' signal as the public API exposes.
    We still re-rank everything downstream by review_count/rating so Google
    and Yelp results sit on one consistent scale."""
    url = "https://api.yelp.com/v3/businesses/search"
    headers = {"Authorization": f"Bearer {api_key}"}
    params = {"term": term, "location": location, "limit": 50}
    resp = requests.get(url, headers=headers, params=params, timeout=20)
    if resp.status_code != 200:
        print(f"    Yelp error {resp.status_code}: {resp.text[:300]}")
        return []
    return resp.json().get("businesses", [])


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


def rank_key(lead):
    def to_num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    return (to_num(lead.get("# Reviews")), to_num(lead.get("Rating")))


def run(city, state, categories, use_yelp):
    location = f"{city}, {state}"
    all_leads = []
    stats = []
    seen_keys = set()

    for category in categories:
        query = f"{category} in {location}"
        print(f"Searching: {query}")
        places = google_text_search(query, GOOGLE_KEY)
        total = len(places)
        no_website_count = 0
        google_names_seen = set()

        for p in places:
            name = p.get("displayName", {}).get("text", "")
            phone = p.get("nationalPhoneNumber", "")
            website = p.get("websiteUri", "")
            status = classify_website(website)
            google_names_seen.add(normalize(name))
            key = phone or normalize(name)
            if status != "Has Website" and key and key not in seen_keys:
                seen_keys.add(key)
                no_website_count += 1
                all_leads.append(
                    {
                        "Business Name": name,
                        "Niche/Category": category,
                        "# Reviews": p.get("userRatingCount", 0) or 0,
                        "Rating": p.get("rating", 0) or 0,
                        "Phone / Contact": phone,
                        "Source (Maps/Yelp/Drive-by)": "Google Maps",
                        "Website Status": status,
                        "Owner Name": "",
                        "Email": "",
                        "Owner/Email Source": "",
                        "Outreach Date": "",
                        "Status": "New",
                        "Next Follow-up": "",
                        "Notes": "",
                    }
                )

        if use_yelp and YELP_KEY:
            businesses = yelp_search(category, location, YELP_KEY)
            for b in businesses:
                name = b.get("name", "")
                if normalize(name) in google_names_seen:
                    continue  # already covered by the Google search above
                phone = b.get("display_phone", "")
                key = phone or normalize(name)
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                all_leads.append(
                    {
                        "Business Name": name,
                        "Niche/Category": category,
                        "# Reviews": b.get("review_count", 0) or 0,
                        "Rating": b.get("rating", 0) or 0,
                        "Phone / Contact": phone,
                        "Source (Maps/Yelp/Drive-by)": "Yelp",
                        "Website Status": "Unknown — verify manually",
                        "Owner Name": "",
                        "Email": "",
                        "Owner/Email Source": "",
                        "Outreach Date": "",
                        "Status": "New",
                        "Next Follow-up": "",
                        "Notes": "",
                    }
                )

        stats.append((category, total, no_website_count))
        print(f"  -> {total} results, {no_website_count} no-website leads")
        time.sleep(1)

    return all_leads, stats


def rank_and_trim(all_leads, limit):
    ranked = sorted(all_leads, key=rank_key, reverse=True)
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

    for col_letter, width in zip("ABCDEFGHIJKLMNO", COLUMN_WIDTHS):
        ws.column_dimensions[col_letter].width = width

    summary = wb.create_sheet("Search Summary")
    summary.append([f"Search run: {city}, {state} — {date.today().isoformat()}"])
    summary.append([f"Batch limit: top {limit}, ranked by # Reviews then Rating"])
    summary.append([f"Candidates found beyond the limit (not included): {dropped}"])
    summary.append([])
    summary.append(["Category", "# Results", "# No-Website Leads"])
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
        description="Pull a ranked, top-N no-website service-business lead batch for a city/state/service into a Lead Tracker sheet."
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
        help="Max leads to keep per batch/run, ranked by # Reviews then Rating (default: 25)",
    )
    parser.add_argument("--output", default=None, help="Output .xlsx path")
    parser.add_argument(
        "--no-yelp", action="store_true", help="Skip the Yelp cross-check even if YELP_API_KEY is set"
    )
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

    all_leads, stats = run(args.city, args.state, categories, use_yelp=not args.no_yelp)
    kept, dropped = rank_and_trim(all_leads, args.limit)
    write_output(kept, stats, dropped, args.limit, output_path, args.city, args.state)


if __name__ == "__main__":
    main()
