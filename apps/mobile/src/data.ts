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

export function proxyBaseUrl(): string {
  const fromStore = useAppStore.getState().proxyBaseUrl;
  if (fromStore) return fromStore;
  return (Constants.expoConfig?.extra?.proxyBaseUrl as string) ?? '';
}

export function makeProvider(): FmpProvider {
  return new FmpProvider({ baseUrl: `${proxyBaseUrl().replace(/\/$/, '')}/fmp` });
}

export function symbolFor(ticker: string): SymbolRef {
  // US-only at launch; the SymbolRef model is the internationalisation hook.
  return { ticker: ticker.toUpperCase(), exchange: 'US', reportingCurrency: 'USD' };
}

export async function pullSnapshot(ticker: string): Promise<CompanySnapshot> {
  return loadCompanySnapshot(makeProvider(), symbolFor(ticker), new UsdOnlyFxTable());
}

/** Refresh action: pull live data and persist it as a timestamped snapshot. */
export function useRefreshSnapshot(ticker: string) {
  const addSnapshot = useAppStore((s) => s.addSnapshot);
  return useMutation({
    mutationFn: () => pullSnapshot(ticker),
    onSuccess: (snap) => addSnapshot(ticker, snap),
  });
}

export function useTickerSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => makeProvider().search(query),
    enabled: query.trim().length >= 1 && Boolean(proxyBaseUrl()),
    staleTime: 60_000,
  });
}

/** Hidden dev screen: live META pull diffed against the bundled fixture. */
export function useMetaParity(enabled: boolean) {
  return useQuery<ParityReport>({
    queryKey: ['meta-parity'],
    queryFn: async () => compareSnapshots(BUNDLED_META, await pullSnapshot('META')),
    enabled: enabled && Boolean(proxyBaseUrl()),
    staleTime: Infinity,
  });
}
