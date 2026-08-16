/**
 * Router, auth gate, and the streaming batch run.
 *
 * Results stream as NDJSON while the run is in flight. That is what lets
 * this work with no storage layer at all: HTTP-triggered Workers have no
 * hard wall-clock limit while the client stays connected, so a batch that
 * takes a minute to probe 50 sites just keeps writing to an open response
 * instead of parking state in KV/D1/R2 and polling for it.
 */

import categories from '../../categories.json';
import { verifyAccessJwt } from './access';
import { textSearch } from './places';
import { probe, toLead } from './probe';
import { dedupKey, type Lead } from './rank';
import { renderApp } from './ui';

interface Env {
  GOOGLE_PLACES_API_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
}

const PRESETS = categories as Record<string, string[]>;

/** Cloudflare's per-invocation cap on connections awaiting response headers. */
const PROBE_CONCURRENCY = 6;

const MAX_LIMIT = 200;

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/**
 * Fails closed. An unconfigured or bypassed deployment must not serve, since
 * every run spends real money against the Places Enterprise SKU.
 */
async function guard(request: Request, env: Env): Promise<Response | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return text(
      'Not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.toml and put this ' +
        'Worker behind a Cloudflare Access application. Refusing to serve unauthenticated.',
      503,
    );
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('Cookie') ?? '')?.[1];

  if (!token) return text('Unauthorized: no Cloudflare Access assertion on this request.', 401);

  try {
    await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    return null;
  } catch (e) {
    return text(`Forbidden: ${e instanceof Error ? e.message : String(e)}`, 403);
  }
}

function resolveCategories(service: string, industry: string): string[] {
  const explicit = service
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  const preset = PRESETS[industry || 'trades'];
  if (!preset) throw new Error(`Unknown preset "${industry}". Options: ${Object.keys(PRESETS).join(', ')}`);
  return preset;
}

interface Candidate {
  base: Omit<Lead, 'tier' | 'presence' | 'issues' | 'aiReady' | 'note'>;
  website: string;
}

async function runBatch(
  params: URLSearchParams,
  env: Env,
  send: (msg: unknown) => Promise<void>,
): Promise<void> {
  const city = (params.get('city') ?? '').trim();
  const state = (params.get('state') ?? '').trim();
  if (!city || !state) throw new Error('City and state are required.');

  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '25', 10) || 25, 1), MAX_LIMIT);
  const cats = resolveCategories(params.get('service') ?? '', params.get('industry') ?? '');
  const location = `${city}, ${state}`;

  // Phase 1: every Places search up front, so the probe phase gets one wide
  // pool instead of restarting concurrency per category.
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const category of cats) {
    await send({ type: 'progress', text: `Searching: ${category} in ${location}…` });
    const places = await textSearch(`${category} in ${location}`, env.GOOGLE_PLACES_API_KEY);

    for (const p of places) {
      const name = p.displayName?.text ?? '';
      const phone = p.nationalPhoneNumber ?? '';
      const key = dedupKey(name, phone);
      // Dedup before probing so a duplicate listing never costs an HTTP fetch.
      if (!key || seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        base: {
          name,
          category,
          reviews: p.userRatingCount ?? 0,
          rating: p.rating ?? 0,
          phone,
          website: p.websiteUri ?? '',
        },
        website: p.websiteUri ?? '',
      });
    }
  }

  await send({ type: 'progress', text: `Checking ${candidates.length} businesses…` });

  // Phase 2: probe concurrently, emitting each verdict as it lands.
  let cursor = 0;
  const total = candidates.length;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const c = candidates[idx];

      const outcome = c.website ? await probe(c.website) : null;
      const lead = toLead(c.base, outcome);

      await send({ type: 'checked', total });
      if (lead) await send({ type: 'lead', lead });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, total || 1) }, () => worker()),
  );

  await send({ type: 'done', total, limit });
}

function handleRun(request: Request, env: Env): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (msg: unknown) => writer.write(encoder.encode(JSON.stringify(msg) + '\n'));

  void (async () => {
    try {
      await runBatch(new URL(request.url).searchParams, env, send);
    } catch (e) {
      await send({ type: 'error', message: e instanceof Error ? e.message : String(e) }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Streaming only helps if nothing downstream buffers the whole body.
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const denied = await guard(request, env);
    if (denied) return denied;

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response(renderApp(PRESETS), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/api/run') {
      if (!env.GOOGLE_PLACES_API_KEY) {
        return text('GOOGLE_PLACES_API_KEY is not set. Run: wrangler secret put GOOGLE_PLACES_API_KEY', 500);
      }
      return handleRun(request, env);
    }

    return text('Not found', 404);
  },
} satisfies ExportedHandler<Env>;
