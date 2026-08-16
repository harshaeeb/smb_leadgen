/**
 * Cloudflare Access JWT verification.
 *
 * Access enforces identity at the edge before a request reaches this Worker,
 * but that only holds if every route to the Worker sits behind an Access
 * application. Verifying the assertion here too means a misconfigured route
 * fails closed instead of silently serving an open endpoint that spends the
 * Google Places key.
 */

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

let keyCache: { teamDomain: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;
const KEY_TTL_MS = 60 * 60 * 1000;

async function getKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const fresh = keyCache && keyCache.teamDomain === teamDomain && Date.now() - keyCache.fetchedAt < KEY_TTL_MS;
  if (fresh) return keyCache!.keys;

  const resp = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!resp.ok) throw new Error(`Could not fetch Access certs: HTTP ${resp.status}`);
  const { keys } = (await resp.json()) as { keys: Jwk[] };

  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    imported.set(jwk.kid, key);
  }

  keyCache = { teamDomain, keys: imported, fetchedAt: Date.now() };
  return imported;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface AccessIdentity {
  email?: string;
}

/**
 * Returns the verified identity, or throws. Checks signature, expiry, and
 * that the token was issued for *this* application (aud) by *this* team
 * (iss) -- a valid token for some other app in the same account must not
 * grant entry here.
 */
export async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string,
): Promise<AccessIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed Access token');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64))) as {
    kid?: string;
    alg?: string;
  };
  if (header.alg !== 'RS256') throw new Error(`Unexpected Access token alg: ${header.alg}`);
  if (!header.kid) throw new Error('Access token missing kid');

  const keys = await getKeys(teamDomain);
  const key = keys.get(header.kid);
  if (!key) throw new Error('Access token signed by an unknown key');

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) throw new Error('Access token signature is invalid');

  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as {
    aud?: string | string[];
    iss?: string;
    exp?: number;
    email?: string;
  };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('Access token expired');

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(expectedAud)) throw new Error('Access token is for a different application');

  if (payload.iss !== `https://${teamDomain}`) throw new Error('Access token from an unexpected issuer');

  return { email: payload.email };
}
