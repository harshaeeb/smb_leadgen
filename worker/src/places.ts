/**
 * Google Places Text Search (New) -- the sole data source, same as the CLI.
 *
 * The field mask is identical to leadgen.py's on purpose. `places.websiteUri`
 * is what puts this on Google's Enterprise SKU (~$35/1000 requests when this
 * was built). Adding fields can bump the SKU tier -- verify current pricing
 * before touching the mask. See CLAUDE.md.
 */

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.displayName',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'nextPageToken',
].join(',');

export interface Place {
  displayName?: { text?: string };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function textSearch(query: string, apiKey: string, maxPages = 3): Promise<Place[]> {
  const results: Place[] = [];
  let body: Record<string, string> = { textQuery: query };

  for (let page = 0; page < maxPages; page++) {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      throw new Error(`Google Places error ${resp.status}: ${detail}`);
    }

    const data = (await resp.json()) as { places?: Place[]; nextPageToken?: string };
    results.push(...(data.places ?? []));

    if (!data.nextPageToken) break;
    // Google needs a moment before a freshly issued page token is valid.
    await sleep(2000);
    body = { textQuery: query, pageToken: data.nextPageToken };
  }

  return results;
}
