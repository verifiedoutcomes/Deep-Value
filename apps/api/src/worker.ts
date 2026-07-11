/**
 * Deep Value Hunter data proxy (Cloudflare Worker).
 *
 * Purpose: the FMP API key never ships in the app binary; all provider
 * calls route through here. Responses are cached server-side in KV --
 * per-year fundamentals are immutable once a fiscal year closes, so
 * historical endpoints cache aggressively (30 days), quotes briefly (60s).
 *
 * Security posture:
 *  - STRICT endpoint allowlist: only the FMP paths the app actually uses
 *    are forwarded, with per-endpoint parameter schemas -- the worker is
 *    not an open proxy for the key.
 *  - Client-supplied `apikey` params are discarded; the secret is applied
 *    server-side only and never appears in cache keys or logs.
 *  - Per-IP rate limiting (KV counter, fixed window) to protect the FMP
 *    quota from abuse.
 *  - GET-only, hardened response headers, upstream errors never cached.
 *
 * Routes:
 *   /bundle/<TICKER>                 -> full CompanySnapshot JSON, ONE call
 *                                       per company open; assembled server-
 *                                       side and cached so upstream cost is
 *                                       per-ticker, not per-user
 *   /fmp/stable/<endpoint>?...       -> financialmodelingprep.com (allowlisted)
 *   /edgar/companyfacts/<TICKER>     -> SEC EDGAR XBRL company facts (free fallback)
 */
import {
  EdgarFirstProvider,
  FmpProvider,
  SecEdgarProvider,
  UsdOnlyFxTable,
  loadCompanySnapshot,
  type DataProvider,
} from '@dvh/data';
export interface Env {
  FMP_API_KEY: string;
  CACHE: KVNamespace;
  /** Optional override, requests/min/IP. Default 60. */
  RATE_LIMIT_PER_MIN?: string;
  /**
   * Data backbone for /bundle: 'fmp' (default) or 'edgar-first'
   * (statements from public-domain SEC XBRL; only prices/quotes from
   * FMP). Flipping this needs NO app update.
   */
  DATA_SOURCE?: string;
}

const FMP_ORIGIN = 'https://financialmodelingprep.com';
const EDGAR_ORIGIN = 'https://data.sec.gov';
// SEC asks for a descriptive UA with contact info; change to your own.
const EDGAR_UA = 'DeepValueHunter/0.1 (contact: maxpeel9@gmail.com)';

const LONG_TTL = 30 * 24 * 3600; // closed fiscal years are immutable
const SHORT_TTL = 60;

const SYMBOL_RE = /^[A-Z0-9.\-]{1,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ParamRule {
  required?: boolean;
  validate: (v: string) => boolean;
}

interface EndpointRule {
  ttl: number;
  params: Record<string, ParamRule>;
}

const symbolParam: ParamRule = { required: true, validate: (v) => SYMBOL_RE.test(v) };
const periodParam: ParamRule = { validate: (v) => v === 'annual' || v === 'quarter' };
const limitParam: ParamRule = {
  validate: (v) => /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 100,
};
const dateParam: ParamRule = { validate: (v) => DATE_RE.test(v) };

const statementRule: EndpointRule = {
  ttl: LONG_TTL,
  params: { symbol: symbolParam, period: periodParam, limit: limitParam },
};

/** The ONLY FMP endpoints this worker will forward. */
const FMP_ALLOWLIST: Record<string, EndpointRule> = {
  'income-statement': statementRule,
  'cash-flow-statement': statementRule,
  'balance-sheet-statement': statementRule,
  'enterprise-values': statementRule,
  'key-metrics': statementRule,
  'key-metrics-ttm': { ttl: SHORT_TTL, params: { symbol: symbolParam } },
  quote: { ttl: SHORT_TTL, params: { symbol: symbolParam } },
  'search-symbol': {
    ttl: LONG_TTL,
    params: {
      query: { required: true, validate: (v) => /^[A-Za-z0-9 .\-&]{1,40}$/.test(v) },
      exchange: { validate: (v) => /^[A-Z,]{1,40}$/.test(v) },
    },
  },
  'historical-price-eod/full': {
    ttl: LONG_TTL,
    params: { symbol: symbolParam, from: dateParam, to: dateParam },
  },
};

const SECURITY_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store', // client caching handled by the app itself
};

function reply(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS, ...extra },
  });
}

/** Fixed-window per-IP rate limit backed by KV. Fails open on KV errors. */
async function rateLimited(env: Env, request: Request): Promise<boolean> {
  const limit = Number(env.RATE_LIMIT_PER_MIN ?? '60') || 60;
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const windowKey = `rl:${ip}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const count = Number((await env.CACHE.get(windowKey)) ?? '0') + 1;
    if (count > limit) return true;
    await env.CACHE.put(windowKey, String(count), { expirationTtl: 120 });
  } catch {
    // fail open: a KV hiccup must not take the API down
  }
  return false;
}

async function cachedFetch(
  env: Env,
  cacheKey: string,
  ttl: number,
  doFetch: () => Promise<Response>,
): Promise<Response> {
  const hit = await env.CACHE.get(cacheKey);
  if (hit != null) return reply(hit, 200, { 'X-DVH-Cache': 'hit' });
  const upstream = await doFetch();
  if (!upstream.ok) {
    // Upstream errors are passed through (sans body detail) and NEVER cached.
    return reply(
      JSON.stringify({ error: 'upstream', status: upstream.status }),
      upstream.status === 429 ? 429 : 502,
    );
  }
  const body = await upstream.text();
  await env.CACHE.put(cacheKey, body, { expirationTtl: ttl });
  return reply(body, 200, { 'X-DVH-Cache': 'miss' });
}

function handleFmp(env: Env, url: URL): Promise<Response> | Response {
  const endpoint = url.pathname.replace(/^\/fmp\/stable\//, '');
  const rule = FMP_ALLOWLIST[endpoint];
  if (!rule || endpoint.includes('..')) {
    return reply(JSON.stringify({ error: 'endpoint not allowed' }), 403);
  }
  const upstream = new URL(`${FMP_ORIGIN}/stable/${endpoint}`);
  for (const [name, paramRule] of Object.entries(rule.params)) {
    const v = url.searchParams.get(name);
    if (v == null) {
      if (paramRule.required) {
        return reply(JSON.stringify({ error: `missing param ${name}` }), 400);
      }
      continue;
    }
    if (!paramRule.validate(v)) {
      return reply(JSON.stringify({ error: `invalid param ${name}` }), 400);
    }
    upstream.searchParams.set(name, v);
  }
  // any params not in the schema (incl. client apikey) are dropped here
  const cacheKey = `fmp:${endpoint}?${[...upstream.searchParams]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}`;
  upstream.searchParams.set('apikey', env.FMP_API_KEY);
  return cachedFetch(env, cacheKey, rule.ttl, () => fetch(upstream.toString()));
}

/**
 * The scaling endpoint: assembles the complete CompanySnapshot (quote,
 * 2007+ fundamentals, ownership, weekly prices) server-side and caches
 * the result. A company open costs the client ONE request; the ~10
 * upstream FMP calls behind a cache miss are paid at most once per
 * ticker per BUNDLE_TTL across the entire user base.
 */
const BUNDLE_TTL = 15 * 60; // quote freshness bound; fundamentals barely move

/** Build the /bundle data backbone per DATA_SOURCE. */
function bundleProvider(env: Env): DataProvider {
  const fmp = new FmpProvider({ baseUrl: FMP_ORIGIN, apiKey: env.FMP_API_KEY });
  if ((env.DATA_SOURCE ?? 'fmp') !== 'edgar-first') return fmp;
  // In-process shim: SecEdgarProvider's fetch goes straight to this
  // worker's own EDGAR handler (with its KV caching + ticker->CIK map).
  const edgar = new SecEdgarProvider('internal://edgar', async (input) => {
    const m = String(input).match(/companyfacts\/([A-Za-z.\-]{1,10})$/);
    if (!m) return new Response('bad edgar shim path', { status: 400 });
    return handleEdgar(env, m[1]!.toUpperCase());
  });
  return new EdgarFirstProvider(edgar, fmp);
}

async function handleBundle(env: Env, ticker: string): Promise<Response> {
  const source = (env.DATA_SOURCE ?? 'fmp') === 'edgar-first' ? 'edgar' : 'fmp';
  return cachedFetch(env, `bundle:${source}:${ticker}`, BUNDLE_TTL, async () => {
    const provider = bundleProvider(env);
    try {
      const snapshot = await loadCompanySnapshot(
        provider,
        { ticker, exchange: 'US', reportingCurrency: 'USD' },
        new UsdOnlyFxTable(),
      );
      return new Response(JSON.stringify(snapshot), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502 });
    }
  });
}

async function handleEdgar(env: Env, ticker: string): Promise<Response> {
  return cachedFetch(env, `edgar:companyfacts:${ticker}`, LONG_TTL, async () => {
    const mapRes = await cachedFetch(env, 'edgar:tickermap', LONG_TTL, () =>
      fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': EDGAR_UA },
      }),
    );
    const map = (await mapRes.json()) as Record<string, { cik_str: number; ticker: string }>;
    const entry = Object.values(map).find((e) => e.ticker === ticker);
    if (!entry) return new Response('unknown ticker', { status: 404 });
    const cik = String(entry.cik_str).padStart(10, '0');
    return fetch(`${EDGAR_ORIGIN}/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { 'User-Agent': EDGAR_UA },
    });
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: SECURITY_HEADERS });
    }
    if (request.method !== 'GET') {
      return reply(JSON.stringify({ error: 'method not allowed' }), 405);
    }
    if (await rateLimited(env, request)) {
      return reply(JSON.stringify({ error: 'rate limited' }), 429, { 'Retry-After': '60' });
    }

    const url = new URL(request.url);
    const bundleMatch = url.pathname.match(/^\/bundle\/([A-Za-z0-9.\-]{1,10})$/);
    if (bundleMatch) {
      return handleBundle(env, bundleMatch[1]!.toUpperCase());
    }
    if (url.pathname.startsWith('/fmp/stable/')) {
      return handleFmp(env, url);
    }
    const factsMatch = url.pathname.match(/^\/edgar\/companyfacts\/([A-Za-z.\-]{1,10})$/);
    if (factsMatch) {
      return handleEdgar(env, factsMatch[1]!.toUpperCase());
    }
    return reply(JSON.stringify({ error: 'not found' }), 404);
  },
};
