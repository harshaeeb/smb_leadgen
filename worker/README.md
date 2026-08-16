# leadgen worker — the mobile/web version

Same lead qualification as the Python CLI in the repo root, running as a
Cloudflare Worker with a web UI so you can pull a batch from your phone
between calls. Results stream in live and rank themselves as they arrive.

There is **no storage layer** — no D1, KV, or R2, and no `.xlsx`. A run
streams straight to the browser; when you close the tab it's gone. Use
**Copy as TSV** to paste a batch into your master tracker.

## What's different from the CLI

Better here:

- **Real HTML parsing.** Viewport, `schema.org` markup, and the word count
  use [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/),
  the runtime's streaming parser, instead of regex — and `<script>`/`<style>`
  contents are excluded from the word count, so a page padded with inline JS
  doesn't sneak past the thin-content check.
- **Concurrent probing.** Six sites in flight instead of one at a time.
- **Blocked ≠ broken** (see below).
- Phone numbers are `tel:` links. Tap to call.

Worse here:

- **Datacenter IP reputation.** Worker subrequests come from Cloudflare IPs,
  which some WAFs and bot managers challenge or 403 even though the site
  loads fine from your home connection. This is the one real quality tax of
  moving off your laptop — see below for how it's handled, and use the CLI
  as a fallback when a site you care about won't verify.
- No `.xlsx` output.
- Debugging is `npx wrangler tail`, not terminal output.

## Blocked vs. broken

The CLI treats any HTTP status ≥ 400 as `Website Unreachable/Broken`, which
would be dangerous here: a business whose site 403s a Cloudflare IP would be
ranked a top-priority lead, and you'd open the call with "your website is
down" about a site that works. So this version splits them:

| What happened | Verdict | Where it lands |
| --- | --- | --- |
| DNS/connection failure, TLS failure, timeout | broken | **Tier 1 lead** |
| 404, 410 | broken | **Tier 1 lead** |
| 403, 429, `cf-mitigated` header, challenge page in the body | blocked | **Could not verify** — held out of the ranked batch |
| 5xx | ambiguous | **Could not verify** |

"Could not verify" leads appear in their own section below the batch, with a
tap-to-open link so you can judge for yourself. They never displace a real
lead from your top-N. Missing a lead is cheap; calling a business with a
working website and telling them it's broken is not.

## Deploying

Requires the **Workers Paid plan** ($5/mo). The free plan caps a Worker at
50 external subrequests per invocation, and a 50-result batch needs ~53
(up to 3 Places pages + one probe per candidate).

```bash
cd worker
npm install
```

**1. Set the Google Places key as a secret** (never a var, never in a file):

```bash
npx wrangler secret put GOOGLE_PLACES_API_KEY
```

**2. Deploy to a custom domain route.** `workers_dev` is set to `false` in
`wrangler.toml` on purpose — a live `*.workers.dev` URL would sit outside
Cloudflare Access and let anyone on the internet spend your Places quota.
Uncomment the `routes` block in `wrangler.toml`, point it at a hostname on a
zone in your account, then:

```bash
npx wrangler deploy
```

**3. Put Cloudflare Access in front of it.** In the dashboard: Zero Trust →
Access → Applications → Add a self-hosted application, pointed at the same
hostname, with a policy allowing your email. Free for up to 50 users.

**4. Wire the Access identity back into the Worker.** Copy the application's
**Application Audience (AUD) tag** and your team domain into `wrangler.toml`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
ACCESS_AUD = "the-aud-tag-from-the-dashboard"
```

Then `npx wrangler deploy` again.

The Worker verifies the Access JWT itself (signature against your team's
public keys, plus expiry, audience, and issuer) rather than trusting that
Access ran. **If either var is empty the Worker refuses to serve at all** and
returns 503 — a misconfigured deploy fails closed instead of quietly exposing
your API key.

## Local development

```bash
npx wrangler dev
```

Note the Worker will return 503 locally until the Access vars are set, by
design. To exercise the probe logic without Access, use the test harness.

## Tests

`test/harness.ts` is a test-only entrypoint that exposes `probe()` and
`rankAndTrim()` over HTTP, so the qualification logic can be driven against
local fixtures in the real workerd runtime (HTMLRewriter and `fetch` have no
faithful Node equivalent). It is never deployed — `wrangler.test.toml` is the
only config that references it.

```bash
python3 -m http.server 8787 --directory test/fixtures &
npx wrangler dev --config wrangler.test.toml --port 8788 &

curl 'localhost:8788/?url=http://localhost:8787/long.html'         # passes content checks
curl 'localhost:8788/?url=http://localhost:8787/scriptheavy.html'  # thin despite 1000 words of JS
curl 'localhost:8788/?url=http://localhost:8787/thin.html'         # thin + no viewport
curl 'localhost:8788/?url=http://localhost:8787/microdata.html'    # schema.org via microdata
```

Fixtures are served over plain HTTP, so every result includes a `No HTTPS`
issue — that's the harness, not a bug.

For the failure taxonomy, point it at a server that returns specific status
codes and confirm 403/429/5xx come back `blocked` (tier `null`) while
404/410/connection failures come back `broken` (tier `0`).

## Cost

- Workers Paid: $5/mo, covering far more requests than this will ever make.
- Google Places: unchanged from the CLI — same field mask, same Enterprise
  SKU, same $200/mo free credit. Adding fields to the mask can bump the SKU
  tier; check before you do.
- Cloudflare Access: free at this scale.
- Site probes: free. They're ordinary subrequests.
