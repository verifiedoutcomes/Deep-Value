/**
 * App state (zustand) + persistence (expo-sqlite kv-store).
 *
 * Per ticker the app persists: every pulled snapshot (timestamped, so a
 * frozen state can be pinned -- the sheet's Static mode), scenario
 * overrides, checklist answers. Global settings: capex treatment, pinned
 * snapshot per ticker.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import Storage from 'expo-sqlite/kv-store';
import * as SecureStore from 'expo-secure-store';
import type {
  CompanySnapshot,
  ScenarioOverrides,
} from '@dvh/engine';
import type { CapexTreatment } from '@dvh/engine';
import { CHECKLIST_QUESTIONS } from '@dvh/engine';
import metaFixture from '@dvh/engine/fixtures/meta-2026-07-10.json';

export const BUNDLED_META = metaFixture as unknown as CompanySnapshot;

export interface ChecklistItem {
  question: string;
  answer: boolean;
}

export interface TickerState {
  /** newest first; index 0 is the live view unless a pin is set */
  snapshots: CompanySnapshot[];
  pinnedSnapshotDate?: string;
  overrides: ScenarioOverrides;
  /** Seeded from the sheet's 14 questions; fully user-editable. */
  checklist: ChecklistItem[];
  horizon: 3 | 5;
  scenarioTab: 'bear' | 'base' | 'bull';
}

interface AppState {
  watchlist: string[];
  tickers: Record<string, TickerState>;
  selectedTicker: string;
  capexTreatment: CapexTreatment;
  proxyBaseUrl: string;
  /**
   * Dev convenience only: talks to FMP directly when no proxy is set.
   * SECURITY: held in memory here but persisted ONLY to the iOS
   * Keychain / Android Keystore via expo-secure-store -- `partialize`
   * below excludes it from the SQLite-persisted JSON. Production builds
   * should always use the proxy (key server-side).
   */
  devFmpApiKey: string;
  devMode: boolean;
  setProxyBaseUrl: (url: string) => string | null;
  setDevFmpApiKey: (key: string) => Promise<void>;
  // actions
  selectTicker: (t: string) => void;
  addSnapshot: (t: string, snap: CompanySnapshot) => void;
  pinSnapshot: (t: string, date?: string) => void;
  setOverrides: (t: string, o: ScenarioOverrides) => void;
  setChecklist: (t: string, idx: number, value: boolean) => void;
  addChecklistItem: (t: string, question: string) => void;
  removeChecklistItem: (t: string, idx: number) => void;
  restoreChecklistBaseline: (t: string) => void;
  setHorizon: (t: string, h: 3 | 5) => void;
  setScenarioTab: (t: string, tab: 'bear' | 'base' | 'bull') => void;
  addToWatchlist: (t: string) => void;
  removeFromWatchlist: (t: string) => void;
  setCapexTreatment: (c: CapexTreatment) => void;
  setDevMode: (v: boolean) => void;
}

const baselineChecklist = (): ChecklistItem[] =>
  CHECKLIST_QUESTIONS.map((question) => ({ question, answer: false }));

const emptyTicker = (): TickerState => ({
  snapshots: [],
  overrides: {},
  checklist: baselineChecklist(),
  horizon: 5,
  scenarioTab: 'base',
});

const withChecklistEdit = (
  s: AppState,
  t: string,
  edit: (items: ChecklistItem[]) => ChecklistItem[],
): Partial<AppState> => {
  const cur = s.tickers[t] ?? emptyTicker();
  return { tickers: { ...s.tickers, [t]: { ...cur, checklist: edit(cur.checklist) } } };
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // First-run experience: META pre-loaded from the bundled snapshot.
      watchlist: ['META'],
      tickers: { META: { ...emptyTicker(), snapshots: [BUNDLED_META] } },
      selectedTicker: 'META',
      capexTreatment: 'sheet',
      proxyBaseUrl: '',
      devFmpApiKey: '',
      devMode: false,

      setProxyBaseUrl: (url) => {
        const trimmed = url.trim();
        if (trimmed && !/^https:\/\/[a-z0-9.\-]+/i.test(trimmed)) {
          return 'Proxy URL must be https://';
        }
        set({ proxyBaseUrl: trimmed });
        return null;
      },
      setDevFmpApiKey: async (key) => {
        const trimmed = key.trim();
        set({ devFmpApiKey: trimmed });
        try {
          if (trimmed) {
            await SecureStore.setItemAsync(SECURE_KEY_NAME, trimmed, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            });
          } else {
            await SecureStore.deleteItemAsync(SECURE_KEY_NAME);
          }
        } catch {
          // SecureStore unavailable (e.g. web preview): key stays in memory only
        }
      },

      selectTicker: (t) =>
        set((s) => ({
          selectedTicker: t,
          tickers: s.tickers[t] ? s.tickers : { ...s.tickers, [t]: emptyTicker() },
        })),
      addSnapshot: (t, snap) =>
        set((s) => {
          const cur = s.tickers[t] ?? emptyTicker();
          return {
            tickers: {
              ...s.tickers,
              [t]: { ...cur, snapshots: [snap, ...cur.snapshots].slice(0, 25) },
            },
          };
        }),
      pinSnapshot: (t, date) =>
        set((s) => ({
          tickers: {
            ...s.tickers,
            [t]: { ...(s.tickers[t] ?? emptyTicker()), pinnedSnapshotDate: date },
          },
        })),
      setOverrides: (t, overrides) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), overrides } },
        })),
      setChecklist: (t, idx, value) =>
        set((s) =>
          withChecklistEdit(s, t, (items) =>
            items.map((it, i) => (i === idx ? { ...it, answer: value } : it)),
          ),
        ),
      addChecklistItem: (t, question) =>
        set((s) => {
          const q = question.trim();
          if (!q) return {};
          return withChecklistEdit(s, t, (items) => [...items, { question: q, answer: false }]);
        }),
      removeChecklistItem: (t, idx) =>
        set((s) => withChecklistEdit(s, t, (items) => items.filter((_, i) => i !== idx))),
      restoreChecklistBaseline: (t) =>
        set((s) => withChecklistEdit(s, t, () => baselineChecklist())),
      setHorizon: (t, horizon) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), horizon } },
        })),
      setScenarioTab: (t, scenarioTab) =>
        set((s) => ({
          tickers: { ...s.tickers, [t]: { ...(s.tickers[t] ?? emptyTicker()), scenarioTab } },
        })),
      addToWatchlist: (t) =>
        set((s) => ({
          watchlist: s.watchlist.includes(t) ? s.watchlist : [...s.watchlist, t],
          tickers: s.tickers[t] ? s.tickers : { ...s.tickers, [t]: emptyTicker() },
        })),
      removeFromWatchlist: (t) =>
        set((s) => ({ watchlist: s.watchlist.filter((x) => x !== t) })),
      setCapexTreatment: (capexTreatment) => set({ capexTreatment }),
      setDevMode: (devMode) => set({ devMode }),
    }),
    {
      name: 'dvh-state-v1',
      version: 2,
      migrate: (persisted, version) => {
        const state = persisted as AppState;
        if (version < 2) {
          // v1 stored checklist as boolean[14]; convert to editable items.
          for (const t of Object.values(state.tickers ?? {})) {
            const old = t.checklist as unknown;
            if (Array.isArray(old) && (old.length === 0 || typeof old[0] === 'boolean')) {
              t.checklist = CHECKLIST_QUESTIONS.map((question, i) => ({
                question,
                answer: Boolean((old as boolean[])[i]),
              }));
            }
          }
        }
        return state;
      },
      storage: createJSONStorage(() => Storage),
      // The API key must never touch the SQLite-persisted JSON: it lives
      // in the Keychain and is re-hydrated by hydrateSecureState().
      partialize: (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([k]) => k !== 'devFmpApiKey'),
        ) as AppState,
    },
  ),
);

const SECURE_KEY_NAME = 'dvh.fmp.apikey';

/** Load Keychain-held secrets into the in-memory store at app start. */
export async function hydrateSecureState(): Promise<void> {
  try {
    const key = await SecureStore.getItemAsync(SECURE_KEY_NAME);
    if (key) useAppStore.setState({ devFmpApiKey: key });
  } catch {
    // SecureStore unavailable: dev key simply stays unset
  }
}

/** The snapshot the UI should render for a ticker (pinned or newest). */
export function activeSnapshot(state: TickerState | undefined): CompanySnapshot | null {
  if (!state || state.snapshots.length === 0) return null;
  if (state.pinnedSnapshotDate) {
    const pinned = state.snapshots.find((s) => s.snapshotDate === state.pinnedSnapshotDate);
    if (pinned) return pinned;
  }
  return state.snapshots[0] ?? null;
}
