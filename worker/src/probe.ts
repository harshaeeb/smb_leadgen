/**
 * Site probing: fetch a candidate's homepage once and decide what it tells
 * us about their web presence.
 *
 * Two things here differ from leadgen.py, both deliberate:
 *
 * 1. Structural checks (viewport meta, schema.org markup) use HTMLRewriter,
 *    Cloudflare's native streaming HTML parser, instead of regex. It handles
 *    malformed markup properly and costs no dependency -- it's built into the
 *    runtime, so the "requests + openpyxl only" spirit of the CLI's minimal
 *    dependency rule survives intact.
 *
 * 2. Failure classification distinguishes "broken" from "blocked". This
 *    matters more than anything else in this file. Worker subrequests come
 *    from Cloudflare datacenter IPs, which WAFs and bot management routinely
 *    challenge or 403 -- the same site often loads fine from the operator's
 *    residential connection. Reporting a blocked fetch as "Website
 *    Unreachable/Broken" would put a business with a perfectly good site at
 *    the top of the call list, and the operator would open with "your website
 *    is down." That is a worse outcome than missing the lead, so anything
 *    ambiguous is held out of the ranked batch as unverified.
 */

import { TIER_NO_PRESENCE, TIER_WEAK_SITE, type Lead } from './rank';

export const SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'linktr.ee',
  'm.me',
  'fb.com',
];

/**
 * Free/starter page-builder domains. Matched only in their free-subdomain
 * form -- several of these platforms also power serious sites on custom
 * domains, which are not a signal of neglect.
 */
export const WEAK_BUILDER_DOMAINS = [
  'wixsite.com',
  'weebly.com',
  'godaddysites.com',
  'square.site',
  'blogspot.com',
  'sites.google.com',
  'carrd.co',
  'yolasite.com',
  'webs.com',
  'jimdosite.com',
  'strikingly.com',
  'webnode.com',
  'wordpress.com',
];

export const THIN_CONTENT_WORD_THRESHOLD = 150;
export const REQUEST_TIMEOUT_MS = 8000;

/** Identifies the script honestly as a bot rather than spoofing a browser. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; SMBLeadgenBot/1.0)';

/** Cap on HTML read per site, so one enormous page can't burn the CPU budget. */
const MAX_HTML_BYTES = 512 * 1024;

export function isSocialDomain(host: string): boolean {
  return SOCIAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d) || host.includes(d));
}

export function matchingWeakBuilderDomain(host: string): string | null {
  return WEAK_BUILDER_DOMAINS.find((d) => host === d || host.endsWith('.' + d)) ?? null;
}

/** Markers that mean "a bot wall answered", not "this business has no site". */
const CHALLENGE_PATTERNS =
  /just a moment|attention required|checking your browser|cf-browser-verification|access denied|enable javascript and cookies|request unsuccessful|are you a robot/i;

export type ProbeOutcome =
  | { kind: 'social' }
  | { kind: 'broken'; reason: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'loaded'; issues: string[]; aiReady: boolean };

interface PageFacts {
  hasViewport: boolean;
  hasSchema: boolean;
  words: number;
}

/**
 * Structural checks via HTMLRewriter. Text is counted from <body> with
 * script/style/noscript/template subtrees skipped, so boilerplate JS doesn't
 * inflate the word count past the thin-content threshold.
 */
async function readPage(html: string): Promise<PageFacts> {
  const facts: PageFacts = { hasViewport: false, hasSchema: false, words: 0 };
  let skipDepth = 0;

  const rewriter = new HTMLRewriter()
    .on('script, style, noscript, template', {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on('meta[name="viewport"]', {
      element() {
        facts.hasViewport = true;
      },
    })
    .on('script[type="application/ld+json"]', {
      text(chunk) {
        if (chunk.text.includes('schema.org')) facts.hasSchema = true;
      },
    })
    .on('[itemtype]', {
      element(el) {
        const t = el.getAttribute('itemtype') ?? '';
        if (/schema\.org/i.test(t)) facts.hasSchema = true;
      },
    })
    .on('body', {
      text(chunk) {
        if (skipDepth > 0) return;
        const t = chunk.text.trim();
        if (t) facts.words += t.split(/\s+/).length;
      },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();

  // Some pages omit an explicit <body>, which leaves the word count at zero
  // and would false-positive as thin content. Fall back to a tag strip.
  if (facts.words === 0) {
    const stripped = html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    facts.words = stripped ? stripped.split(' ').length : 0;
  }

  return facts;
}

async function readBounded(resp: Response): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(buf);
}

export async function probe(websiteUri: string): Promise<ProbeOutcome> {
  let host: string;
  try {
    host = new URL(websiteUri).hostname.toLowerCase();
  } catch {
    return { kind: 'broken', reason: 'Malformed website URL on the listing' };
  }

  if (isSocialDomain(host)) return { kind: 'social' };

  let resp: Response;
  try {
    resp = await fetch(websiteUri, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    // DNS failure, connection refused, TLS failure, timeout. These are the
    // failures we can attribute to the site rather than to being blocked.
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'broken', reason: /timed? ?out|aborted/i.test(msg) ? 'Timed out' : 'Unreachable' };
  }

  const status = resp.status;

  // A bot wall answered. Says nothing about whether the business has a real
  // site, so this must never become a Tier 1 lead.
  if (resp.headers.has('cf-mitigated') || status === 403 || status === 429) {
    await resp.body?.cancel().catch(() => {});
    return { kind: 'blocked', reason: `Blocked by bot protection (HTTP ${status})` };
  }

  if (status === 404 || status === 410) {
    await resp.body?.cancel().catch(() => {});
    return { kind: 'broken', reason: `Homepage returns HTTP ${status}` };
  }

  if (status >= 500) {
    // Could be genuinely down (a great lead) or transient. Ambiguous, so
    // hold it out rather than assert.
    await resp.body?.cancel().catch(() => {});
    return { kind: 'blocked', reason: `Server error (HTTP ${status}) -- may be transient` };
  }

  if (status >= 400) {
    await resp.body?.cancel().catch(() => {});
    return { kind: 'blocked', reason: `Unexpected HTTP ${status}` };
  }

  const html = await readBounded(resp);
  if (CHALLENGE_PATTERNS.test(html.slice(0, 4096))) {
    return { kind: 'blocked', reason: 'Bot challenge page served instead of the site' };
  }

  const facts = await readPage(html);
  const finalHost = (() => {
    try {
      return new URL(resp.url).hostname.toLowerCase();
    } catch {
      return host;
    }
  })();

  const issues: string[] = [];
  if (!resp.url.startsWith('https://')) issues.push('No HTTPS');
  const builder = matchingWeakBuilderDomain(finalHost);
  if (builder) issues.push(`Free page-builder (${builder})`);
  if (!facts.hasViewport) issues.push('No mobile viewport tag');
  if (facts.words < THIN_CONTENT_WORD_THRESHOLD) issues.push('Thin/minimal content');

  return { kind: 'loaded', issues, aiReady: facts.hasSchema };
}

/** Turn a probe outcome into a Lead, or null when the site is good enough to skip. */
export function toLead(
  base: Omit<Lead, 'tier' | 'presence' | 'issues' | 'aiReady' | 'note'>,
  outcome: ProbeOutcome | null,
): Lead | null {
  if (outcome === null) {
    return { ...base, tier: TIER_NO_PRESENCE, presence: 'No Website', issues: [], aiReady: 'N/A' };
  }

  switch (outcome.kind) {
    case 'social':
      return {
        ...base,
        tier: TIER_NO_PRESENCE,
        presence: 'Social Only (no real site)',
        issues: [],
        aiReady: 'N/A',
      };
    case 'broken':
      return {
        ...base,
        tier: TIER_NO_PRESENCE,
        presence: 'Website Unreachable/Broken',
        issues: [],
        aiReady: 'N/A',
        note: outcome.reason,
      };
    case 'blocked':
      return {
        ...base,
        tier: null,
        presence: 'Could not verify',
        issues: [],
        aiReady: 'N/A',
        note: outcome.reason,
      };
    case 'loaded':
      if (outcome.issues.length === 0) return null; // real, working, modern site -- not a lead
      return {
        ...base,
        tier: TIER_WEAK_SITE,
        presence: 'Weak/Unprofessional Website',
        issues: outcome.issues,
        aiReady: outcome.aiReady ? 'Yes' : 'No',
      };
  }
}
