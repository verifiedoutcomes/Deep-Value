/**
 * Live data wiring: React Query hooks over the provider stack
 * (FMP via the proxy, USD-only FX at launch).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import {
  FmpProvider,
  UsdOnlyFxTable,
  loadCompanySnapshot,
  compareSnapshots,
  type SymbolRef,
  type ParityReport,
} from '@dvh/data';
import type { CompanySnapshot } from '@dvh/engine';
import { BUNDLED_META, useAppStore } from './store';
import { successHaptic, warningHaptic } from './haptics';

export function proxyBaseUrl(): string {
  const fromStore = useAppStore.getState().proxyBaseUrl;
  if (fromStore) return fromStore;
  const fromConfig = (Constants.expoConfig?.extra?.proxyBaseUrl as string) ?? '';
  // the placeholder URL in app.json is not a working proxy
  return fromConfig.includes('example.workers.dev') ? '' : fromConfig;
}

/** True when either a proxy or a dev key makes live pulls possible. */
export function liveDataConfigured(): boolean {
  return Boolean(proxyBaseUrl() || useAppStore.getState().devFmpApiKey);
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

export function useTickerSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => makeProvider().search(query),
    enabled: query.trim().length >= 1 && liveDataConfigured(),
    staleTime: 60_000,
  });
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
