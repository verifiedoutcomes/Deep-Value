/**
 * Live data wiring: React Query hooks over the provider stack. In order:
 *  - the data proxy, when configured (production: one /bundle call);
 *  - on the phone, the free keyless source: SEC EDGAR statements + Yahoo
 *    chart prices, fetched directly (native apps have no CORS limits);
 *  - in a browser, a developer FMP key if set (SEC and Yahoo send no CORS
 *    headers, so a browser can't use the free source without the proxy);
 *  - in the Claude preview, nothing: its viewer blocks the network and the
 *    whole S&P 500 + Nasdaq-100 ships bundled instead.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  FmpProvider,
  FreeProvider,
  PREDECESSORS,
  SHARE_OVERRIDES,
  UsdOnlyFxTable,
  loadCompanySnapshot,
  compareSnapshots,
  searchUniverse,
  universeEntry,
  unsupportedReason,
  type SecCompanyFacts,
  type SymbolRef,
  type ParityReport,
} from '@dvh/data';
import type { CompanySnapshot } from '@dvh/engine';
import { BUNDLED_META, useAppStore } from './store';
import { successHaptic, warningHaptic } from './haptics';
import { NETWORK_BLOCKED, PREVIEW_OFFLINE_MESSAGE } from './host';
import { LIBRARY, UNAVAILABLE } from './library';

export function proxyBaseUrl(): string {
  const fromStore = useAppStore.getState().proxyBaseUrl;
  if (fromStore) return fromStore;
  const fromConfig = (Constants.expoConfig?.extra?.proxyBaseUrl as string) ?? '';
  // the placeholder URL in app.json is not a working proxy
  return fromConfig.includes('example.workers.dev') ? '' : fromConfig;
}

export type LiveSource = 'proxy' | 'free' | 'fmp-key' | 'none';

/** Where a live pull would come from right now. */
export function liveSource(): LiveSource {
  if (NETWORK_BLOCKED) return 'none';
  if (proxyBaseUrl()) return 'proxy';
  if (Platform.OS !== 'web') return 'free';
  return useAppStore.getState().devFmpApiKey ? 'fmp-key' : 'none';
}

export function liveDataConfigured(): boolean {
  return liveSource() !== 'none';
}

/**
 * SEC asks every client to identify itself with a contact. Set
 * expo.extra.secContact in app.json to your own address before release.
 */
function secUserAgent(): string {
  const contact = (Constants.expoConfig?.extra?.secContact as string) || 'contact: deepvaluehunter@example.com';
  return `DeepValueHunter/0.1 (${contact})`;
}

let secTickerMap: Promise<Record<string, number>> | null = null;

/** CIK for a ticker: the bundled universe, else SEC's own ticker file. */
async function cikFor(ticker: string): Promise<number | null> {
  const e = universeEntry(ticker);
  if (e) return e.cik;
  secTickerMap ??= fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': secUserAgent() },
  })
    .then((r) => {
      if (!r.ok) throw new Error(`SEC ticker map: HTTP ${r.status}`);
      return r.json() as Promise<Record<string, { cik_str: number; ticker: string }>>;
    })
    .then((j) =>
      Object.fromEntries(Object.values(j).map((x) => [x.ticker.toUpperCase().replace(/\./g, '-'), x.cik_str])),
    );
  const map = await secTickerMap.catch((): Record<string, number> => {
    secTickerMap = null; // retry on the next call
    return {};
  });
  return map[ticker] ?? null;
}

/** The free source, wired for the phone (a fresh instance per pull). */
function freeProvider(): FreeProvider {
  return new FreeProvider({
    loadFacts: async (cik) => {
      const res = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
        { headers: { 'User-Agent': secUserAgent() } },
      );
      if (!res.ok) throw new Error(`SEC filings: HTTP ${res.status}`);
      return (await res.json()) as SecCompanyFacts;
    },
    cikFor,
    predecessors: PREDECESSORS,
    shareOverrides: SHARE_OVERRIDES,
  });
}

export function makeProvider(): FmpProvider {
  const proxy = proxyBaseUrl();
  if (proxy) {
    return new FmpProvider({ baseUrl: `${proxy.replace(/\/$/, '')}/fmp` });
  }
  // Dev fallback: straight to FMP with the key from Settings. Production
  // builds should configure the proxy so no key lives on-device.
  return new FmpProvider({
    baseUrl: 'https://financialmodelingprep.com',
    apiKey: useAppStore.getState().devFmpApiKey,
  });
}

export function symbolFor(ticker: string): SymbolRef {
  // US-only at launch; the SymbolRef model is the internationalisation hook.
  return { ticker: ticker.toUpperCase(), exchange: 'US', reportingCurrency: 'USD' };
}

/**
 * Prices barely matter intraday for a deep-value model: a refresh inside
 * this window serves the existing snapshot instead of spending an API
 * call. Developer mode bypasses it.
 */
export const FRESHNESS_HOURS = 6;

export async function pullSnapshot(ticker: string): Promise<CompanySnapshot> {
  if (NETWORK_BLOCKED) throw new Error(PREVIEW_OFFLINE_MESSAGE);
  const source = liveSource();
  if (source === 'none') {
    throw new Error('In a browser, live data needs the data proxy (or a dev API key) in Settings.');
  }
  const entry = universeEntry(ticker);
  const unsupported = entry && unsupportedReason(entry);
  if (unsupported) throw new Error(unsupported);
  if (source === 'free') {
    return loadCompanySnapshot(freeProvider(), symbolFor(ticker), new UsdOnlyFxTable());
  }
  const proxy = proxyBaseUrl();
  if (proxy) {
    // One request per company open: the proxy assembles and caches the
    // whole snapshot, so upstream provider cost is per-ticker, not
    // per-user, and no API key exists anywhere near the client. The
    // Keychain-persisted install id lets the server enforce the daily
    // ticker quota (survives reinstalls).
    const res = await fetch(
      `${proxy.replace(/\/$/, '')}/bundle/${encodeURIComponent(ticker.toUpperCase())}`,
      { headers: { 'X-DVH-Device': useAppStore.getState().installId } },
    );
    const remaining = Number(res.headers.get('X-DVH-Quota-Remaining'));
    if (Number.isFinite(remaining)) {
      useAppStore.getState().setQuotaRemaining(remaining);
    }
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      useAppStore.getState().setQuotaRemaining(0);
      throw new Error(body?.message ?? 'Daily live-update limit reached. Resets at midnight UTC.');
    }
    if (!res.ok) throw new Error(`bundle ${ticker}: HTTP ${res.status}`);
    return (await res.json()) as CompanySnapshot;
  }
  // Dev fallback: assemble client-side straight from FMP with the dev key.
  return loadCompanySnapshot(makeProvider(), symbolFor(ticker), new UsdOnlyFxTable());
}

/**
 * Refresh action: pull live data and persist it as a timestamped
 * snapshot. Refreshes inside the freshness window don't touch the
 * network at all (developer mode bypasses).
 */
export function useRefreshSnapshot(ticker: string) {
  const addSnapshot = useAppStore((s) => s.addSnapshot);
  const markFetched = useAppStore((s) => s.markFetched);
  return useMutation({
    mutationFn: async () => {
      const { lastFetchAt, devMode } = useAppStore.getState();
      const last = lastFetchAt[ticker.toUpperCase()];
      if (!devMode && last != null) {
        const ageMs = Date.now() - last;
        if (ageMs < FRESHNESS_HOURS * 3600 * 1000) {
          const nextAt = new Date(last + FRESHNESS_HOURS * 3600 * 1000);
          const ageH = Math.floor(ageMs / 3600_000);
          const ageM = Math.floor((ageMs % 3600_000) / 60_000);
          const hh = String(nextAt.getHours()).padStart(2, '0');
          const mm = String(nextAt.getMinutes()).padStart(2, '0');
          throw new Error(
            `Prices are fresh (updated ${ageH ? `${ageH}h ` : ''}${ageM}m ago). Next live update after ${hh}:${mm}.`,
          );
        }
      }
      return pullSnapshot(ticker);
    },
    onSuccess: (snap) => {
      successHaptic();
      markFetched(ticker.toUpperCase());
      addSnapshot(ticker, snap);
    },
    onError: () => warningHaptic(),
  });
}

export interface SearchHit {
  ticker: string;
  exchange: string;
  name?: string;
  /** Snapshot ships with this build: opens instantly, even offline. */
  bundled: boolean;
  /** 'S&P 500' / 'Nasdaq-100' membership, for universe members. */
  indexes?: string[];
  /** Why this name can't be valued, when it can't. */
  unsupported?: string;
}

/**
 * Every S&P 500 and Nasdaq-100 name matches instantly and offline; the
 * provider search adds other tickers when FMP (key or proxy) is wired.
 */
export function useTickerSearch(query: string) {
  const source = liveSource();
  const remoteEnabled = source === 'proxy' || source === 'fmp-key';
  const remote = useQuery({
    queryKey: ['search', query],
    queryFn: () => makeProvider().search(query),
    enabled: query.trim().length >= 1 && remoteEnabled,
    staleTime: 60_000,
  });
  const data = useMemo<SearchHit[]>(() => {
    const local: SearchHit[] = searchUniverse(query).map((e) => ({
      ticker: e.ticker,
      exchange: e.exchange,
      name: e.name,
      bundled: LIBRARY[e.ticker] != null,
      indexes: e.indexes.map((i) => (i === 'SP500' ? 'S&P 500' : 'Nasdaq-100')),
      unsupported: unsupportedReason(e) ?? UNAVAILABLE[e.ticker] ?? undefined,
    }));
    const seen = new Set(local.map((h) => h.ticker));
    const fromProvider = (remote.data ?? [])
      .filter((r) => !seen.has(r.ticker))
      .map((r) => ({ ticker: r.ticker, exchange: r.exchange, bundled: LIBRARY[r.ticker] != null }));
    return [...local, ...fromProvider];
  }, [query, remote.data]);
  return { data, live: source !== 'none', source, isLoading: remote.isLoading, isError: remote.isError };
}

/** Hidden dev screen: live META pull diffed against the bundled fixture. */
export function useMetaParity(enabled: boolean) {
  return useQuery<ParityReport>({
    queryKey: ['meta-parity'],
    queryFn: async () => compareSnapshots(BUNDLED_META, await pullSnapshot('META')),
    enabled: enabled && liveDataConfigured(),
    staleTime: Infinity,
  });
}
