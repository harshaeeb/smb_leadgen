/**
 * Lead shape, tiering, and ranking.
 *
 * Mirrors `rank_and_trim()` in the root leadgen.py deliberately -- the two
 * implementations share no code (different languages, different runtimes),
 * so the tiering rules are duplicated here on purpose. If you change the
 * tier or severity rules in one, change them in the other, or the CLI and
 * the web app will disagree about what a lead is worth. See CLAUDE.md.
 */

/** Tier 1 in the docs/UI. No real web presence -- strongest prospects. */
export const TIER_NO_PRESENCE = 0;
/** Tier 2 in the docs/UI. Site loads but fails professionalism checks. */
export const TIER_WEAK_SITE = 1;

export type Tier = typeof TIER_NO_PRESENCE | typeof TIER_WEAK_SITE;

export interface Lead {
  name: string;
  category: string;
  reviews: number;
  rating: number;
  phone: string;
  website: string;
  /** null => unverified; held out of the ranked batch entirely. */
  tier: Tier | null;
  /** Operator-facing label, e.g. "No Website", "Weak/Unprofessional Website". */
  presence: string;
  /** Professionalism checks the site failed. Drives severity within tier 2. */
  issues: string[];
  /** Informational only -- never affects tier or severity. See CLAUDE.md. */
  aiReady: 'Yes' | 'No' | 'N/A';
  /** Why a lead is unverified, shown in the verify-manually list. */
  note?: string;
}

const byReviewsThenRating = (a: Lead, b: Lead): number =>
  b.reviews - a.reviews || b.rating - a.rating;

/**
 * Tier 1 leads always sort above tier 2. Within tier 1, review count then
 * rating. Within tier 2, severity (issue count) first -- within "has a bad
 * site," how bad it is beats raw popularity as a signal of how receptive
 * the pitch will be.
 *
 * Unverified leads (tier === null) are excluded here and surfaced
 * separately, so a site we merely failed to reach never displaces a real
 * lead from the batch.
 */
export function rankAndTrim(leads: Lead[], limit: number): { kept: Lead[]; dropped: number } {
  const noPresence = leads
    .filter((l) => l.tier === TIER_NO_PRESENCE)
    .sort(byReviewsThenRating);

  const weakSite = leads
    .filter((l) => l.tier === TIER_WEAK_SITE)
    .sort((a, b) => b.issues.length - a.issues.length || byReviewsThenRating(a, b));

  const ranked = [...noPresence, ...weakSite];
  return { kept: ranked.slice(0, limit), dropped: Math.max(0, ranked.length - limit) };
}

/** Dedup key: phone, falling back to a normalized name. Matches normalize() in leadgen.py. */
export function dedupKey(name: string, phone: string): string {
  return phone || name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
