/**
 * Deep Value Hunter data proxy (Cloudflare Worker).
 *
 * Purpose: the FMP API key never ships in the app binary; all provider
 * calls route through here. Responses are cached server-side in KV --
 * per-year fundamentals are immutable once a fiscal year closes, so
 * historical endpoints cache aggressively (30 days), quotes briefly (60s).
 *
 * Routes:
 *   /fmp/<path>?...        -> https://financialmodelingprep.com/<path>&apikey=SECRET
 *   /edgar/companyfacts/<TICKER> -> SEC EDGAR XBRL company facts (free fallback)
 */
export interface Env {
  FMP_API_KEY: string;
  CACHE: KVNamespace;
}

const FMP_ORIGIN = 'https://financialmodelingprep.com';
const EDGAR_ORIGIN = 'https://data.sec.gov';
// SEC asks for a descriptive UA with contact info.
const EDGAR_UA = 'DeepValueHunter/0.1 (contact: maxpeel9@gmail.com)';

/** Endpoints containing closed-fiscal-year data: cache 30 days. */
const LONG_CACHE_PATTERNS = [
  'income-statement',
  'cash-flow-statement',
  'balance-sheet-statement',
  'enterprise-values',
  'key-metrics',
  'historical-price-eod',
  'companyfacts',
];
const LONG_TTL = 30 * 24 * 3600;
const SHORT_TTL = 60;

function ttlFor(path: string): number {
  return LONG_CACHE_PATTERNS.some((p) => path.includes(p)) ? LONG_TTL : SHORT_TTL;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function cachedFetch(
  env: Env,
  cacheKey: string,
  ttl: number,
  doFetch: () => Promise<Response>,
): Promise<Response> {
  const hit = await env.CACHE.get(cacheKey);
  if (hit != null) {
    return new Response(hit, {
      headers: { 'Content-Type': 'application/json', 'X-DVH-Cache': 'hit', ...corsHeaders() },
    });
  }
  const upstream = await doFetch();
  if (!upstream.ok) {
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: corsHeaders(),
    });
  }
  const body = await upstream.text();
  await env.CACHE.put(cacheKey, body, { expirationTtl: ttl });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json', 'X-DVH-Cache': 'miss', ...corsHeaders() },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return new Response('method not allowed', { status: 405, headers: corsHeaders() });
    }
    const url = new URL(request.url);

    if (url.pathname.startsWith('/fmp/')) {
      const upstreamPath = url.pathname.slice('/fmp'.length);
      const upstream = new URL(FMP_ORIGIN + upstreamPath);
      url.searchParams.forEach((v, k) => {
        if (k !== 'apikey') upstream.searchParams.set(k, v); // never trust client keys
      });
      upstream.searchParams.set('apikey', env.FMP_API_KEY);
      const cacheKey = `fmp:${upstreamPath}?${[...url.searchParams]
        .filter(([k]) => k !== 'apikey')
        .sort()
        .map(([k, v]) => `${k}=${v}`)
        .join('&')}`;
      return cachedFetch(env, cacheKey, ttlFor(upstreamPath), () => fetch(upstream.toString()));
    }

    const factsMatch = url.pathname.match(/^\/edgar\/companyfacts\/([A-Za-z.\-]{1,10})$/);
    if (factsMatch) {
      const ticker = factsMatch[1]!.toUpperCase();
      return cachedFetch(env, `edgar:companyfacts:${ticker}`, LONG_TTL, async () => {
        // ticker -> CIK via the SEC mapping file (itself cached by KV)
        const mapRes = await cachedFetch(
          env,
          'edgar:tickermap',
          LONG_TTL,
          () =>
            fetch('https://www.sec.gov/files/company_tickers.json', {
              headers: { 'User-Agent': EDGAR_UA },
            }),
        );
        const map = (await mapRes.json()) as Record<
          string,
          { cik_str: number; ticker: string }
        >;
        const entry = Object.values(map).find((e) => e.ticker === ticker);
        if (!entry) return new Response('unknown ticker', { status: 404 });
        const cik = String(entry.cik_str).padStart(10, '0');
        return fetch(`${EDGAR_ORIGIN}/api/xbrl/companyfacts/CIK${cik}.json`, {
          headers: { 'User-Agent': EDGAR_UA },
        });
      });
    }

    return new Response('not found', { status: 404, headers: corsHeaders() });
  },
};
