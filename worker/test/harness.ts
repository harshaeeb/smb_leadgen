/**
 * Test-only entrypoint. Exposes probe() over HTTP so the real workerd runtime
 * (HTMLRewriter, fetch, AbortSignal) can be exercised against local fixtures:
 *
 *   python3 -m http.server 8787 --directory test/fixtures &
 *   npx wrangler dev --config wrangler.test.toml --port 8788
 *   curl 'localhost:8788/?url=http://localhost:8787/good.html'
 *
 * Not deployed. wrangler.test.toml is the only config that points at it.
 */

import { probe, toLead } from '../src/probe';
import { rankAndTrim, type Lead } from '../src/rank';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rank') {
      const leads = (await request.json()) as Lead[];
      return Response.json(rankAndTrim(leads, 10));
    }

    const target = url.searchParams.get('url');
    if (!target) return new Response('pass ?url=', { status: 400 });

    const outcome = await probe(target);
    const lead = toLead(
      { name: 'Fixture Co', category: 'test', reviews: 10, rating: 4.5, phone: '', website: target },
      outcome,
    );
    return Response.json({ outcome, lead });
  },
};
