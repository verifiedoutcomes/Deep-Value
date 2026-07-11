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

export async function pullSnapshot(ticker: string): Promise<CompanySnapshot> {
  const proxy = proxyBaseUrl();
  if (proxy) {
    // One request per company open: the proxy assembles and caches the
    // whole snapshot, so upstream provider cost is per-ticker, not
    // per-user, and no API key exists anywhere near the client.
    const res = await fetch(
      `${proxy.replace(/\/$/, '')}/bundle/${encodeURIComponent(ticker.toUpperCase())}`,
    );
    if (!res.ok) throw new Error(`bundle ${ticker}: HTTP ${res.status}`);
    return (await res.json()) as CompanySnapshot;
  }
  // Dev fallback: assemble client-side straight from FMP with the dev key.
  return loadCompanySnapshot(makeProvider(), symbolFor(ticker), new UsdOnlyFxTable());
}

/** Refresh action: pull live data and persist it as a timestamped snapshot. */
export function useRefreshSnapshot(ticker: string) {
  const addSnapshot = useAppStore((s) => s.addSnapshot);
  return useMutation({
    mutationFn: () => pullSnapshot(ticker),
    onSuccess: (snap) => {
      successHaptic();
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
